"""Auto-clustering (KMeans) on projection coordinates + agreement with annotations.

KMeans labels the projection. The K can be chosen by the inertia **elbow**
and/or by **max silhouette** (``ctx.params["cluster_selection"]`` = ``elbow`` |
``silhouette`` | ``both``); each selection is emitted with its own
``label_kind`` (``kmeans_elbow`` / ``kmeans_silhouette``). The chosen K is
emitted as a ``metric_kind="meta"`` row (``n_clusters``).

This auto-clustering is no longer self-scored (no silhouette / Davies-Bouldin /
Calinski-Harabasz on the KMeans labels themselves — that was circular: KMeans
optimises inertia, then silhouette grades the KMeans result against itself).
Instead, when ``ctx.annotations`` are supplied, each auto-clustering is compared
against every annotation's category labels via **ARI** (``adjusted_rand``) and
**NMI** (``normalized_mutual_info``) — ``stat_family="cluster_agreement"``,
``metric_kind="agreement"`` — reusing the KMeans labels already computed (no
second sweep). Annotation-based *validity* (silhouette/DBI/CH scored on the
annotation's own categories) lives in ``AnnotationValidityStatistic``.

Each labelling also becomes a per-protein ``cluster_*`` membership column whose
per-point silhouette rides along as an attached ``value|score`` confidence — the
same convention as UniProt evidence codes / InterPro bit scores — so no separate
silhouette column is needed. Suppressed when ``ctx.params["include_scores"]`` is
False (``--no-scores``).

scikit-learn imports are function-local to keep CLI startup fast.
"""

from __future__ import annotations

from typing import NamedTuple

import numpy as np

from protspace.stats.base import AnnotationColumn, StatContext, StatRow
from protspace.stats.cluster.kmeans_elbow import kmeans_elbow

DEFAULT_SAMPLE_THRESHOLD = 5000
# silhouette_samples is O(n^2) with no sampling escape hatch (unlike the aggregate
# mean), so the per-point column is skipped beyond this point count.
DEFAULT_SILHOUETTE_HARD_CEILING = 20000
# Above this many points the KMeans elbow sweep fits on a random subsample (+predict)
# rather than the full projection, bounding cost at 570k+ scale.
DEFAULT_MAX_FIT_SAMPLE = 50_000


class _Labeling(NamedTuple):
    """One K-selection's clustering: how it was chosen + its column and labels."""

    label_kind: str  # "kmeans_elbow" | "kmeans_silhouette" (statistics.parquet tag)
    col_name: str  # "cluster_elbow_<proj>" | "cluster_silhouette_<proj>"
    selection_name: str  # "elbow" | "silhouette"
    requested_k: int
    labels: np.ndarray


