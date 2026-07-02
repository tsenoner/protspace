"""Cluster-validity statistics on projection coordinates.

KMeans (with an elbow-chosen K) labels the projection; silhouette, Davies-Bouldin
and Calinski-Harabasz score that labelling. The chosen K is emitted as a
``metric_kind="meta"`` row so consumers can exclude it from validity aggregates.

scikit-learn imports are function-local to keep CLI startup fast.
"""

from __future__ import annotations

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


class ClusterValidityStatistic:
    """Elbow K + silhouette / Davies-Bouldin / Calinski-Harabasz on the coords."""

    family = "cluster_validity"
    requires_embedding = False

    def compute(self, ctx: StatContext) -> list:
        from sklearn.metrics import calinski_harabasz_score, davies_bouldin_score

        X = np.asarray(ctx.coords, dtype=float)
        n = X.shape[0]
        rng_seed = ctx.rng_seed
        sample_threshold = int(
            ctx.params.get("sample_threshold", DEFAULT_SAMPLE_THRESHOLD)
        )
        k_max = ctx.params.get("k_max")

        res = kmeans_elbow(
            X,
            rng_seed=rng_seed,
            k_max=k_max,
            max_fit_sample=int(
                ctx.params.get("max_fit_sample", DEFAULT_MAX_FIT_SAMPLE)
            ),
        )
        if res is None:  # n < 3
            return []
        labels = res.labels
        k = res.k
        # Report the ACHIEVED number of distinct clusters (KMeans can collapse on
        # coincident points), keeping the elbow's requested K in extra. The cluster
        # sizes also feed the Davies-Bouldin / Calinski-Harabasz singleton guard.
        unique_labels, label_counts = np.unique(labels, return_counts=True)
        achieved = int(len(unique_labels))
        has_singleton = bool((label_counts < 2).any())

        base = {
            "space_kind": ctx.space_kind,
            "space_name": ctx.space_name,
            "stat_family": self.family,
            "label_kind": "kmeans_elbow",
        }

        # Decide up front whether the exact per-point silhouette column will be
        # emitted. When it is, its per-point values are the single source of truth:
        # the aggregate `silhouette` row is their mean (== the exact unsampled
        # silhouette_score by definition), so the headline value equals
        # mean(silhouette_{proj}) and no redundant sampled score is computed.
        silhouette_ok = 2 <= k <= n - 1
        hard_ceiling = int(
            ctx.params.get("silhouette_hard_ceiling", DEFAULT_SILHOUETTE_HARD_CEILING)
        )
        want_per_point = (
            ctx.params.get("cluster_annotations", True)
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

        # Holds scalar StatRows plus, below, any per-protein AnnotationColumns.
        rows: list = [
            StatRow(
                metric="n_clusters",
                metric_kind="meta",
                value=float(achieved),
                extra={
                    "requested_k": k,
                    "k_range": [res.k_range[0], res.k_range[-1]],
                    "inertia": res.inertia,
                    "knee_confidence": res.knee_confidence,
                    "seed": rng_seed,
                },
                **base,
            )
        ]

        # silhouette needs 2 <= k <= n - 1
        if silhouette_ok:
            try:
                if per_point_samples is not None:
                    # Exact aggregate over all n, consistent with the per-point
                    # silhouette_{proj} column below.
                    sil = float(per_point_samples.mean())
                    sx = {"sampled": False, "sample_size": int(n)}
                else:
                    # No exact column (n > hard_ceiling, disabled, or id mismatch):
                    # fall back to the sampled/exact silhouette_score.
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

        # Per-protein outputs (route-projection-statistics Phase 2): the elbow-K
        # labelling becomes a categorical membership column and per-point silhouette
        # a numeric column, both joined by identifier. Gated identically to the
        # per_point_samples decision above.
        if want_per_point:
            ann_extra = {
                "projection": ctx.space_name,
                "k": int(k),
                "seed": rng_seed,
                "computed": True,
            }
            # Membership as NON-numeric label strings so the frontend's content-based
            # type inference reads the column as categorical, not a numeric ramp.
            rows.append(
                AnnotationColumn(
                    name=f"cluster_{ctx.space_name}",
                    kind="categorical",
                    values={
                        pid: f"cluster {int(lbl)}"
                        for pid, lbl in zip(ctx.ids, labels, strict=False)
                    },
                    extra=ann_extra,
                )
            )
            if per_point_samples is not None:
                rows.append(
                    AnnotationColumn(
                        name=f"silhouette_{ctx.space_name}",
                        kind="numeric",
                        values={
                            pid: float(s)
                            for pid, s in zip(ctx.ids, per_point_samples, strict=False)
                        },
                        extra=ann_extra,
                    )
                )

        return rows
