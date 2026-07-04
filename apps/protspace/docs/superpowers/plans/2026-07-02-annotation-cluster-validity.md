# Annotation-based Cluster-Validity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Compute cluster-validity (silhouette / Davies-Bouldin / Calinski-Harabasz) for user-selected **annotations** on both the source embedding and each projection, plus ARI/NMI agreement between the auto-clusters and each annotation — replacing the circular auto-KMeans self-validity.

**Architecture:** A new `AnnotationValidityStatistic` scores each annotation's category labels on whatever space its `StatContext` carries (`ctx.coords`); the driver runs it on both a new once-per-embedding pass (`space_kind="embedding"`) and the existing per-projection pass. Agreement (ARI/NMI) is emitted from the existing `ClusterValidityStatistic`, reusing the KMeans labels it already computes (no second sweep). `statistics.parquet` gains an `annotation` dimension column.

**Tech Stack:** Python ≥3.10, numpy, scikit-learn (function-local imports), pyarrow, pandas, Typer, pytest.

## Global Constraints

- Run all Python via `uv run` (e.g. `uv run pytest`, `uv run ruff check`). Never bare `python`.
- Lint clean: `uv run ruff check src/ tests/` (py310 target, 88-char lines).
- Terminology is **annotation**, never "feature", in all new code, help text, columns, and docs.
- scikit-learn imports stay **function-local** (keep CLI startup fast).
- Statistics are **best-effort**: a failure for one statistic/annotation/projection is logged and skipped, never raises. Wrap per-metric bodies in `try/except Exception` with `# noqa: BLE001`.
- Reuse the existing bounded-cost guards: subsample to `sample_threshold` (default `DEFAULT_SAMPLE_THRESHOLD = 5000`) with a deterministic seed; skip silhouette outside `2 ≤ k ≤ n-1`; skip DBI/CH when any cluster is a singleton.
- `--stats-annotation` only ever evaluated inside a stats run; default `auto`.
- Commit messages: use `feat(stats):` for the user-visible flag/behavior; `test(stats):`/`refactor(stats):`/`docs(stats):` for the rest. End every commit body with `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.

---

### Task 1: Data model — `StatContext.annotations` + `StatRow.annotation` column

**Files:**
- Modify: `src/protspace/stats/base.py`
- Test: `tests/test_stats.py`

**Interfaces:**
- Produces: `StatContext(..., annotations: dict[str, dict[str, str]] | None = None)`; `StatRow(..., annotation: str = "")`; `STATS_SCHEMA` gains a 9th column `("annotation", pa.string())` positioned after `space_name`.

- [ ] **Step 1: Write the failing test**

Add to `tests/test_stats.py`:

```python
def test_statrow_carries_annotation_column():
    from protspace.stats.base import STATS_SCHEMA, StatRow, StatsReport

    assert "annotation" in STATS_SCHEMA.names
    row = StatRow(
        space_kind="embedding",
        space_name="prot_t5",
        stat_family="annotation_validity",
        label_kind="annotation",
        metric="silhouette",
        metric_kind="validity",
        value=0.42,
        annotation="major_group",
    )
    rec = row.to_record()
    assert rec["annotation"] == "major_group"
    report = StatsReport()
    report.add([row])
    tbl = report.to_arrow()
    assert tbl.column("annotation").to_pylist() == ["major_group"]


def test_statcontext_defaults_annotations_none():
    from protspace.stats.base import StatContext
    import numpy as np

    ctx = StatContext("projection", "P", coords=np.zeros((3, 2)), ids=["a", "b", "c"])
    assert ctx.annotations is None
```

- [ ] **Step 2: Run to verify it fails**

Run: `uv run pytest tests/test_stats.py::test_statrow_carries_annotation_column tests/test_stats.py::test_statcontext_defaults_annotations_none -v`
Expected: FAIL (`annotation` not in schema / unexpected kwarg).

- [ ] **Step 3: Implement**

In `src/protspace/stats/base.py`:

Update `STATS_SCHEMA` (add `annotation` after `space_name`) and its comment:

```python
# The tidy schema. Rows are the bundle-boundary contract. Dimensions of the data
# (space, annotation, label kind, metric) are columns; per-row provenance
# (seeds, sample sizes, inertia lists) goes in ``extra_json``.
STATS_SCHEMA = pa.schema(
    [
        ("space_kind", pa.string()),
        ("space_name", pa.string()),
        ("annotation", pa.string()),
        ("stat_family", pa.string()),
        ("label_kind", pa.string()),
        ("metric", pa.string()),
        ("metric_kind", pa.string()),
        ("value", pa.float64()),
        ("extra_json", pa.string()),
    ]
)
```

Add `annotations` to `StatContext` (after `params` is fine; keep it keyword-friendly):

```python
    high_dim_metric: str = "euclidean"
    params: dict = field(default_factory=dict)
    # annotation name -> {protein id -> category label}. Present only when the
    # caller requested annotation-based validity; id-keyed so lookup is
    # order-independent for any space (embedding or projection).
    annotations: dict[str, dict[str, str]] | None = None
```

Add `annotation` field to `StatRow` (after `space_name`) and emit it in `to_record`:

```python
    space_kind: str
    space_name: str
    annotation: str  # "" for non-annotation rows; the annotation name otherwise
    stat_family: str
    label_kind: str
    metric: str
    metric_kind: str
    value: float
    extra: dict = field(default_factory=dict)
    destination: str = "statistics_part"

    def to_record(self) -> dict:
        return {
            "space_kind": self.space_kind,
            "space_name": self.space_name,
            "annotation": self.annotation,
            "stat_family": self.stat_family,
            "label_kind": self.label_kind,
            "metric": self.metric,
            "metric_kind": self.metric_kind,
            "value": float(self.value),
            "extra_json": json.dumps(self.extra, sort_keys=True, default=_json_default),
        }
