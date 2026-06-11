# EAT Annotation-Transfer Backend Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `protlabel` embedding-annotation-transfer engine and a `protspace transfer` CLI subcommand that fills in missing annotation values for query proteins from their nearest reference neighbours in pLM embedding space, writing a per-cell prediction overlay back into the `.parquetbundle`.

**Architecture:** `protlabel` is a small, ProtSpace-agnostic package (numpy/scipy/h5py only) that does the kNN search + goPredSim reliability index + label transfer. `protspace transfer` is a thin Typer subcommand that reads a bundle + HDF5 embeddings, classifies query vs reference proteins, calls `protlabel`, and appends `<col>__pred_value` / `<col>__pred_confidence` / `<col>__pred_source` columns to the bundle's annotations table. Default = Euclidean, k=1. Optional gating/mining/report are out of scope for this MVP.

**Tech Stack:** Python ≥3.10, numpy, scipy (new dep), h5py, pyarrow, Typer, pytest, ruff, uv.

**Spec:** `docs/superpowers/specs/2026-06-11-eat-annotation-transfer-design.md`. The two refinements below override the spec where they differ (and the spec's §4/§10 are updated to match):
- **Packaging:** `protlabel` ships as a second top-level package *inside the protspace repo* (`src/protlabel/`), bundled into the protspace wheel — not a suite-level uv workspace member (the suite root is not a uv workspace, and a separate PyPI distribution would need its own release/CI). The strict no-`protspace`-imports boundary keeps a future standalone split trivial.
- **Overlay storage:** extra `*__pred_*` columns on the existing annotations table (bundle part 1), **not** a new 5th bundle part — this is backward-compatible with the currently-deployed web reader, which tolerates unknown columns but parses a fixed part count.

**Out of scope (follow-up plans):** the `protspace_web` frontend rendering (separate repo/PR), optional `--cutoff` gating, `--mine` neighborhood mining, `--report`/`--plots`/`--full-tables`, faiss-cpu ANN backend, ProtTucker learned distance.

**Conventions (enforced):** all Python via `uv run`; deps via `uv add` (never hand-edit `[project.dependencies]`); ruff clean; update docs + Colab notebook before committing; feature branch + PR, never push to `main`; commit prefixes — `feat:` only for user-visible changes, `chore:`/`test:`/`refactor:` for the rest.

---

## File Structure

**New package `protlabel` (`src/protlabel/`):**
- `src/protlabel/__init__.py` — public API: `eat`, `Lookup`, `Prediction`.
- `src/protlabel/reliability.py` — `similarity()`, the goPredSim distance→`[0,1]` transform.
- `src/protlabel/backends.py` — `nearest()`, chunked brute-force kNN (Euclidean/cosine).
- `src/protlabel/transfer.py` — `Prediction` dataclass + `eat()`/`transfer_labels()` (kNN → RI → label).
- `src/protlabel/lookup.py` — `Lookup` dataclass: build / `save` / `load` (sidecar `.npz`) / `query`.

**ProtSpace additions/changes:**
- Create `src/protspace/analysis/__init__.py`, `src/protspace/analysis/classification.py` — query/reference classifier.
- Create `src/protspace/data/io/predictions.py` — build overlay columns from predictions.
- Create `src/protspace/cli/transfer.py` — `run_transfer()` (pure) + the `transfer` Typer command.
- Modify `src/protspace/data/io/bundle.py` — add `replace_annotations_in_bundle()`.
- Modify `src/protspace/cli/app.py:65-73` — register the `transfer` subcommand.
- Modify `pyproject.toml` — add `[tool.hatch.build.targets.wheel] packages` (both packages); add `scipy` via `uv add`.

**Tests (all under `tests/`, run with `uv run pytest tests/`):**
- `tests/test_protlabel_reliability.py`, `tests/test_protlabel_backends.py`, `tests/test_protlabel_transfer.py`, `tests/test_protlabel_lookup.py`
- `tests/test_classification.py`, `tests/test_predictions_overlay.py`, `tests/test_bundle_overlay.py`, `tests/test_transfer_cli.py`

**Docs:**
- Modify `docs/cli.md`, `docs/annotations.md`, top-level `../CLAUDE.md` CLI table; add `notebooks/ProtSpace_Transfer.ipynb`.

---

## Task 1: Scaffold the `protlabel` package

**Files:**
- Create: `src/protlabel/__init__.py`
- Modify: `pyproject.toml` (hatchling packages + scipy dep)
- Test: `tests/test_protlabel_reliability.py` (placeholder import test, expanded in Task 2)

- [ ] **Step 1: Create the package marker with a version**

Create `src/protlabel/__init__.py`:

```python
"""protlabel — Embedding Annotation Transfer (EAT) engine.

Nearest-neighbour label transfer in protein-language-model embedding space,
with the goPredSim reliability index. Pure numpy/scipy/h5py; no protspace imports.
"""

__version__ = "0.1.0"
```

- [ ] **Step 2: Tell hatchling to build both packages**

Edit `pyproject.toml`. After the `[build-system]` block (around line 71), add:

```toml
[tool.hatch.build.targets.wheel]
packages = ["src/protspace", "src/protlabel"]
```

- [ ] **Step 3: Add the scipy dependency (via uv, not by hand)**

Run: `uv add 'scipy>=1.10'`
Expected: `pyproject.toml` gains `scipy>=1.10` in `[project.dependencies]` and `uv.lock` updates.

- [ ] **Step 4: Sync so `import protlabel` resolves**

Run: `uv sync`
Then verify: `uv run python -c "import protlabel; print(protlabel.__version__)"`
Expected: prints `0.1.0`

- [ ] **Step 5: Write a smoke test**

Create `tests/test_protlabel_reliability.py`:

```python
"""Tests for protlabel.reliability."""


def test_protlabel_imports():
    import protlabel

    assert protlabel.__version__
```

- [ ] **Step 6: Run the smoke test**

Run: `uv run pytest tests/test_protlabel_reliability.py -v`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add src/protlabel/__init__.py pyproject.toml uv.lock tests/test_protlabel_reliability.py
git commit -m "chore(protlabel): scaffold EAT engine package + scipy dep"
```

---

## Task 2: Reliability index (`protlabel.reliability`)

**Files:**
- Create: `src/protlabel/reliability.py`
- Test: `tests/test_protlabel_reliability.py`

- [ ] **Step 1: Write the failing tests**

Replace `tests/test_protlabel_reliability.py` with:

```python
"""Tests for protlabel.reliability."""

import math

import pytest

from protlabel.reliability import similarity


def test_euclidean_at_zero_distance_is_one():
    assert similarity(0.0, "euclidean") == pytest.approx(1.0)


def test_euclidean_at_half_distance_is_half():
    assert similarity(0.5, "euclidean") == pytest.approx(0.5)


def test_euclidean_decreases_to_zero():
    assert similarity(1e9, "euclidean") == pytest.approx(0.0, abs=1e-6)


def test_cosine_is_one_minus_distance():
    assert similarity(0.2, "cosine") == pytest.approx(0.8)


def test_cosine_clamped_to_unit_interval():
    # cosine distance can be up to 2.0 -> 1 - d would go negative; clamp at 0
    assert similarity(1.7, "cosine") == pytest.approx(0.0)
    assert similarity(-0.1, "cosine") == pytest.approx(1.0)


def test_unknown_metric_raises():
    with pytest.raises(ValueError):
        similarity(0.5, "manhattan")


def test_smoke():
    assert math.isfinite(similarity(0.5, "euclidean"))
```

- [ ] **Step 2: Run to verify failure**

Run: `uv run pytest tests/test_protlabel_reliability.py -v`
Expected: FAIL — `ImportError: cannot import name 'similarity'`

- [ ] **Step 3: Implement**

Create `src/protlabel/reliability.py`:

```python
"""goPredSim reliability index: map an embedding distance to a [0,1] confidence.

Euclidean:  s(d) = 0.5 / (0.5 + d)   (1.0 at d=0, 0.5 at d=0.5, ->0 as d->inf)
Cosine:     s(d) = 1 - d             (clamped to [0,1]; cosine distance in [0,2])

Reference: Littmann et al., Sci Rep 2021 (Eq. 5); goPredSim calc_reliability_index.
"""

from __future__ import annotations


def similarity(distance: float, metric: str) -> float:
    """Per-neighbour distance->similarity (the goPredSim reliability transform)."""
    if metric == "euclidean":
        return 0.5 / (0.5 + distance)
    if metric == "cosine":
        return min(1.0, max(0.0, 1.0 - distance))
    raise ValueError(f"Unknown metric {metric!r}; expected 'euclidean' or 'cosine'")
```

- [ ] **Step 4: Run to verify pass**

Run: `uv run pytest tests/test_protlabel_reliability.py -v`
Expected: PASS (all 7)

- [ ] **Step 5: Lint + commit**

```bash
uv run ruff check src/protlabel/reliability.py tests/test_protlabel_reliability.py
git add src/protlabel/reliability.py tests/test_protlabel_reliability.py
git commit -m "feat(protlabel): goPredSim reliability index transform"
```

---

## Task 3: Brute-force kNN backend (`protlabel.backends`)

**Files:**
- Create: `src/protlabel/backends.py`
- Test: `tests/test_protlabel_backends.py`

- [ ] **Step 1: Write the failing tests**

Create `tests/test_protlabel_backends.py`:

```python
"""Tests for protlabel.backends.nearest."""

import numpy as np
import pytest

from protlabel.backends import nearest


def _toy():
    # 3 references on a line; queries close to ref 0 and ref 2
    refs = np.array([[0.0, 0.0], [10.0, 0.0], [20.0, 0.0]], dtype=np.float32)
    queries = np.array([[0.1, 0.0], [19.5, 0.0]], dtype=np.float32)
    return queries, refs


def test_returns_shapes():
    queries, refs = _toy()
    idx, dist = nearest(queries, refs, k=2, metric="euclidean")
    assert idx.shape == (2, 2)
    assert dist.shape == (2, 2)


def test_nearest_index_euclidean():
    queries, refs = _toy()
    idx, dist = nearest(queries, refs, k=1, metric="euclidean")
    assert idx[0, 0] == 0  # first query nearest to ref 0
    assert idx[1, 0] == 2  # second query nearest to ref 2
    assert dist[0, 0] == pytest.approx(0.1, abs=1e-4)


def test_neighbours_sorted_by_distance():
    queries, refs = _toy()
    idx, dist = nearest(queries, refs, k=3, metric="euclidean")
    assert np.all(np.diff(dist, axis=1) >= -1e-6)  # non-decreasing per row


def test_cosine_metric_runs_and_orders():
    refs = np.array([[1.0, 0.0], [0.0, 1.0]], dtype=np.float32)
    queries = np.array([[1.0, 0.1]], dtype=np.float32)  # closest in angle to ref 0
    idx, dist = nearest(queries, refs, k=1, metric="cosine")
    assert idx[0, 0] == 0


def test_k_capped_to_num_refs():
    queries, refs = _toy()
    idx, dist = nearest(queries, refs, k=10, metric="euclidean")
    assert idx.shape == (2, 3)  # only 3 refs available


def test_chunking_matches_unchunked():
    rng = np.random.default_rng(0)
    refs = rng.standard_normal((50, 8)).astype(np.float32)
    queries = rng.standard_normal((7, 8)).astype(np.float32)
    a_idx, a_dist = nearest(queries, refs, k=3, metric="euclidean", chunk=1000)
    b_idx, b_dist = nearest(queries, refs, k=3, metric="euclidean", chunk=3)
    assert np.array_equal(a_idx, b_idx)
    assert np.allclose(a_dist, b_dist, atol=1e-5)


def test_unknown_metric_raises():
    queries, refs = _toy()
    with pytest.raises(ValueError):
        nearest(queries, refs, k=1, metric="manhattan")
```

- [ ] **Step 2: Run to verify failure**

Run: `uv run pytest tests/test_protlabel_backends.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'protlabel.backends'`

- [ ] **Step 3: Implement**

Create `src/protlabel/backends.py`:

```python
"""Exact (brute-force) k-nearest-neighbour search over reference embeddings.

Chunked over the query axis so the Q_chunk x N distance block stays small,
which keeps peak memory near the reference matrix itself even at Swiss-Prot
scale. scipy.cdist handles both euclidean and cosine.
"""

from __future__ import annotations

import numpy as np
from scipy.spatial.distance import cdist

_METRICS = {"euclidean", "cosine"}


def nearest(
    queries: np.ndarray,
    refs: np.ndarray,
    k: int,
    metric: str = "euclidean",
    chunk: int = 4096,
) -> tuple[np.ndarray, np.ndarray]:
    """Return (idx, dist) of the k nearest *references* per query.

    idx[i]  -> indices into ``refs`` of the k nearest, ascending by distance.
    dist[i] -> the corresponding distances.
    k is capped to the number of references.
    """
    if metric not in _METRICS:
        raise ValueError(f"Unknown metric {metric!r}; expected one of {_METRICS}")

    queries = np.ascontiguousarray(queries, dtype=np.float32)
    refs = np.ascontiguousarray(refs, dtype=np.float32)
    n_refs = refs.shape[0]
    k = min(k, n_refs)

    idx_out = np.empty((queries.shape[0], k), dtype=np.int64)
    dist_out = np.empty((queries.shape[0], k), dtype=np.float32)

    for start in range(0, queries.shape[0], chunk):
        block = queries[start : start + chunk]
        d = cdist(block, refs, metric=metric).astype(np.float32)  # (b, n_refs)
        part = np.argpartition(d, kth=k - 1, axis=1)[:, :k]  # unsorted top-k
        rows = np.arange(block.shape[0])[:, None]
        part_d = d[rows, part]
        order = np.argsort(part_d, axis=1)  # sort the k by distance
        sorted_idx = part[rows, order]
        idx_out[start : start + block.shape[0]] = sorted_idx
        dist_out[start : start + block.shape[0]] = d[rows, sorted_idx]

    return idx_out, dist_out
```

- [ ] **Step 4: Run to verify pass**

Run: `uv run pytest tests/test_protlabel_backends.py -v`
Expected: PASS (all 7)

- [ ] **Step 5: Lint + commit**

```bash
uv run ruff check src/protlabel/backends.py tests/test_protlabel_backends.py
git add src/protlabel/backends.py tests/test_protlabel_backends.py
git commit -m "feat(protlabel): chunked brute-force kNN backend"
```

---

## Task 4: Label transfer + Prediction (`protlabel.transfer`)

**Files:**
- Create: `src/protlabel/transfer.py`
- Test: `tests/test_protlabel_transfer.py`

- [ ] **Step 1: Write the failing tests**

Create `tests/test_protlabel_transfer.py`:

```python
"""Tests for protlabel.transfer."""

import numpy as np
import pytest

from protlabel.transfer import Prediction, eat


def _setup():
    ref_emb = np.array([[0.0, 0.0], [10.0, 0.0], [20.0, 0.0]], dtype=np.float32)
    ref_ids = ["R0", "R1", "R2"]
    ref_labels = ["toxin", "enzyme", "toxin"]
    query_emb = np.array([[0.0, 0.0], [19.7, 0.0]], dtype=np.float32)
    query_ids = ["Q0", "Q1"]
    return ref_emb, ref_ids, ref_labels, query_emb, query_ids


def test_k1_transfers_nearest_label_and_source():
    ref_emb, ref_ids, ref_labels, query_emb, query_ids = _setup()
    preds = eat(query_emb, query_ids, ref_emb, ref_ids, ref_labels, k=1)
    assert isinstance(preds[0], Prediction)
    assert preds[0].query_id == "Q0"
    assert preds[0].label == "toxin"
    assert preds[0].source_id == "R0"
    assert preds[0].reliability == pytest.approx(1.0)  # distance 0 -> RI 1.0


def test_k1_reliability_uses_gopredsim_transform():
    ref_emb, ref_ids, ref_labels, query_emb, query_ids = _setup()
    preds = eat(query_emb, query_ids, ref_emb, ref_ids, ref_labels, k=1)
    # Q1 distance to R2 is 0.3 -> RI = 0.5/(0.5+0.3)
    assert preds[1].label == "toxin"
    assert preds[1].source_id == "R2"
    assert preds[1].reliability == pytest.approx(0.5 / 0.8, abs=1e-4)


def test_k3_vote_picks_majority_label():
    # Query equidistant-ish but two of three nearest are "toxin"
    ref_emb = np.array(
        [[0.0, 0.0], [1.0, 0.0], [2.0, 0.0], [3.0, 0.0]], dtype=np.float32
    )
    ref_ids = ["R0", "R1", "R2", "R3"]
    ref_labels = ["toxin", "enzyme", "toxin", "toxin"]
    query_emb = np.array([[1.4, 0.0]], dtype=np.float32)
    preds = eat(query_emb, ["Q"], ref_emb, ref_ids, ref_labels, k=3)
    assert preds[0].label == "toxin"  # toxin RI sum beats lone enzyme neighbour
    assert 0.0 < preds[0].reliability <= 1.0


def test_cosine_metric():
    ref_emb = np.array([[1.0, 0.0], [0.0, 1.0]], dtype=np.float32)
    preds = eat(
        np.array([[1.0, 0.05]], dtype=np.float32),
        ["Q"],
        ref_emb,
        ["R0", "R1"],
        ["a", "b"],
        k=1,
        metric="cosine",
    )
    assert preds[0].label == "a"


def test_length_mismatch_raises():
    ref_emb, ref_ids, ref_labels, query_emb, query_ids = _setup()
    with pytest.raises(ValueError):
        eat(query_emb, query_ids, ref_emb, ref_ids, ref_labels[:-1], k=1)


def test_empty_references_raises():
    with pytest.raises(ValueError):
        eat(
            np.zeros((1, 2), dtype=np.float32),
            ["Q"],
            np.zeros((0, 2), dtype=np.float32),
            [],
            [],
            k=1,
        )
```

- [ ] **Step 2: Run to verify failure**

Run: `uv run pytest tests/test_protlabel_transfer.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'protlabel.transfer'`

- [ ] **Step 3: Implement**

Create `src/protlabel/transfer.py`:

```python
"""Embedding annotation transfer: kNN -> reliability index -> transferred label.

Implements the goPredSim aggregation (Littmann et al. 2021, Eq. 5):
    RI(p) = (1/k) * sum over neighbours carrying label p of similarity(d).
The transferred label is argmax RI(p); its source is the nearest neighbour
carrying that label.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np

from protlabel.backends import nearest
from protlabel.reliability import similarity


@dataclass(frozen=True)
class Prediction:
    """One transferred annotation for a query protein."""

    query_id: str
    label: str
    source_id: str
    distance: float
    reliability: float
    k: int
    metric: str


def eat(
    query_emb: np.ndarray,
    query_ids: list[str],
    ref_emb: np.ndarray,
    ref_ids: list[str],
    ref_labels: list[str],
    *,
    k: int = 1,
    metric: str = "euclidean",
) -> list[Prediction]:
    """Transfer the best-guess label to each query from its k nearest references."""
    if not (len(ref_ids) == len(ref_labels) == ref_emb.shape[0]):
        raise ValueError("ref_emb, ref_ids and ref_labels must have equal length")
    if ref_emb.shape[0] == 0:
        raise ValueError("No reference embeddings to transfer from")
    if len(query_ids) != query_emb.shape[0]:
        raise ValueError("query_emb and query_ids must have equal length")

    idx, dist = nearest(query_emb, ref_emb, k=k, metric=metric)
    eff_k = idx.shape[1]
    predictions: list[Prediction] = []

    for qi, query_id in enumerate(query_ids):
        neigh_idx = idx[qi]
        neigh_dist = dist[qi]
        # Accumulate RI per label and track the nearest source per label.
        ri_by_label: dict[str, float] = {}
        nearest_src: dict[str, tuple[float, str]] = {}
        for j, ref_i in enumerate(neigh_idx):
            lab = ref_labels[ref_i]
            d = float(neigh_dist[j])
            ri_by_label[lab] = ri_by_label.get(lab, 0.0) + similarity(d, metric)
            if lab not in nearest_src or d < nearest_src[lab][0]:
                nearest_src[lab] = (d, ref_ids[ref_i])
        # Normalise by k (the goPredSim 1/k term).
        best_label = max(ri_by_label, key=lambda p: ri_by_label[p])
        ri = ri_by_label[best_label] / eff_k
        src_dist, src_id = nearest_src[best_label]
        predictions.append(
            Prediction(
                query_id=query_id,
                label=best_label,
                source_id=src_id,
                distance=src_dist,
                reliability=ri,
                k=eff_k,
                metric=metric,
            )
        )

    return predictions
```

- [ ] **Step 4: Run to verify pass**

Run: `uv run pytest tests/test_protlabel_transfer.py -v`
Expected: PASS (all 6)

- [ ] **Step 5: Lint + commit**

```bash
uv run ruff check src/protlabel/transfer.py tests/test_protlabel_transfer.py
git add src/protlabel/transfer.py tests/test_protlabel_transfer.py
git commit -m "feat(protlabel): kNN label transfer with reliability index"
```

---

## Task 5: Persistable lookup (`protlabel.lookup`) + public API

**Files:**
- Create: `src/protlabel/lookup.py`
- Modify: `src/protlabel/__init__.py`
- Test: `tests/test_protlabel_lookup.py`

- [ ] **Step 1: Write the failing tests**

Create `tests/test_protlabel_lookup.py`:

```python
"""Tests for protlabel.lookup.Lookup (the rebuildable sidecar)."""

import numpy as np

from protlabel import Lookup, Prediction


def _lookup():
    emb = np.array([[0.0, 0.0], [10.0, 0.0]], dtype=np.float32)
    return Lookup(embeddings=emb, ids=["R0", "R1"], labels=["a", "b"])


def test_query_returns_predictions():
    lk = _lookup()
    preds = lk.query(np.array([[0.2, 0.0]], dtype=np.float32), ["Q0"], k=1)
    assert isinstance(preds[0], Prediction)
    assert preds[0].label == "a"
    assert preds[0].source_id == "R0"


def test_save_load_roundtrip(tmp_path):
    lk = _lookup()
    path = tmp_path / "lookup.npz"
    lk.save(path)
    assert path.exists()
    loaded = Lookup.load(path)
    assert loaded.ids == lk.ids
    assert loaded.labels == lk.labels
    assert loaded.metric == lk.metric
    assert np.allclose(loaded.embeddings, lk.embeddings)


def test_loaded_lookup_queries_identically(tmp_path):
    lk = _lookup()
    q = np.array([[9.8, 0.0]], dtype=np.float32)
    before = lk.query(q, ["Q"], k=1)
    path = tmp_path / "lk.npz"
    lk.save(path)
    after = Lookup.load(path).query(q, ["Q"], k=1)
    assert before[0].label == after[0].label == "b"
    assert before[0].reliability == after[0].reliability
```

- [ ] **Step 2: Run to verify failure**

Run: `uv run pytest tests/test_protlabel_lookup.py -v`
Expected: FAIL — `ImportError: cannot import name 'Lookup' from 'protlabel'`

- [ ] **Step 3: Implement the Lookup**

Create `src/protlabel/lookup.py`:

```python
"""A persistable reference lookup: embeddings + ids + labels, plus query().

Serialized as a single .npz sidecar so it can live next to a bundle or in a
cache dir and be rebuilt on demand from the source HDF5.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path

import numpy as np

from protlabel.transfer import Prediction, eat


@dataclass
class Lookup:
    """Reference set for embedding annotation transfer."""

    embeddings: np.ndarray  # (N, D) float32
    ids: list[str]
    labels: list[str]
    metric: str = "euclidean"
    model: str = field(default="")

    def query(
        self, query_emb: np.ndarray, query_ids: list[str], *, k: int = 1
    ) -> list[Prediction]:
        """Transfer labels to query embeddings from this lookup."""
        return eat(
            query_emb,
            query_ids,
            self.embeddings,
            self.ids,
            self.labels,
            k=k,
            metric=self.metric,
        )

    def save(self, path: Path) -> None:
        """Serialize to a .npz sidecar."""
        path = Path(path)
        path.parent.mkdir(parents=True, exist_ok=True)
        np.savez(
            path,
            embeddings=self.embeddings.astype(np.float16),
            ids=np.array(self.ids, dtype=object),
            labels=np.array(self.labels, dtype=object),
            metric=self.metric,
            model=self.model,
        )

    @classmethod
    def load(cls, path: Path) -> Lookup:
        """Load a .npz sidecar (re-upcasts embeddings to float32)."""
        with np.load(path, allow_pickle=True) as data:
            return cls(
                embeddings=data["embeddings"].astype(np.float32),
                ids=list(data["ids"]),
                labels=list(data["labels"]),
                metric=str(data["metric"]),
                model=str(data["model"]),
            )
```

> Note: `np.savez` appends `.npz` if the path has no extension; the tests use an explicit `.npz` so the saved file matches the requested path.

- [ ] **Step 4: Export the public API**

Replace `src/protlabel/__init__.py` with:

```python
"""protlabel — Embedding Annotation Transfer (EAT) engine.

Nearest-neighbour label transfer in protein-language-model embedding space,
with the goPredSim reliability index. Pure numpy/scipy/h5py; no protspace imports.
"""

from protlabel.lookup import Lookup
from protlabel.transfer import Prediction, eat

__version__ = "0.1.0"

__all__ = ["Lookup", "Prediction", "eat", "__version__"]
```

- [ ] **Step 5: Run to verify pass**

Run: `uv run pytest tests/test_protlabel_lookup.py -v`
Expected: PASS (all 3)

- [ ] **Step 6: Run the whole protlabel suite + guard the boundary**

Run: `uv run pytest tests/test_protlabel_*.py -v`
Expected: PASS
Run: `! grep -rqE "import protspace|from protspace" src/protlabel/ && echo "boundary clean"`
Expected: prints `boundary clean` (protlabel must not import protspace)

- [ ] **Step 7: Lint + commit**

```bash
uv run ruff check src/protlabel/ tests/test_protlabel_lookup.py
git add src/protlabel/lookup.py src/protlabel/__init__.py tests/test_protlabel_lookup.py
git commit -m "feat(protlabel): persistable Lookup sidecar + public API"
```

---

## Task 6: Query/reference classifier (`protspace.analysis.classification`)

**Files:**
- Create: `src/protspace/analysis/__init__.py`, `src/protspace/analysis/classification.py`
- Test: `tests/test_classification.py`

- [ ] **Step 1: Write the failing tests**

Create `tests/test_classification.py`:

```python
"""Tests for the query/reference classifier."""

import pyarrow as pa
import pytest

from protspace.analysis.classification import Rule, classify


def _table():
    return pa.table(
        {
            "identifier": ["TRINITY_1", "TRINITY_2", "P00001", "P00002"],
            "protein_category": ["mSCR", "mSCR", "neurotoxin", "enzyme"],
        }
    )


def test_prefix_rule_selects_queries():
    q = Rule(id_prefixes=["TRINITY_"])
    r = Rule(where=[("protein_category", "neurotoxin")])
    qi, ri = classify(_table(), q, r)
    assert qi == [0, 1]
    assert ri == [2]


def test_where_substring_is_case_insensitive():
    q = Rule(where=[("protein_category", "MSCR")])
    r = Rule(id_prefixes=["P0"])
    qi, ri = classify(_table(), q, r)
    assert qi == [0, 1]
    assert ri == [2, 3]


def test_query_takes_precedence_over_reference():
    # A protein matching both rules is classified as a query, never a reference.
    q = Rule(id_prefixes=["P00001"])
    r = Rule(where=[("protein_category", "neurotoxin")])
    qi, ri = classify(_table(), q, r)
    assert 2 in qi
    assert 2 not in ri


def test_empty_query_match_raises():
    q = Rule(id_prefixes=["NOPE_"])
    r = Rule(id_prefixes=["P0"])
    with pytest.raises(ValueError, match="no query"):
        classify(_table(), q, r)


def test_missing_where_column_raises():
    q = Rule(where=[("not_a_column", "x")])
    r = Rule(id_prefixes=["P0"])
    with pytest.raises(KeyError):
        classify(_table(), q, r)
```

- [ ] **Step 2: Run to verify failure**

Run: `uv run pytest tests/test_classification.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'protspace.analysis'`

- [ ] **Step 3: Implement**

Create `src/protspace/analysis/__init__.py`:

```python
"""Optional analysis layer for ProtSpace (classification, gating, mining)."""
```

Create `src/protspace/analysis/classification.py`:

```python
"""Classify proteins as transfer queries vs annotated references.

Rules match by ID prefix and/or a case-insensitive metadata substring
(``column ~ substring``). No biology is hardcoded; a query rule that matches
nothing is an error.
"""

from __future__ import annotations

from dataclasses import dataclass, field

import pyarrow as pa


@dataclass
class Rule:
    """A classification rule. A protein matches if ANY clause matches."""

    id_prefixes: list[str] = field(default_factory=list)
    where: list[tuple[str, str]] = field(default_factory=list)  # (column, substring)


def _matches(rule: Rule, identifier: str, row: dict[str, str]) -> bool:
    if any(identifier.startswith(p) for p in rule.id_prefixes):
        return True
    for column, substring in rule.where:
        if column not in row:
            raise KeyError(f"Classification column {column!r} not in annotations")
        value = row[column]
        if value is not None and substring.lower() in str(value).lower():
            return True
    return False


def classify(
    annotations: pa.Table, query_rule: Rule, reference_rule: Rule
) -> tuple[list[int], list[int]]:
    """Return (query_indices, reference_indices) into the annotations table.

    Query classification takes precedence: a protein matching both rules is a
    query. Raises ValueError if the query rule matches nothing.
    """
    columns = set(annotations.column_names)
    # Validate where-columns up front so an empty table still raises KeyError.
    for rule in (query_rule, reference_rule):
        for column, _ in rule.where:
            if column not in columns:
                raise KeyError(f"Classification column {column!r} not in annotations")

    rows = annotations.to_pylist()
    identifiers = [str(r["identifier"]) for r in rows]

    query_indices: list[int] = []
    reference_indices: list[int] = []
    for i, (identifier, row) in enumerate(zip(identifiers, rows, strict=True)):
        if _matches(query_rule, identifier, row):
            query_indices.append(i)
        elif _matches(reference_rule, identifier, row):
            reference_indices.append(i)

    if not query_indices:
        raise ValueError(
            "Classifier matched no query proteins; check --query-id-prefix / "
            "--query-where rules."
        )
    return query_indices, reference_indices
```

- [ ] **Step 4: Run to verify pass**

Run: `uv run pytest tests/test_classification.py -v`
Expected: PASS (all 5)

- [ ] **Step 5: Lint + commit**

```bash
uv run ruff check src/protspace/analysis/ tests/test_classification.py
git add src/protspace/analysis/ tests/test_classification.py
git commit -m "feat: query/reference classifier for annotation transfer"
```

---

## Task 7: Build the overlay columns (`protspace.data.io.predictions`)

**Files:**
- Create: `src/protspace/data/io/predictions.py`
- Test: `tests/test_predictions_overlay.py`

- [ ] **Step 1: Write the failing tests**

Create `tests/test_predictions_overlay.py`:

```python
"""Tests for building the per-cell prediction overlay columns."""

import pyarrow as pa

from protlabel import Prediction
from protspace.data.io.predictions import add_overlay_columns


def _table():
    return pa.table(
        {
            "identifier": ["Q0", "Q1", "R0"],
            "protein_category": ["", "", "neurotoxin"],
        }
    )


def test_adds_three_overlay_columns():
    preds = [
        Prediction("Q0", "neurotoxin", "R0", 0.3, 0.62, 1, "euclidean"),
    ]
    out = add_overlay_columns(_table(), "protein_category", preds)
    assert "protein_category__pred_value" in out.column_names
    assert "protein_category__pred_confidence" in out.column_names
    assert "protein_category__pred_source" in out.column_names


def test_overlay_values_aligned_by_identifier():
    preds = [Prediction("Q1", "enzyme", "R9", 0.5, 0.5, 1, "euclidean")]
    out = add_overlay_columns(_table(), "protein_category", preds).to_pylist()
    by_id = {r["identifier"]: r for r in out}
    assert by_id["Q1"]["protein_category__pred_value"] == "enzyme"
    assert by_id["Q1"]["protein_category__pred_confidence"] == 0.5
    assert by_id["Q1"]["protein_category__pred_source"] == "R9"
    # Non-predicted rows are null in the overlay columns.
    assert by_id["Q0"]["protein_category__pred_value"] is None
    assert by_id["R0"]["protein_category__pred_confidence"] is None


def test_curated_column_is_left_untouched():
    preds = [Prediction("Q0", "neurotoxin", "R0", 0.1, 0.8, 1, "euclidean")]
    out = add_overlay_columns(_table(), "protein_category", preds).to_pylist()
    by_id = {r["identifier"]: r for r in out}
    assert by_id["Q0"]["protein_category"] == ""  # original column unchanged
    assert by_id["R0"]["protein_category"] == "neurotoxin"


def test_confidence_column_is_float():
    preds = [Prediction("Q0", "x", "R0", 0.1, 0.83, 1, "euclidean")]
    out = add_overlay_columns(_table(), "protein_category", preds)
    field = out.schema.field("protein_category__pred_confidence")
    assert pa.types.is_floating(field.type)
```

- [ ] **Step 2: Run to verify failure**

Run: `uv run pytest tests/test_predictions_overlay.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'protspace.data.io.predictions'`

- [ ] **Step 3: Implement**

Create `src/protspace/data/io/predictions.py`:

```python
"""Turn protlabel Predictions into per-cell overlay columns on the annotations table.

For a transferred column ``COL`` we append three aligned columns (null for
non-predicted proteins), leaving the curated ``COL`` untouched:
    COL__pred_value       (string)  the transferred label
    COL__pred_confidence  (float32) the reliability index in [0, 1]
    COL__pred_source      (string)  the nearest reference protein id
"""

from __future__ import annotations

from collections.abc import Sequence

import pyarrow as pa

from protlabel import Prediction


def add_overlay_columns(
    annotations: pa.Table, column: str, predictions: Sequence[Prediction]
) -> pa.Table:
    """Append the COL__pred_* overlay columns, aligned by identifier."""
    by_query = {p.query_id: p for p in predictions}
    identifiers = [str(v) for v in annotations.column("identifier").to_pylist()]

    values: list[str | None] = []
    confidences: list[float | None] = []
    sources: list[str | None] = []
    for identifier in identifiers:
        pred = by_query.get(identifier)
        if pred is None:
            values.append(None)
            confidences.append(None)
            sources.append(None)
        else:
            values.append(pred.label)
            confidences.append(float(pred.reliability))
            sources.append(pred.source_id)

    out = annotations
    out = out.append_column(f"{column}__pred_value", pa.array(values, pa.string()))
    out = out.append_column(
        f"{column}__pred_confidence", pa.array(confidences, pa.float32())
    )
    out = out.append_column(f"{column}__pred_source", pa.array(sources, pa.string()))
    return out
```

- [ ] **Step 4: Run to verify pass**

Run: `uv run pytest tests/test_predictions_overlay.py -v`
Expected: PASS (all 4)

- [ ] **Step 5: Lint + commit**

```bash
uv run ruff check src/protspace/data/io/predictions.py tests/test_predictions_overlay.py
git add src/protspace/data/io/predictions.py tests/test_predictions_overlay.py
git commit -m "feat: build per-cell prediction overlay columns"
```

---

## Task 8: Rewrite the annotations part of a bundle (`bundle.replace_annotations_in_bundle`)

**Files:**
- Modify: `src/protspace/data/io/bundle.py`
- Test: `tests/test_bundle_overlay.py`

- [ ] **Step 1: Write the failing tests**

Create `tests/test_bundle_overlay.py`:

```python
"""Round-trip tests for replacing the annotations part of a bundle."""

import io

import pyarrow as pa
import pyarrow.parquet as pq

from protspace.data.io.bundle import (
    read_bundle,
    replace_annotations_in_bundle,
    write_bundle,
)


def _tables():
    annotations = pa.table({"identifier": ["A", "B"], "cat": ["x", "y"]})
    proj_meta = pa.table({"name": ["PCA 2"], "dims": [2]})
    proj_data = pa.table({"id": ["A", "B"], "x": [0.0, 1.0], "y": [0.0, 1.0]})
    return [annotations, proj_meta, proj_data]


def _read_part(part_bytes):
    return pq.read_table(io.BytesIO(part_bytes))


def test_replaces_annotations_keeps_other_parts(tmp_path):
    src = tmp_path / "in.parquetbundle"
    out = tmp_path / "out.parquetbundle"
    write_bundle(_tables(), src)

    new_annotations = pa.table(
        {"identifier": ["A", "B"], "cat": ["x", "y"], "cat__pred_value": [None, "z"]}
    )
    replace_annotations_in_bundle(src, out, new_annotations)

    parts, settings = read_bundle(out)
    assert "cat__pred_value" in _read_part(parts[0]).column_names
    # Projections preserved byte-for-byte.
    assert _read_part(parts[1]).column_names == ["name", "dims"]
    assert _read_part(parts[2]).to_pydict()["x"] == [0.0, 1.0]


def test_preserves_settings_when_present(tmp_path):
    src = tmp_path / "in.parquetbundle"
    out = tmp_path / "out.parquetbundle"
    write_bundle(_tables(), src, settings={"foo": 1})

    new_annotations = pa.table({"identifier": ["A", "B"], "cat": ["x", "y"]})
    replace_annotations_in_bundle(src, out, new_annotations)

    _parts, settings = read_bundle(out)
    assert settings == {"foo": 1}
```

- [ ] **Step 2: Run to verify failure**

Run: `uv run pytest tests/test_bundle_overlay.py -v`
Expected: FAIL — `ImportError: cannot import name 'replace_annotations_in_bundle'`

- [ ] **Step 3: Implement**

Add to `src/protspace/data/io/bundle.py` (after `replace_settings_in_bundle`, around line 149):

```python
def replace_annotations_in_bundle(
    input_path: Path,
    output_path: Path,
    annotations_table: pa.Table,
) -> None:
    """Replace the annotations (1st) part of a bundle, preserving the rest.

    Projection parts (2nd, 3rd) are kept byte-for-byte; an existing settings
    (4th) part is carried over unchanged.
    """
    with open(input_path, "rb") as f:
        content = f.read()

    parts = content.split(PARQUET_BUNDLE_DELIMITER)
    if len(parts) < 3 or len(parts) > 4:
        raise ValueError(f"Expected 3 or 4 parts in parquetbundle, found {len(parts)}")

    buf = io.BytesIO()
    pq.write_table(annotations_table, buf)
    new_parts = [buf.getvalue(), parts[1], parts[2]]
    if len(parts) == 4:
        new_parts.append(parts[3])

    output_path.parent.mkdir(parents=True, exist_ok=True)
    with open(output_path, "wb") as f:
        f.write(PARQUET_BUNDLE_DELIMITER.join(new_parts))

    logger.info(f"Wrote bundle with updated annotations to: {output_path}")
```

- [ ] **Step 4: Run to verify pass**

Run: `uv run pytest tests/test_bundle_overlay.py -v`
Expected: PASS (both)

- [ ] **Step 5: Lint + commit**

```bash
uv run ruff check src/protspace/data/io/bundle.py tests/test_bundle_overlay.py
git add src/protspace/data/io/bundle.py tests/test_bundle_overlay.py
git commit -m "feat: replace annotations part of a parquetbundle in place"
```

---

## Task 9: The `transfer` orchestration core + CLI (`protspace.cli.transfer`)

**Files:**
- Create: `src/protspace/cli/transfer.py`
- Modify: `src/protspace/cli/app.py:65-73`
- Test: `tests/test_transfer_cli.py`

- [ ] **Step 1: Write the failing tests (pure core + registration)**

Create `tests/test_transfer_cli.py`:

```python
"""Tests for the transfer orchestration core and CLI registration."""

import numpy as np
import pyarrow as pa
import pytest

from protspace.analysis.classification import Rule
from protspace.cli.transfer import run_transfer


def _inputs():
    annotations = pa.table(
        {
            "identifier": ["TRINITY_1", "P00001", "P00002"],
            "protein_category": ["", "neurotoxin", "enzyme"],
        }
    )
    # TRINITY_1 sits right on top of the neurotoxin reference P00001.
    embeddings = {
        "TRINITY_1": np.array([0.0, 0.0], dtype=np.float32),
        "P00001": np.array([0.05, 0.0], dtype=np.float32),
        "P00002": np.array([9.0, 0.0], dtype=np.float32),
    }
    return annotations, embeddings


def test_run_transfer_predicts_for_query_with_missing_value():
    annotations, embeddings = _inputs()
    out = run_transfer(
        annotations=annotations,
        embeddings=embeddings,
        transfer_columns=["protein_category"],
        query_rule=Rule(id_prefixes=["TRINITY_"]),
        reference_rule=Rule(where=[("protein_category", "")]),  # any non-empty ref
        k=1,
        metric="euclidean",
    )
    by_id = {r["identifier"]: r for r in out.to_pylist()}
    assert by_id["TRINITY_1"]["protein_category__pred_value"] == "neurotoxin"
    assert by_id["TRINITY_1"]["protein_category__pred_source"] == "P00001"
    assert by_id["TRINITY_1"]["protein_category__pred_confidence"] > 0.9


def test_run_transfer_skips_proteins_without_embeddings():
    annotations, embeddings = _inputs()
    embeddings.pop("TRINITY_1")  # no embedding -> cannot be a query
    with pytest.raises(ValueError, match="no query"):
        run_transfer(
            annotations=annotations,
            embeddings=embeddings,
            transfer_columns=["protein_category"],
            query_rule=Rule(id_prefixes=["TRINITY_"]),
            reference_rule=Rule(id_prefixes=["P0"]),
            k=1,
            metric="euclidean",
        )


def test_transfer_command_is_registered():
    from typer.testing import CliRunner

    from protspace.cli.app import app

    result = CliRunner().invoke(app, ["transfer", "--help"])
    assert result.exit_code == 0
    assert "transfer" in result.output.lower()
```

- [ ] **Step 2: Run to verify failure**

Run: `uv run pytest tests/test_transfer_cli.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'protspace.cli.transfer'`

- [ ] **Step 3: Implement the core + command**

Create `src/protspace/cli/transfer.py`:

```python
"""protspace transfer — fill missing annotation values from nearest references.

Embedding Annotation Transfer (EAT): for each query protein with a missing
value in a target column, transfer the value of its nearest annotated
reference in pLM embedding space, with a reliability-index confidence.
"""

from __future__ import annotations

import logging
from pathlib import Path
from typing import Annotated

import numpy as np
import pyarrow as pa
import typer

from protspace.cli.app import app, setup_logging
from protspace.cli.common_options import Opt_Verbose

logger = logging.getLogger(__name__)


def _is_missing(value) -> bool:
    return value is None or str(value).strip() == ""


def run_transfer(
    *,
    annotations: pa.Table,
    embeddings: dict[str, np.ndarray],
    transfer_columns: list[str],
    query_rule,
    reference_rule,
    k: int = 1,
    metric: str = "euclidean",
) -> pa.Table:
    """Pure core: classify, transfer per column, return the augmented table.

    ``embeddings`` maps protein id -> 1-D float32 vector. Proteins without an
    embedding cannot act as queries or references.
    """
    from protlabel import eat

    from protspace.analysis.classification import classify
    from protspace.data.io.predictions import add_overlay_columns

    # Restrict classification to proteins that actually have an embedding.
    has_emb = pa.array(
        [str(v) in embeddings for v in annotations.column("identifier").to_pylist()]
    )
    embedded = annotations.filter(has_emb)

    query_idx, ref_idx = classify(embedded, query_rule, reference_rule)
    rows = embedded.to_pylist()

    out = annotations
    for column in transfer_columns:
        if column not in annotations.column_names:
            raise KeyError(f"Transfer column {column!r} not in annotations table")

        # References: classified refs that HAVE a value in this column.
        ref_ids, ref_labels, ref_vecs = [], [], []
        for i in ref_idx:
            value = rows[i].get(column)
            if not _is_missing(value):
                rid = str(rows[i]["identifier"])
                ref_ids.append(rid)
                ref_labels.append(str(value))
                ref_vecs.append(embeddings[rid])
        if not ref_ids:
            logger.warning("No references with a value for %r; skipping", column)
            continue

        # Queries: classified queries MISSING a value in this column.
        q_ids, q_vecs = [], []
        for i in query_idx:
            if _is_missing(rows[i].get(column)):
                qid = str(rows[i]["identifier"])
                q_ids.append(qid)
                q_vecs.append(embeddings[qid])
        if not q_ids:
            logger.warning("No queries missing %r; nothing to transfer", column)
            continue

        preds = eat(
            np.vstack(q_vecs),
            q_ids,
            np.vstack(ref_vecs),
            ref_ids,
            ref_labels,
            k=k,
            metric=metric,
        )
        out = add_overlay_columns(out, column, preds)
        logger.info("Transferred %r to %d quer(ies)", column, len(preds))

    return out


@app.command()
def transfer(
    bundle: Annotated[
        Path,
        typer.Option("-b", "--bundle", help="Input .parquetbundle to annotate."),
    ],
    embeddings: Annotated[
        str,
        typer.Option(
            "-e",
            "--embeddings",
            help="HDF5 embeddings, optional :name suffix (e.g. emb.h5:prot_t5).",
        ),
    ],
    transfer_columns: Annotated[
        list[str],
        typer.Option("-t", "--transfer", help="Annotation column to transfer (repeat)."),
    ],
    output: Annotated[
        Path,
        typer.Option("-o", "--output", help="Output .parquetbundle path."),
    ],
    query_id_prefix: Annotated[list[str], typer.Option("--query-id-prefix")] = None,
    query_where: Annotated[list[str], typer.Option("--query-where", help="col~substr")] = None,
    reference_id_prefix: Annotated[list[str], typer.Option("--reference-id-prefix")] = None,
    reference_where: Annotated[list[str], typer.Option("--reference-where", help="col~substr")] = None,
    k: Annotated[int, typer.Option("--k", help="Neighbours considered (default 1).")] = 1,
    metric: Annotated[str, typer.Option("--metric", help="euclidean | cosine.")] = "euclidean",
    verbose: Opt_Verbose = 0,
) -> None:
    """Transfer annotations to query proteins from nearest reference neighbours."""
    setup_logging(verbose)

    import io

    import pyarrow.parquet as pq

    from protspace.analysis.classification import Rule
    from protspace.data.io.bundle import read_bundle, replace_annotations_in_bundle
    from protspace.data.loaders import load_h5

    def _parse_where(items: list[str] | None) -> list[tuple[str, str]]:
        clauses = []
        for item in items or []:
            if "~" not in item:
                raise typer.BadParameter(f"--*-where must be col~substr, got {item!r}")
            col, sub = item.split("~", 1)
            clauses.append((col, sub))
        return clauses

    query_rule = Rule(id_prefixes=query_id_prefix or [], where=_parse_where(query_where))
    reference_rule = Rule(
        id_prefixes=reference_id_prefix or [], where=_parse_where(reference_where)
    )

    # Load embeddings (name override after ':').
    h5_spec = embeddings.split(":", 1)
    h5_path = Path(h5_spec[0])
    name_override = h5_spec[1] if len(h5_spec) == 2 else None
    emb_set = load_h5([h5_path], name_override=name_override)
    emb_map = {
        header: emb_set.data[i] for i, header in enumerate(emb_set.headers)
    }

    # Read the annotations part of the bundle.
    parts, _settings = read_bundle(bundle)
    annotations = pq.read_table(io.BytesIO(parts[0]))

    augmented = run_transfer(
        annotations=annotations,
        embeddings=emb_map,
        transfer_columns=transfer_columns,
        query_rule=query_rule,
        reference_rule=reference_rule,
        k=k,
        metric=metric,
    )

    replace_annotations_in_bundle(bundle, output, augmented)
    logger.info("Wrote transferred bundle to %s", output)
```

- [ ] **Step 4: Register the subcommand**

Edit `src/protspace/cli/app.py`. In `_register_commands()` (lines 65-73), add `transfer` to the import list (keep alphabetical):

```python
    from protspace.cli import (  # noqa: F401
        annotate,
        bundle,
        embed,
        prepare,
        project,
        serve,
        style,
        transfer,
    )
```

- [ ] **Step 5: Run to verify pass**

Run: `uv run pytest tests/test_transfer_cli.py -v`
Expected: PASS (all 3)

- [ ] **Step 6: Run the full suite (fast) to check for regressions**

Run: `uv run pytest tests/ -m "not slow" -q`
Expected: all pass (existing + new)

- [ ] **Step 7: Lint + commit**

```bash
uv run ruff check src/protspace/cli/transfer.py src/protspace/cli/app.py tests/test_transfer_cli.py
git add src/protspace/cli/transfer.py src/protspace/cli/app.py tests/test_transfer_cli.py
git commit -m "feat: add 'protspace transfer' annotation-transfer subcommand"
```

---

## Task 10: End-to-end smoke test through a real bundle round-trip

**Files:**
- Test: `tests/test_transfer_cli.py` (append)

- [ ] **Step 1: Write the failing end-to-end test**

Append to `tests/test_transfer_cli.py`:

```python
def test_end_to_end_bundle_roundtrip(tmp_path):
    """Build a tiny bundle + h5, run the CLI, read the overlay back."""
    import io

    import h5py
    import pyarrow.parquet as pq
    from typer.testing import CliRunner

    from protspace.cli.app import app
    from protspace.data.io.bundle import read_bundle, write_bundle

    annotations = pa.table(
        {"identifier": ["TRINITY_1", "P00001"], "protein_category": ["", "neurotoxin"]}
    )
    proj_meta = pa.table({"name": ["PCA 2"], "dims": [2]})
    proj_data = pa.table({"id": ["TRINITY_1", "P00001"], "x": [0.0, 9.0], "y": [0.0, 0.0]})
    bundle_path = tmp_path / "in.parquetbundle"
    write_bundle([annotations, proj_meta, proj_data], bundle_path)

    h5_path = tmp_path / "emb.h5"
    with h5py.File(h5_path, "w") as f:
        f.create_dataset("TRINITY_1", data=np.array([0.0, 0.0], dtype=np.float32))
        f.create_dataset("P00001", data=np.array([0.1, 0.0], dtype=np.float32))

    out_path = tmp_path / "out.parquetbundle"
    result = CliRunner().invoke(
        app,
        [
            "transfer",
            "-b", str(bundle_path),
            "-e", str(h5_path),
            "-t", "protein_category",
            "-o", str(out_path),
            "--query-id-prefix", "TRINITY_",
            "--reference-id-prefix", "P0",
        ],
    )
    assert result.exit_code == 0, result.output
    parts, _ = read_bundle(out_path)
    rows = {r["identifier"]: r for r in pq.read_table(io.BytesIO(parts[0])).to_pylist()}
    assert rows["TRINITY_1"]["protein_category__pred_value"] == "neurotoxin"
    assert rows["TRINITY_1"]["protein_category__pred_source"] == "P00001"
```

- [ ] **Step 2: Run to verify it passes (implementation already exists)**

Run: `uv run pytest tests/test_transfer_cli.py::test_end_to_end_bundle_roundtrip -v`
Expected: PASS. If it fails, fix `cli/transfer.py` until it passes (do not edit the test).

- [ ] **Step 3: Commit**

```bash
git add tests/test_transfer_cli.py
git commit -m "test: end-to-end protspace transfer bundle round-trip"
```

---

## Task 11: Documentation + notebook (required before final commit)

**Files:**
- Modify: `docs/cli.md`, `docs/annotations.md`, `../CLAUDE.md`
- Create: `notebooks/ProtSpace_Transfer.ipynb`

- [ ] **Step 1: Document the subcommand in `docs/cli.md`**

Add a new section (match the heading style of the existing `protspace project` section):

```markdown
### protspace transfer

Fill in missing annotation values for query proteins by **Embedding Annotation
Transfer (EAT)** — each query's missing value is transferred from its nearest
annotated reference in pLM embedding space, with a goPredSim reliability-index
confidence (`0.5 / (0.5 + distance)` for Euclidean).

```bash
protspace transfer \
  -b results.parquetbundle \
  -e embeddings.h5:prot_t5 \
  -t protein_category \
  -o results.parquetbundle \
  --query-id-prefix TRINITY_ \
  --reference-where 'protein_category~neurotoxin'
```

Default metric is Euclidean (canonical EAT); `--metric cosine` and `--k N` are
available. Writes `protein_category__pred_value`, `__pred_confidence`, and
`__pred_source` columns into the bundle's annotations table. Distances are
computed in the original embedding space (HDF5), not in the 2-D/3-D projection.

References: Littmann et al., *Sci Rep* 2021 (DOI 10.1038/s41598-020-80786-0);
Heinzinger et al., *NAR Genom Bioinform* 2022 (DOI 10.1093/nargab/lqac043).
```

- [ ] **Step 2: Document the overlay columns in `docs/annotations.md`**

Add a short subsection documenting the `<col>__pred_value` / `__pred_confidence` / `__pred_source` convention so the `protspace_web` annotation registry can stay aligned:

```markdown
## Predicted-by-transfer overlay columns

`protspace transfer` appends three columns per transferred annotation `COL`,
populated only for proteins whose `COL` value was predicted (null otherwise):

| Column | Type | Meaning |
|--------|------|---------|
| `COL__pred_value` | string | the transferred label |
| `COL__pred_confidence` | float | reliability index in [0, 1] |
| `COL__pred_source` | string | nearest reference protein id |

The curated `COL` is left untouched. A protein is "predicted" for `COL` when
`COL` is empty but `COL__pred_value` is present.
```

- [ ] **Step 3: Update the CLI table in `../CLAUDE.md`**

In the `## CLI Commands` table (the `protspace/CLAUDE.md` one), add a row:

```markdown
| `protspace transfer` | Fill missing annotations from nearest reference embeddings (EAT) |
```

- [ ] **Step 4: Create the Colab notebook**

Create `notebooks/ProtSpace_Transfer.ipynb` — a minimal notebook (use `uv run jupytext` or write JSON directly) with: (1) a markdown intro to EAT and `protspace transfer`, (2) a cell installing protspace, (3) a cell running the example command on a public dataset, (4) a cell reading the `__pred_*` columns back with pandas. Keep it runnable end-to-end.

Run to validate it parses: `uv run python -c "import json,nbformat; nbformat.read(open('notebooks/ProtSpace_Transfer.ipynb'), as_version=4)"`
Expected: no error.

- [ ] **Step 5: Final lint of the whole change**

Run: `uv run ruff check src/ tests/`
Expected: no errors.

- [ ] **Step 6: Commit docs**

```bash
git add docs/cli.md docs/annotations.md ../CLAUDE.md notebooks/ProtSpace_Transfer.ipynb
git commit -m "docs: document protspace transfer + prediction overlay columns"
```

---

## Task 12: Full verification + open a PR

- [ ] **Step 1: Run the complete fast suite**

Run: `uv run pytest tests/ -m "not slow" -q`
Expected: all pass.

- [ ] **Step 2: Confirm the protlabel boundary is still clean**

Run: `! grep -rqE "import protspace|from protspace" src/protlabel/ && echo "boundary clean"`
Expected: `boundary clean`

- [ ] **Step 3: Confirm the command is wired**

Run: `uv run protspace transfer --help`
Expected: help text with `--bundle`, `--embeddings`, `--transfer`, `--metric`, `--k`.

- [ ] **Step 4: Push the branch and open a PR**

```bash
git push -u origin <feature-branch>
gh pr create --title "feat: protlabel EAT engine + protspace transfer subcommand" \
  --body "Implements the backend of docs/superpowers/specs/2026-06-11-eat-annotation-transfer-design.md (closes #54 backend scope). protlabel = embedding annotation-transfer engine; protspace transfer = CLI that writes a per-cell prediction overlay into the bundle. Frontend rendering is a separate PR."
```

---

## Self-Review (completed during planning)

**1. Spec coverage:**
- protlabel engine (spec §4) → Tasks 1–5. ✓
- Euclidean default + RI formula (spec §3) → Tasks 2, 4. ✓
- Embedding-space distances, not DR (spec §3) → Task 9 (`run_transfer` reads the HDF5, never projections). ✓
- Query/reference classifier, no hardcoded biology (spec §5 step 2) → Task 6. ✓
- Per-cell overlay representation (spec §6.2, user decision) → Tasks 7, 9. ✓
- Rebuildable sidecar lookup, not in the bundle (spec §6.1) → Task 5 (`Lookup.save/load`). ✓
- Brute-force default, no ANN (spec §7) → Task 3. ✓
- One default output table; gating/mining/report opt-in/out-of-scope (spec §5, §13 Q4) → handled by scoping; noted out of scope. ✓
- Docs + notebook (spec §12) → Task 11. ✓
- **Deferred to follow-up plans (intentional):** frontend rendering (spec §9), optional gating/mining/report, faiss-cpu, ProtTucker. Noted in the header.

**2. Placeholder scan:** Every code step contains complete code; commands have expected output; no "TBD"/"handle edge cases". Task 11 Step 4 (notebook) describes cell contents rather than embedding full notebook JSON — acceptable because the artifact is a notebook, not source code, and the validation command is concrete.

**3. Type consistency:** `Prediction(query_id, label, source_id, distance, reliability, k, metric)` is defined in Task 4 and used identically in Tasks 5, 7, 9. `Rule(id_prefixes, where)` defined in Task 6, used in Tasks 9, 10. `nearest()->(idx, dist)`, `eat(...)->list[Prediction]`, `add_overlay_columns(table, column, predictions)->Table`, `replace_annotations_in_bundle(input, output, table)`, `run_transfer(...)->Table` — signatures consistent across tasks. Overlay column names (`<col>__pred_value/__pred_confidence/__pred_source`) identical in Tasks 7, 9, 10, 11. ✓