class ClusterValidityStatistic:
    """Elbow / silhouette auto-clustering + ARI/NMI agreement vs annotations."""

    family = "cluster_validity"
    requires_embedding = False

    def compute(self, ctx: StatContext) -> list:
        X = np.asarray(ctx.coords, dtype=float)
        n = X.shape[0]
        params = ctx.params
        sample_threshold = int(params.get("sample_threshold", DEFAULT_SAMPLE_THRESHOLD))
        selection = str(params.get("cluster_selection", "elbow")).lower()
        # The CLI validates this via a Typer enum; guard the raw stats API too so an
        # unrecognised value falls back to the default rather than silently emitting
        # no labelling at all (best-effort: never drop a projection's whole output).
        if selection not in ("elbow", "silhouette", "both"):
            selection = "elbow"

        res = kmeans_elbow(
            X,
            rng_seed=ctx.rng_seed,
            k_max=params.get("k_max"),
            max_fit_sample=int(params.get("max_fit_sample", DEFAULT_MAX_FIT_SAMPLE)),
            silhouette_selection=selection in ("silhouette", "both"),
            silhouette_sample=sample_threshold,
        )
        if res is None:  # n < 3
            return []

        # Which labelling(s) to emit. Each K-selection method is named explicitly
        # (cluster_elbow_<proj> / cluster_silhouette_<proj>) so the column name — the
        # only signal that survives to the frontend — carries the provenance.
        labelings: list[_Labeling] = []
        if selection in ("elbow", "both"):
            labelings.append(
                _Labeling(
                    "kmeans_elbow",
                    f"cluster_elbow_{ctx.space_name}",
                    "elbow",
                    res.k,
                    res.labels,
                )
            )
        if selection in ("silhouette", "both") and res.silhouette_labels is not None:
            labelings.append(
                _Labeling(
                    "kmeans_silhouette",
                    f"cluster_silhouette_{ctx.space_name}",
                    "silhouette",
                    int(res.silhouette_k),
                    res.silhouette_labels,
                )
            )

        out: list = []
        for labeling in labelings:
            out.extend(self._emit_labeling(ctx, X, n, res, labeling))
        return out

    def _emit_labeling(self, ctx, X, n, res, labeling: _Labeling) -> list:
        """Rows + membership column for one labelling (elbow or silhouette-K)."""
        rng_seed = ctx.rng_seed
        params = ctx.params
        label_kind = labeling.label_kind
        col_name = labeling.col_name
        selection_name = labeling.selection_name
        labels = labeling.labels
        k = int(labeling.requested_k)

        # Report the ACHIEVED number of distinct clusters (KMeans can collapse on
        # coincident points), keeping the requested K in extra.
        unique_labels, _label_counts = np.unique(labels, return_counts=True)
        achieved = int(len(unique_labels))

        # Decide up front whether the exact per-point silhouette will be computed.
        # Its per-point values ride along on the membership column below as a
        # `|score` confidence; no aggregate self-validity row is emitted for it.
        silhouette_ok = 2 <= k <= n - 1
        hard_ceiling = int(
            params.get("silhouette_hard_ceiling", DEFAULT_SILHOUETTE_HARD_CEILING)
        )
        want_per_point = (
            params.get("cluster_annotations", True)
            and achieved >= 2
            and len(ctx.ids) == n
        )
        per_point_samples = None
        if want_per_point and silhouette_ok and n <= hard_ceiling:
            try:
                from sklearn.metrics import silhouette_samples

                per_point_samples = silhouette_samples(X, labels)
            except Exception:  # noqa: BLE001 - per-point silhouette is best-effort
                per_point_samples = None

        meta_extra = {
            "requested_k": k,
            "selection": selection_name,
            "k_range": [res.k_range[0], res.k_range[-1]],
            "inertia": res.inertia,
            "seed": rng_seed,
        }
        if selection_name == "elbow":
            meta_extra["knee_confidence"] = res.knee_confidence

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

        # Per-protein membership: a categorical `cluster N` label, with the per-point
        # silhouette attached as a `value|score` confidence (like ECO / InterPro bit
        # scores) so a single column carries both membership and its confidence.
        if want_per_point:
            include_scores = bool(params.get("include_scores", True))
            sil_by_id = {}
            if per_point_samples is not None:
                sil_by_id = {
                    pid: float(s)
                    for pid, s in zip(ctx.ids, per_point_samples, strict=False)
                }

            def _membership(pid, lbl):
                label = f"cluster {int(lbl)}"
                if include_scores and pid in sil_by_id:
                    return f"{label}|{sil_by_id[pid]:.4f}"
                return label

            rows.append(
                AnnotationColumn(
                    name=col_name,
                    kind="categorical",
                    values={
                        pid: _membership(pid, lbl)
                        for pid, lbl in zip(ctx.ids, labels, strict=False)
                    },
                    extra={
                        "projection": ctx.space_name,
                        "selection": selection_name,
                        "k": k,
                        "seed": rng_seed,
                        "computed": True,
                        "has_silhouette_score": bool(sil_by_id) and include_scores,
                    },
                )
            )

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

        return rows