```

> NOTE: `annotation` is a required positional field between `space_name` and `stat_family`. Every existing `StatRow(...)` call site (validity.py, faithfulness.py) is updated in later tasks; the test in this task uses the keyword form.

- [ ] **Step 4: Run to verify it passes**

Run: `uv run pytest tests/test_stats.py::test_statrow_carries_annotation_column tests/test_stats.py::test_statcontext_defaults_annotations_none -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/protspace/stats/base.py tests/test_stats.py
git commit -m "$(printf 'feat(stats): add annotation dimension to StatRow + StatContext\n\nCo-Authored-By: Claude Fable 5 <noreply@anthropic.com>')"
```

---

### Task 2: Annotation selection + suitability filter

**Files:**
- Create: `src/protspace/stats/annotation_select.py`
- Test: `tests/test_annotation_select.py`

**Interfaces:**
- Produces:
  - `suitable_annotations(frame, id_col: str = "identifier", max_card: int = 50) -> list[str]`
  - `build_annotation_labels(frame, selection, id_col: str = "identifier") -> dict[str, dict[str, str]]` where `selection` is the string `"auto"` or a list of annotation names; returns `{name: {id: category}}`, dropping empty / `"<NaN>"` / NaN values. `frame` is a pandas DataFrame.

- [ ] **Step 1: Write the failing test**

Create `tests/test_annotation_select.py`:

```python
import pandas as pd
import pytest

from protspace.stats.annotation_select import (
    build_annotation_labels,
    suitable_annotations,
)


def _frame():
    return pd.DataFrame(
        {
            "identifier": [f"p{i}" for i in range(6)],
            "major_group": ["a", "a", "b", "b", "c", "c"],  # suitable (3 cats)
            "all_unique": [f"u{i}" for i in range(6)],       # unsuitable (all unique)
            "constant": ["x"] * 6,                            # unsuitable (1 cat)
            "count": [1, 2, 3, 4, 5, 6],                      # unsuitable (numeric)
            "cluster_elbow_P": ["cluster 0"] * 3 + ["cluster 1"] * 3,  # excluded
        }
    )


def test_suitable_annotations_filters():
    names = suitable_annotations(_frame())
    assert names == ["major_group"]


def test_build_labels_auto():
    labels = build_annotation_labels(_frame(), "auto")
    assert set(labels) == {"major_group"}
    assert labels["major_group"]["p0"] == "a"
    assert len(labels["major_group"]) == 6


def test_build_labels_explicit_names_and_missing_dropped():
    frame = _frame()
    frame.loc[0, "major_group"] = "<NaN>"   # sentinel missing
    frame.loc[1, "major_group"] = ""        # empty
    labels = build_annotation_labels(frame, ["major_group"])
    assert "p0" not in labels["major_group"]  # <NaN> dropped
    assert "p1" not in labels["major_group"]  # empty dropped
    assert labels["major_group"]["p2"] == "b"


def test_build_labels_unknown_name_skipped():
    labels = build_annotation_labels(_frame(), ["does_not_exist"])
    assert labels == {}
```

- [ ] **Step 2: Run to verify it fails**

Run: `uv run pytest tests/test_annotation_select.py -v`
Expected: FAIL (`ModuleNotFoundError: protspace.stats.annotation_select`).

- [ ] **Step 3: Implement**

Create `src/protspace/stats/annotation_select.py`:

```python
"""Select which annotation columns to score, and materialise their labels.

An annotation is "suitable" for cluster-validity when it is a low-cardinality
categorical column: at least 2 distinct non-empty values, at most
``min(max_card, n/2)`` (so it is not effectively an id), and not numeric. The
generated ``cluster_*`` membership columns and the id column are excluded.
"""

from __future__ import annotations

import logging

logger = logging.getLogger(__name__)

_MISSING = {"", "<NaN>", "nan", "None"}


def _clean(series) -> list[str]:
    """Non-missing string values of a column."""
    out = []
    for v in series.tolist():
        if v is None:
            continue
        s = str(v)
        if s in _MISSING:
            continue
        out.append(s)
    return out


def _is_numeric(series) -> bool:
    vals = _clean(series)
    if not vals:
        return False
    try:
        for s in vals:
            float(s)
        return True
    except ValueError:
        return False


