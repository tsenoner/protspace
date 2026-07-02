"""Cluster-validity statistics on projection coordinates.

KMeans labels the projection; silhouette, Davies-Bouldin and Calinski-Harabasz
score that labelling. The K can be chosen by the inertia **elbow** and/or by
**max silhouette** (``ctx.params["cluster_selection"]`` = ``elbow`` | ``silhouette``
| ``both``); each selection is emitted with its own ``label_kind``
(``kmeans_elbow`` / ``kmeans_silhouette``). The chosen K is emitted as a
``metric_kind="meta"`` row so consumers can exclude it from validity aggregates.

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


def _silhouette(X, labels, *, rng_seed: int, sample_threshold: int):
    from sklearn.metrics import silhouette_score

    n = len(labels)
    if n > sample_threshold:
        val = float(
            silhouette_score(
                X, labels, sample_size=sample_threshold, random_state=rng_seed
            )
        )
        return val, {"sampled": True, "sample_size": int(sample_threshold)}
    return float(silhouette_score(X, labels)), {"sampled": False, "sample_size": int(n)}


class _Labeling(NamedTuple):
    """One K-selection's clustering: how it was chosen + its column and labels."""

    label_kind: str  # "kmeans_elbow" | "kmeans_silhouette" (statistics.parquet tag)
    col_name: str  # "cluster_elbow_<proj>" | "cluster_silhouette_<proj>"
    selection_name: str  # "elbow" | "silhouette"
    requested_k: int
    labels: np.ndarray


class ClusterValidityStatistic:
    """Elbow / silhouette K + silhouette / Davies-Bouldin / Calinski-Harabasz."""

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
        from sklearn.metrics import calinski_harabasz_score, davies_bouldin_score

        rng_seed = ctx.rng_seed
        params = ctx.params
        sample_threshold = int(params.get("sample_threshold", DEFAULT_SAMPLE_THRESHOLD))
        label_kind = labeling.label_kind
        col_name = labeling.col_name
        selection_name = labeling.selection_name
        labels = labeling.labels
        k = int(labeling.requested_k)

        # Report the ACHIEVED number of distinct clusters (KMeans can collapse on
        # coincident points), keeping the requested K in extra. The cluster sizes
        # also feed the Davies-Bouldin / Calinski-Harabasz singleton guard.
        unique_labels, label_counts = np.unique(labels, return_counts=True)
        achieved = int(len(unique_labels))
        has_singleton = bool((label_counts < 2).any())

        base = {
            "space_kind": ctx.space_kind,
            "space_name": ctx.space_name,
            "stat_family": self.family,
            "label_kind": label_kind,
        }

        # Decide up front whether the exact per-point silhouette will be computed.
        # When it is, its mean is the exact aggregate silhouette (== unsampled
        # silhouette_score) AND its per-point values ride along on the membership
        # column, so nothing is computed twice.
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
                metric="n_clusters",
                metric_kind="meta",
                value=float(achieved),
                extra=meta_extra,
                **base,
            )
        ]

        # silhouette needs 2 <= k <= n - 1
        if silhouette_ok:
            try:
                if per_point_samples is not None:
                    # Exact aggregate over all n, consistent with the per-point
                    # values attached to the membership column below.
                    sil = float(per_point_samples.mean())
                    sx = {"sampled": False, "sample_size": int(n)}
                else:
                    sil, sx = _silhouette(
                        X, labels, rng_seed=rng_seed, sample_threshold=sample_threshold
                    )
                rows.append(
                    StatRow(
                        metric="silhouette",
                        metric_kind="validity",
                        value=sil,
                        extra={**sx, "seed": rng_seed},
                        **base,
                    )
                )
            except Exception:  # noqa: BLE001 - validity is best-effort
                pass

        # Davies-Bouldin / Calinski-Harabasz are unstable with singleton clusters.
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
                            value=float(fn(X, labels)),
                            extra={"seed": rng_seed},
                            **base,
                        )
                    )
                except Exception:  # noqa: BLE001
                    pass

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
        return rows
