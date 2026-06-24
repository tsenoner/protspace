"""Cluster-validity statistics on projection coordinates.

KMeans (with an elbow-chosen K) labels the projection; silhouette, Davies-Bouldin
and Calinski-Harabasz score that labelling. The chosen K is emitted as a
``metric_kind="meta"`` row so consumers can exclude it from validity aggregates.

scikit-learn imports are function-local to keep CLI startup fast.
"""

from __future__ import annotations

import numpy as np

from protspace.stats.base import StatContext, StatRow
from protspace.stats.cluster.kmeans_elbow import kmeans_elbow

DEFAULT_SAMPLE_THRESHOLD = 5000


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


def _has_singleton(labels) -> bool:
    _, counts = np.unique(labels, return_counts=True)
    return bool((counts < 2).any())


class ClusterValidityStatistic:
    """Elbow K + silhouette / Davies-Bouldin / Calinski-Harabasz on the coords."""

    family = "cluster_validity"
    requires_embedding = False

    def compute(self, ctx: StatContext) -> list[StatRow]:
        from sklearn.metrics import calinski_harabasz_score, davies_bouldin_score

        X = np.asarray(ctx.coords, dtype=float)
        n = X.shape[0]
        rng_seed = ctx.rng_seed
        sample_threshold = int(
            ctx.params.get("sample_threshold", DEFAULT_SAMPLE_THRESHOLD)
        )
        k_max = ctx.params.get("k_max")

        res = kmeans_elbow(
            X, rng_seed=rng_seed, k_max=k_max, silhouette_sample=sample_threshold
        )
        if res is None:  # n < 3
            return []
        labels = res.labels
        k = res.k
        # Report the ACHIEVED number of distinct clusters (KMeans can collapse on
        # coincident points), keeping the elbow's requested K in extra.
        achieved = int(len(np.unique(labels)))

        base = {
            "space_kind": ctx.space_kind,
            "space_name": ctx.space_name,
            "stat_family": self.family,
            "label_kind": "kmeans_elbow",
        }
        rows: list[StatRow] = [
            StatRow(
                metric="n_clusters",
                metric_kind="meta",
                value=float(achieved),
                extra={
                    "requested_k": k,
                    "k_range": [res.k_range[0], res.k_range[-1]],
                    "inertia": res.inertia,
                    "knee_confidence": res.knee_confidence,
                    "silhouette_optimal_k": res.silhouette_optimal_k,
                    "seed": rng_seed,
                },
                **base,
            )
        ]

        # silhouette needs 2 <= k <= n - 1
        if 2 <= k <= n - 1:
            try:
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
        if not _has_singleton(labels):
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

        return rows