def suitable_annotations(
    frame, id_col: str = "identifier", max_card: int = 50
) -> list[str]:
    n = len(frame)
    cap = min(max_card, max(2, n // 2))
    names: list[str] = []
    for col in frame.columns:
        if col == id_col or col.startswith("cluster_"):
            continue
        vals = _clean(frame[col])
        distinct = len(set(vals))
        if distinct < 2 or distinct > cap:
            continue
        if distinct == len(vals):  # all-unique → id-like
            continue
        if _is_numeric(frame[col]):
            continue
        names.append(col)
    return names


def build_annotation_labels(
    frame, selection, id_col: str = "identifier"
) -> dict[str, dict[str, str]]:
    """``{annotation name -> {protein id -> category}}`` for the selection.

    ``selection`` is the string ``"auto"`` (all suitable) or a list of column
    names. Missing / sentinel values are dropped, so a protein absent from a
    column's mapping simply has no category for it.
    """
    if id_col not in getattr(frame, "columns", []):
        return {}
    if isinstance(selection, str) and selection.lower() == "auto":
        names = suitable_annotations(frame, id_col=id_col)
    else:
        wanted = list(selection)
        available = suitable_annotations(frame, id_col=id_col)
        names = []
        for name in wanted:
            if name in available:
                names.append(name)
            else:
                logger.warning(
                    "--stats-annotation '%s' is missing or unsuitable; skipping", name
                )
    labels: dict[str, dict[str, str]] = {}
    ids = [str(i) for i in frame[id_col].tolist()]
    for name in names:
        col = frame[name].tolist()
        mapping: dict[str, str] = {}
        for pid, v in zip(ids, col, strict=False):
            if v is None:
                continue
            s = str(v)
            if s in _MISSING:
                continue
            mapping[pid] = s
        if mapping:
            labels[name] = mapping
    return labels
```

- [ ] **Step 4: Run to verify it passes**

Run: `uv run pytest tests/test_annotation_select.py -v`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/protspace/stats/annotation_select.py tests/test_annotation_select.py
git commit -m "$(printf 'feat(stats): annotation selection + suitability filter\n\nCo-Authored-By: Claude Fable 5 <noreply@anthropic.com>')"
```

---

### Task 3: `AnnotationValidityStatistic`

**Files:**
- Create: `src/protspace/stats/metrics/annotation_validity.py`
- Test: `tests/test_annotation_validity.py`

**Interfaces:**
- Consumes: `StatContext` with `coords`, `ids`, `annotations`, `params`, `rng_seed`.
- Produces: class `AnnotationValidityStatistic` with `family = "annotation_validity"`, `requires_embedding = False`, `embedding_space = True`; `compute(ctx) -> list[StatRow]` emitting `stat_family="annotation_validity"`, `label_kind="annotation"`, `metric ∈ {silhouette, davies_bouldin, calinski_harabasz}`, `metric_kind="validity"`, `annotation=<name>`.

- [ ] **Step 1: Write the failing test**

Create `tests/test_annotation_validity.py`:

```python
import numpy as np

from protspace.stats.base import StatContext, StatRow
from protspace.stats.metrics.annotation_validity import AnnotationValidityStatistic


def _blobs(n=200, centers=4, dim=2, seed=1):
    from sklearn.datasets import make_blobs

    X, y = make_blobs(n_samples=n, centers=centers, n_features=dim, random_state=seed)
    return X, y


def test_scores_each_annotation_on_ctx_coords():
    X, y = _blobs(n=200, centers=4, dim=2, seed=3)
    ids = [f"p{i}" for i in range(200)]
    ann = {"grp": {pid: f"g{int(c)}" for pid, c in zip(ids, y)}}
    outs = AnnotationValidityStatistic().compute(
        StatContext("projection", "PCA_2", coords=X, ids=ids, annotations=ann)
    )
    by_metric = {r.metric: r for r in outs if isinstance(r, StatRow)}
    assert {"silhouette", "davies_bouldin", "calinski_harabasz"} <= set(by_metric)
    s = by_metric["silhouette"]
    assert s.stat_family == "annotation_validity"
    assert s.annotation == "grp" and s.label_kind == "annotation"
    assert 0.4 < s.value <= 1.0  # well-separated blobs → high silhouette


def test_space_kind_is_taken_from_context():
    X, y = _blobs(n=120, centers=3, dim=8, seed=4)
    ids = [f"p{i}" for i in range(120)]
    ann = {"grp": {pid: f"g{int(c)}" for pid, c in zip(ids, y)}}
    outs = AnnotationValidityStatistic().compute(
        StatContext("embedding", "prot_t5", coords=X, ids=ids, annotations=ann)
    )
    assert all(r.space_kind == "embedding" for r in outs)
    assert all(r.space_name == "prot_t5" for r in outs)


def test_missing_annotation_values_excluded():
    X, y = _blobs(n=100, centers=2, dim=2, seed=5)
    ids = [f"p{i}" for i in range(100)]
    # Only half the proteins have a category → the rest are dropped from scoring.
    ann = {"grp": {pid: f"g{int(c)}" for pid, c in list(zip(ids, y))[:50]}}
    outs = AnnotationValidityStatistic().compute(
        StatContext("projection", "P", coords=X, ids=ids, annotations=ann)
    )
    sil = next(r for r in outs if r.metric == "silhouette")
    assert sil.extra["n_labels"] == 50


def test_single_category_annotation_emits_nothing():
    X, _ = _blobs(n=80, centers=1, dim=2, seed=6)
    ids = [f"p{i}" for i in range(80)]
    ann = {"grp": {pid: "only" for pid in ids}}  # 1 category
    outs = AnnotationValidityStatistic().compute(
        StatContext("projection", "P", coords=X, ids=ids, annotations=ann)
    )
    assert outs == []


def test_no_annotations_returns_empty():
    X, _ = _blobs(n=50, centers=2, dim=2, seed=7)
    outs = AnnotationValidityStatistic().compute(
        StatContext("projection", "P", coords=X, ids=[f"p{i}" for i in range(50)])
    )
    assert outs == []
```

- [ ] **Step 2: Run to verify it fails**

Run: `uv run pytest tests/test_annotation_validity.py -v`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement**

Create `src/protspace/stats/metrics/annotation_validity.py`:

```python
"""Annotation-based cluster-validity: how well an annotation's categories
separate in a given space (embedding or projection).

silhouette / Davies-Bouldin / Calinski-Harabasz are computed with the
annotation's category labels (not auto-KMeans labels), on ``ctx.coords`` —
the driver hands us the embedding for the once-per-embedding pass and the 2D
projection for the per-projection pass. scikit-learn imports are function-local.
"""

from __future__ import annotations

import numpy as np

from protspace.stats.base import StatContext, StatRow

DEFAULT_SAMPLE_THRESHOLD = 5000


def _subsample(n: int, threshold: int, rng_seed: int):
    """Deterministic sorted index subsample, or None when n <= threshold."""
    if n <= threshold:
        return None
    rng = np.random.default_rng(rng_seed)
    return np.sort(rng.permutation(n)[:threshold])


class AnnotationValidityStatistic:
    """silhouette / DBI / CH of each annotation's categories on ``ctx.coords``."""

    family = "annotation_validity"
    requires_embedding = False
    embedding_space = True  # also run by the driver's once-per-embedding pass

    def compute(self, ctx: StatContext) -> list[StatRow]:
        if not ctx.annotations:
            return []
        from sklearn.metrics import (
            calinski_harabasz_score,
            davies_bouldin_score,
            silhouette_score,
        )

        X = np.asarray(ctx.coords, dtype=float)
        threshold = int(ctx.params.get("sample_threshold", DEFAULT_SAMPLE_THRESHOLD))
        id_to_row = {pid: i for i, pid in enumerate(ctx.ids)}
        rows: list[StatRow] = []

        for name, mapping in ctx.annotations.items():
            # Rows of ctx.coords that have a category for this annotation.
            row_idx: list[int] = []
            cats: list[str] = []
            for pid, cat in mapping.items():
                i = id_to_row.get(pid)
                if i is not None:
                    row_idx.append(i)
                    cats.append(cat)
            if len(row_idx) < 3:
                continue
            uniq = sorted(set(cats))
            if len(uniq) < 2:  # need >= 2 categories
                continue
            cat_to_int = {c: j for j, c in enumerate(uniq)}
            Xa = X[np.asarray(row_idx)]
            labels = np.asarray([cat_to_int[c] for c in cats])

            # Bound cost: shared deterministic subsample across all three metrics.
            sub = _subsample(Xa.shape[0], threshold, ctx.rng_seed)
            if sub is not None:
                Xa, labels = Xa[sub], labels[sub]
            n = Xa.shape[0]
            _, counts = np.unique(labels, return_counts=True)
            achieved = len(counts)
            if achieved < 2:  # a category vanished under subsampling
                continue
            has_singleton = bool((counts < 2).any())
            base = dict(
                space_kind=ctx.space_kind,
                space_name=ctx.space_name,
                annotation=name,
                stat_family=self.family,
                label_kind="annotation",
            )
            extra = {
                "seed": ctx.rng_seed,
                "n_labels": int(n),
                "n_categories": int(achieved),
                "sampled": sub is not None,
            }

            if 2 <= achieved <= n - 1:
                try:
                    rows.append(
                        StatRow(
                            metric="silhouette",
                            metric_kind="validity",
                            value=float(silhouette_score(Xa, labels)),
                            extra=extra,
                            **base,
                        )
                    )
                except Exception:  # noqa: BLE001 - best-effort
                    pass
            if not has_singleton:
                for metric_name, fn in (
                    ("davies_bouldin", davies_bouldin_score),
                    ("calinski_harabasz", calinski_harabasz_score),
                ):
                    try:
                        rows.append(
                            StatRow(
                                metric=metric_name,
                                metric_kind="validity",
                                value=float(fn(Xa, labels)),
                                extra=extra,
                                **base,
                            )
                        )
                    except Exception:  # noqa: BLE001 - best-effort
                        pass
        return rows
```

- [ ] **Step 4: Run to verify it passes**

Run: `uv run pytest tests/test_annotation_validity.py -v`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/protspace/stats/metrics/annotation_validity.py tests/test_annotation_validity.py
git commit -m "$(printf 'feat(stats): AnnotationValidityStatistic (silhouette/DBI/CH per annotation)\n\nCo-Authored-By: Claude Fable 5 <noreply@anthropic.com>')"
```

---

### Task 4: Rework `ClusterValidityStatistic` — drop self-validity, add ARI/NMI agreement

**Files:**
- Modify: `src/protspace/stats/metrics/validity.py`
- Test: `tests/test_stats.py`

**Interfaces:**
- Consumes: `StatContext` with `coords`, `ids`, `annotations`, `params`.
- Produces: `ClusterValidityStatistic.compute` now emits, per auto-cluster labelling: an `n_clusters` **meta** `StatRow`, the membership `AnnotationColumn` (unchanged), and — for each annotation — `adjusted_rand` / `normalized_mutual_info` `StatRow`s with `stat_family="cluster_agreement"`, `metric_kind="agreement"`, `annotation=<name>`, `label_kind=<kmeans_elbow|kmeans_silhouette>`. It NO LONGER emits `silhouette`/`davies_bouldin`/`calinski_harabasz` rows for the auto-clusters.

- [ ] **Step 1: Write the failing test**

Add to `tests/test_stats.py`:

```python
def test_cluster_validity_emits_agreement_not_self_validity():
    from protspace.stats.base import AnnotationColumn, StatContext, StatRow
    from protspace.stats.metrics.validity import ClusterValidityStatistic

    X, y = _blobs(n=200, centers=4, dim=2, seed=61)
    ids = [f"p{i}" for i in range(200)]
    ann = {"grp": {pid: f"g{int(c)}" for pid, c in zip(ids, y)}}
    outs = ClusterValidityStatistic().compute(
        StatContext("projection", "PCA_2", coords=X, ids=ids, annotations=ann)
    )
    rows = [o for o in outs if isinstance(o, StatRow)]
    metrics = {r.metric for r in rows}
    # No self-validity rows anymore:
    assert not ({"silhouette", "davies_bouldin", "calinski_harabasz"} & metrics)
    # n_clusters meta kept:
    assert "n_clusters" in metrics
    # ARI/NMI agreement vs the annotation, tagged correctly:
    agree = [r for r in rows if r.stat_family == "cluster_agreement"]
    assert {r.metric for r in agree} == {"adjusted_rand", "normalized_mutual_info"}
    assert all(r.annotation == "grp" and r.metric_kind == "agreement" for r in agree)
    assert all(r.label_kind == "kmeans_elbow" for r in agree)
    # Auto-clusters recover well-separated blobs → high agreement.
    ari = next(r for r in agree if r.metric == "adjusted_rand")
    assert ari.value > 0.5
    # Membership column still emitted.
    assert any(isinstance(o, AnnotationColumn) for o in outs)


def test_cluster_validity_no_annotations_still_emits_membership():
    from protspace.stats.base import AnnotationColumn, StatContext, StatRow
    from protspace.stats.metrics.validity import ClusterValidityStatistic

    X, _ = _blobs(n=150, centers=3, dim=2, seed=62)
    ids = [f"p{i}" for i in range(150)]
    outs = ClusterValidityStatistic().compute(
        StatContext("projection", "P", coords=X, ids=ids)
    )
    assert any(isinstance(o, AnnotationColumn) for o in outs)
    assert not [r for r in outs if isinstance(r, StatRow) and r.stat_family == "cluster_agreement"]
```

Also update the existing `test_aggregate_silhouette_equals_per_point_mean` and any test asserting a `silhouette`/`davies_bouldin`/`calinski_harabasz` `StatRow` from `ClusterValidityStatistic`: those aggregate rows are removed. Change them to assert on the membership column's attached per-point silhouette instead (the per-point confidence is retained), or delete the now-invalid assertion. Grep first: `uv run grep -rn "davies_bouldin\|calinski_harabasz\|metric == \"silhouette\"" tests/test_stats.py`.

- [ ] **Step 2: Run to verify it fails**

Run: `uv run pytest tests/test_stats.py::test_cluster_validity_emits_agreement_not_self_validity -v`
Expected: FAIL (agreement rows absent; self-validity rows still present).

- [ ] **Step 3: Implement**

In `src/protspace/stats/metrics/validity.py`, inside `_emit_labeling` (the per-labelling method):

1. **Delete** the silhouette aggregate block (the `if silhouette_ok:` block that appends the `metric="silhouette"` `StatRow`) and the Davies-Bouldin / Calinski-Harabasz loop (`if not has_singleton:` block that appends those two rows). Keep the `per_point_samples` computation (it still feeds the membership column's attached `|silhouette`) and the `n_clusters` meta row.

2. **Add** every existing `StatRow(...)` construction the new required positional `annotation=""` — the `n_clusters` meta row becomes:

```python
        rows: list = [
            StatRow(
                space_kind=ctx.space_kind,
                space_name=ctx.space_name,
                annotation="",
                stat_family=self.family,
                label_kind=label_kind,
                metric="n_clusters",
                metric_kind="meta",
                value=float(achieved),
                extra=meta_extra,
            )
        ]
```

(Replace the old `**base` spread with explicit kwargs, or add `annotation=""` to `base`.)

3. **Add** the agreement block after the membership column is appended, still inside `_emit_labeling`:

```python
        # ARI/NMI: does this auto-clustering recover each annotation? Reuses the
        # KMeans labels already computed (no second sweep). Compared over the
        # id-intersection of clustered points and annotated points.
        if ctx.annotations:
            from sklearn.metrics import (
                adjusted_rand_score,
                normalized_mutual_info_score,
            )

            label_by_id = dict(zip(ctx.ids, labels, strict=False))
            for name, mapping in ctx.annotations.items():
                paired_clu: list[int] = []
                paired_ann: list[str] = []
                for pid, cat in mapping.items():
                    lbl = label_by_id.get(pid)
                    if lbl is not None:
                        paired_clu.append(int(lbl))
                        paired_ann.append(cat)
                if len(set(paired_ann)) < 2 or len(paired_ann) < 3:
                    continue
                for metric_name, fn in (
                    ("adjusted_rand", adjusted_rand_score),
                    ("normalized_mutual_info", normalized_mutual_info_score),
                ):
                    try:
                        rows.append(
                            StatRow(
                                space_kind=ctx.space_kind,
                                space_name=ctx.space_name,
                                annotation=name,
                                stat_family="cluster_agreement",
                                label_kind=label_kind,
                                metric=metric_name,
                                metric_kind="agreement",
                                value=float(fn(paired_ann, paired_clu)),
                                extra={"seed": rng_seed, "n_labels": len(paired_ann)},
                            )
                        )
                    except Exception:  # noqa: BLE001 - best-effort
                        pass
```

4. Update the module docstring: it now emits auto-clustering (membership + `n_clusters`) and annotation **agreement**, not self-validity.

- [ ] **Step 4: Run to verify it passes**

Run: `uv run pytest tests/test_stats.py -k "cluster_validity or agreement or membership" -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/protspace/stats/metrics/validity.py tests/test_stats.py
git commit -m "$(printf 'refactor(stats): drop auto-cluster self-validity, add ARI/NMI agreement\n\nCo-Authored-By: Claude Fable 5 <noreply@anthropic.com>')"
```

---

### Task 5: Driver — thread annotations + once-per-embedding pass + registry

**Files:**
- Modify: `src/protspace/stats/driver.py`
- Modify: `src/protspace/stats/__init__.py`
- Modify: `src/protspace/stats/metrics/faithfulness.py` (add `annotation=""` to its `StatRow(...)` calls)
- Test: `tests/test_stats.py`

**Interfaces:**
- Consumes: `AnnotationValidityStatistic` (Task 3), reworked `ClusterValidityStatistic` (Task 4).
- Produces: `compute_statistics(..., annotations: dict[str, dict[str, str]] | None = None)`. Projection contexts carry `annotations`; a new per-embedding loop builds `StatContext(space_kind="embedding", space_name=<emb.name>, coords=<emb.data>, ids=<emb.headers>, annotations=...)` and runs only statistics with `embedding_space = True`.

- [ ] **Step 1: Write the failing test**

Add to `tests/test_stats.py`:

```python
def test_driver_emits_embedding_and_projection_annotation_validity():
    from protspace.stats import compute_statistics
    from sklearn.decomposition import PCA

    X, y = _blobs(n=180, centers=4, dim=8, seed=71)
    coords = PCA(n_components=2, random_state=0).fit_transform(X)
    headers = [f"p{i}" for i in range(180)]
    ann = {"grp": {pid: f"g{int(c)}" for pid, c in zip(headers, y)}}

    class _Emb:
        name = "e"
        data = X
        headers = headers
        precomputed = False

    report = compute_statistics(
        [_Emb()],
        [{"name": "e — PCA 2", "data": coords, "ids": headers, "source": "e"}],
        annotations=ann,
    )
    av = [r for r in report.rows if r.stat_family == "annotation_validity"]
    kinds = {(r.space_kind, r.annotation) for r in av}
    assert ("embedding", "grp") in kinds       # once-per-embedding pass
    assert ("projection", "grp") in kinds      # per-projection pass
    # embedding is computed exactly once per (embedding, annotation, metric)
    emb_sil = [r for r in av if r.space_kind == "embedding" and r.metric == "silhouette"]
    assert len(emb_sil) == 1
```

- [ ] **Step 2: Run to verify it fails**

Run: `uv run pytest tests/test_stats.py::test_driver_emits_embedding_and_projection_annotation_validity -v`
Expected: FAIL (`compute_statistics` has no `annotations` param / no embedding rows).

- [ ] **Step 3: Implement**

In `src/protspace/stats/__init__.py`, register the new statistic:

```python
        from protspace.stats.metrics.annotation_validity import (
            AnnotationValidityStatistic,
        )
        from protspace.stats.metrics.faithfulness import FaithfulnessStatistic
        from protspace.stats.metrics.validity import ClusterValidityStatistic

        _STATISTICS = [
            ClusterValidityStatistic(),
            AnnotationValidityStatistic(),
            FaithfulnessStatistic(),
        ]
```

In `src/protspace/stats/driver.py`:

Add the `annotations` parameter and thread it into the projection `StatContext` (add `annotations=annotations` to the `StatContext(...)` call), then append the embedding pass just before `return report`:

```python
def compute_statistics(
    embedding_sets: list,
    reductions: list[dict],
    *,
    rng_seed: int = 42,
    params: dict | None = None,
    statistics: list | None = None,
    default_metric: str = "euclidean",
    annotations: dict | None = None,
) -> StatsReport:
```

Projection `StatContext(...)` gains:

```python
                params=params,
                annotations=annotations,
            )
```

After the projection loop, before `return report`:

```python
    # Once-per-embedding pass: annotation-validity on the source embedding itself
    # (the true-separability "ceiling"), computed once per embedding rather than
    # repeated for every projection that shares it. Only statistics that opt in
    # via ``embedding_space`` run here.
    if annotations:
        emb_stats = [s for s in stats if getattr(s, "embedding_space", False)]
        for es in embedding_sets:
            if getattr(es, "precomputed", False):
                continue
            try:
                ectx = StatContext(
                    space_kind="embedding",
                    space_name=es.name,
                    coords=np.asarray(es.data, dtype=float),
                    ids=list(es.headers),
                    rng_seed=rng_seed,
                    params=params or {},
                    annotations=annotations,
                )
            except Exception as exc:  # noqa: BLE001
                logger.warning("embedding-stats setup failed for '%s': %s", es.name, exc)
                continue
            for stat in emb_stats:
                try:
                    report.add(stat.compute(ectx))
                except Exception as exc:  # noqa: BLE001 - statistics are secondary
                    logger.warning(
                        "statistic %s failed for embedding '%s': %s",
                        getattr(stat, "family", stat),
                        es.name,
                        exc,
                    )

    return report
```

In `src/protspace/stats/metrics/faithfulness.py`, add `annotation=""` to each `StatRow(...)` construction (the skip row and the per-metric rows) so they satisfy the new required field.

- [ ] **Step 4: Run to verify it passes**

Run: `uv run pytest tests/test_stats.py::test_driver_emits_embedding_and_projection_annotation_validity -v`
Then the whole stats suite: `uv run pytest tests/test_stats.py -q`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/protspace/stats/driver.py src/protspace/stats/__init__.py src/protspace/stats/metrics/faithfulness.py tests/test_stats.py
git commit -m "$(printf 'feat(stats): driver runs annotation-validity on embedding + projections\n\nCo-Authored-By: Claude Fable 5 <noreply@anthropic.com>')"
```

---

### Task 6: `stats` CLI — `--stats-annotation`

**Files:**
- Modify: `src/protspace/cli/stats.py`
- Test: `tests/test_stats_cli.py`

**Interfaces:**
- Consumes: `build_annotation_labels` (Task 2), `compute_statistics(..., annotations=...)` (Task 5).
- Produces: `stats --stats-annotation "auto"|"a,b"` reads the `-a` parquet into a frame, builds labels, passes them to `compute_statistics`; `statistics.parquet` then contains `annotation_validity` + `cluster_agreement` rows.

- [ ] **Step 1: Write the failing test**

Add to `tests/test_stats_cli.py` (reuse the existing `_project_dir` helper that builds an h5 + projections; it must also write an annotations parquet with a categorical column — extend it or build inline):

```python
def test_stats_command_computes_annotation_validity(tmp_path):
    import pyarrow as pa
    import pyarrow.parquet as pq
    from typer.testing import CliRunner

    from protspace.cli.app import app

    h5_path, proj, ids = _project_dir(tmp_path)  # returns (h5, proj_dir, id list)
    ann_path = tmp_path / "annotations.parquet"
    # A separable categorical annotation over the same ids.
    groups = ["a" if i % 2 else "b" for i in range(len(ids))]
    pq.write_table(
        pa.table({"identifier": ids, "major_group": groups}), str(ann_path)
    )
    out = tmp_path / "statistics.parquet"
    result = CliRunner().invoke(
        app,
        ["stats", "-i", f"{h5_path}:E", "-p", str(proj), "-o", str(out),
         "-a", str(ann_path), "--stats-annotation", "auto"],
    )
    assert result.exit_code == 0, result.output
    st = pq.read_table(str(out)).to_pandas()
    assert "annotation" in st.columns
    av = st[st.stat_family == "annotation_validity"]
    assert set(av["annotation"]) == {"major_group"}
    assert {"embedding", "projection"} <= set(av["space_kind"])


def test_stats_rejects_no_annotation_source_for_stats_annotation(tmp_path):
    from typer.testing import CliRunner
    from protspace.cli.app import app

    h5_path, proj, _ = _project_dir(tmp_path)
    out = tmp_path / "statistics.parquet"
    result = CliRunner().invoke(
        app,
        ["stats", "-i", f"{h5_path}:E", "-p", str(proj), "-o", str(out),
         "--stats-annotation", "major_group"],  # no -a
    )
    # --stats-annotation without -a has nothing to score → clear error.
    assert result.exit_code != 0
```

> If `_project_dir` doesn't return the id list, update it to `return h5_path, proj, ids` and fix its existing callers in the same commit.

- [ ] **Step 2: Run to verify it fails**

Run: `uv run pytest tests/test_stats_cli.py::test_stats_command_computes_annotation_validity -v`
Expected: FAIL (no `--stats-annotation` option).

- [ ] **Step 3: Implement**

In `src/protspace/cli/stats.py`:

Add the option to the `stats` signature (after `cluster_selection`):

```python
    stats_annotation: Annotated[
        str,
        typer.Option(
            "--stats-annotation",
            help="Which annotation column(s) to score for cluster-validity: "
            "'auto' (all suitable categoricals) or a comma-separated list. "
            "Requires -a/--annotations.",
        ),
    ] = "auto",
```

Add validation next to the existing `--settings-out requires -a` guard:

```python
    if stats_annotation and annotations is None and stats_annotation != "auto":
        raise typer.BadParameter("--stats-annotation requires -a/--annotations.")
```

Build labels and pass them in. Just before the `compute_statistics(...)` call:

```python
    import pyarrow.parquet as pq  # already imported at function top

    annotation_labels = None
    if annotations is not None:
        ann_frame = pq.read_table(str(annotations)).to_pandas()
        id_col = "identifier" if "identifier" in ann_frame.columns else ann_frame.columns[0]
        selection = (
            "auto"
            if stats_annotation.strip().lower() == "auto"
            else [s.strip() for s in stats_annotation.split(",") if s.strip()]
        )
        annotation_labels = build_annotation_labels(ann_frame, selection, id_col=id_col)

    report = compute_statistics(
        embedding_sets,
        reductions,
        rng_seed=seed,
        params=params,
        default_metric=metric,
        annotations=annotation_labels,
    )
```

Add the import at the top of the function's import block:

```python
    from protspace.stats.annotation_select import build_annotation_labels
```

- [ ] **Step 4: Run to verify it passes**

Run: `uv run pytest tests/test_stats_cli.py -k "annotation" -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/protspace/cli/stats.py tests/test_stats_cli.py
git commit -m "$(printf 'feat(stats): stats --stats-annotation scores selected annotations\n\nCo-Authored-By: Claude Fable 5 <noreply@anthropic.com>')"
```

---

### Task 7: `prepare` CLI + pipeline — `--stats-annotation`

**Files:**
- Modify: `src/protspace/cli/prepare.py`
- Modify: `src/protspace/data/processors/pipeline.py`
- Test: `tests/test_stats_cli.py`

**Interfaces:**
- Consumes: `PipelineConfig`, `build_annotation_labels`, `compute_statistics(..., annotations=...)`.
- Produces: `PipelineConfig.stats_annotation: str = "auto"`; `prepare --stats --stats-annotation ...` flows the selection into `_compute_statistics`, which builds labels from the `metadata` frame and passes them to `compute_statistics`.

- [ ] **Step 1: Write the failing test**

Add to `tests/test_stats_cli.py` an assertion in (or alongside) the existing `test_prepare_pipeline_compute_statistics` that, with `--stats` and an annotation CSV containing a categorical column, the resulting bundle's `statistics.parquet` has `stat_family == "annotation_validity"` rows. (Follow that test's existing construction of inputs; add `--stats-annotation auto` to the invocation and read the 5th bundle part via `read_statistics_from_bundle`.)

```python
def test_prepare_stats_annotation_validity_in_bundle(tmp_path):
    # ... build FASTA/h5 + a CSV annotation with a categorical 'grp' column,
    # mirroring test_prepare_pipeline_compute_statistics ...
    # invoke: prepare -i emb.h5 -a grp.csv -m pca2,umap2 --stats --stats-annotation auto -o out
    # then:
    from protspace.data.io.bundle import read_statistics_from_bundle
    import pyarrow.parquet as pq, io
    raw = read_statistics_from_bundle(bundle_path)
    st = pq.read_table(io.BytesIO(raw)).to_pandas()
    assert (st.stat_family == "annotation_validity").any()
    assert "annotation" in st.columns
```

- [ ] **Step 2: Run to verify it fails**

Run: `uv run pytest tests/test_stats_cli.py::test_prepare_stats_annotation_validity_in_bundle -v`
Expected: FAIL.

- [ ] **Step 3: Implement**

In `src/protspace/data/processors/pipeline.py`, add to `PipelineConfig`:

```python
    cluster_selection: str = "elbow"  # elbow | silhouette | both (for --stats)
    stats_annotation: str = "auto"    # which annotation(s) to score (--stats)
```

In `_compute_statistics`, build labels from `metadata` and pass them in:

```python
            from protspace.stats.annotation_select import build_annotation_labels

            annotation_labels = None
            if metadata is not None:
                selection = (
                    "auto"
                    if str(self.config.stats_annotation).strip().lower() == "auto"
                    else [
                        s.strip()
                        for s in self.config.stats_annotation.split(",")
                        if s.strip()
                    ]
                )
                annotation_labels = build_annotation_labels(
                    metadata, selection, id_col="identifier"
                )

            report = compute_statistics(
                embedding_sets,
                all_reductions,
                rng_seed=self.config.reducer_params.random_state,
                params={
                    "cluster_selection": self.config.cluster_selection,
                    "include_scores": not self.config.no_scores,
                },
                default_metric=self.config.reducer_params.metric,
                annotations=annotation_labels,
            )
```

In `src/protspace/cli/prepare.py`, add the option type near `Opt_ClusterSelection`:

```python
Opt_StatsAnnotation = Annotated[
    str,
    typer.Option(
        "--stats-annotation",
        help="With --stats, which annotation column(s) to score: 'auto' (all "
        "suitable categoricals) or a comma-separated list.",
        rich_help_panel="Output",
    ),
]
```

Add the parameter to `prepare(...)` after `cluster_selection`:

```python
    cluster_selection: Opt_ClusterSelection = ClusterSelection.elbow,
    stats_annotation: Opt_StatsAnnotation = "auto",
```

Pass it into `PipelineConfig(...)`:

```python
            cluster_selection=cluster_selection.value,
            stats_annotation=stats_annotation,
```

- [ ] **Step 4: Run to verify it passes**

Run: `uv run pytest tests/test_stats_cli.py -k "annotation or compute_statistics" -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/protspace/cli/prepare.py src/protspace/data/processors/pipeline.py tests/test_stats_cli.py
git commit -m "$(printf 'feat(stats): prepare --stats-annotation flows selection into the pipeline\n\nCo-Authored-By: Claude Fable 5 <noreply@anthropic.com>')"
```

---

### Task 8: Full-suite green, lint, and docs

**Files:**
- Modify: `CLAUDE.md`, `../protspace/CLAUDE.md` (the package one at `src`-level), `docs/cli.md`, `README.md`, `notebooks/ProtSpace_Preparation.ipynb`
- Test: entire suite

- [ ] **Step 1: Run the whole fast suite + lint**

Run:
```bash
uv run pytest tests/ -m "not slow" -q
uv run ruff check src/ tests/
```
Expected: all pass. Fix any residual `StatRow(...)` call sites missing the new `annotation` field (grep: `uv run grep -rn "StatRow(" src/protspace | wc -l` and confirm each passes `annotation`). Fix any test that asserted the old auto-cluster self-validity rows.

- [ ] **Step 2: Update docs (annotation terminology + new flag + schema)**

Edit the `protspace stats` / `prepare` sections and Output Format in `protspace/CLAUDE.md`, `docs/cli.md`, `README.md`, and the notebook stats cell:
- Document `--stats-annotation` (`auto` | comma-list) on both `prepare` and `stats`.
- Describe cluster-validity as **annotation-based** (silhouette/DBI/CH per annotation on embedding + projection) + ARI/NMI agreement; note the auto-cluster membership columns are retained but no longer self-scored.
- Note `statistics.parquet` gains the `annotation` column and `space_kind ∈ {projection, embedding}`.
- Update the `test_stats*` counts in the test-file table.

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "$(printf 'docs(stats): document annotation-based cluster-validity + --stats-annotation\n\nCo-Authored-By: Claude Fable 5 <noreply@anthropic.com>')"
```

---

## Self-Review

- **Spec coverage:** score space (embedding + projection) → Tasks 3+5; annotation selection + suitability → Task 2; `--stats-annotation` (auto/list, default auto, gated on --stats) → Tasks 6-7; ARI/NMI vs auto-clusters → Task 4; drop self-validity, keep membership + n_clusters → Task 4; schema `annotation` column + `space_kind=embedding` → Task 1; input dependencies (missing embedding/annotation skips only its part) → Tasks 3 (`requires_embedding=False`, empty-annotations guard) + 5 (embedding pass gated on `annotations`); docs/frontend note → Task 8 (frontend #296 + sample regeneration handled after merge, as the spec parks them). Gap/BIC out of scope → #64. Covered.
- **Placeholder scan:** Task 7's test references inputs "mirroring test_prepare_pipeline_compute_statistics" — the implementer copies that test's setup; acceptable since the exact fixture already exists in the file. All algorithmic code is complete.
- **Type consistency:** `build_annotation_labels(frame, selection, id_col)` and `compute_statistics(..., annotations=...)` and `StatContext(annotations=...)` and `StatRow(annotation=...)` are used identically across Tasks 1-7. `embedding_space` attribute set in Task 3, read in Task 5. `stat_family` values `annotation_validity` / `cluster_agreement` consistent between Tasks 3, 4, 6.

## Post-implementation (NOT part of this plan — resume the parked work)
1. Regenerate the 3FTx sample bundle with the new stats.
2. Update protspace_web#296 spec + post the concise body (still parked).
3. Update/regenerate and re-decide the `feat/projection-statistics` → main merge.
