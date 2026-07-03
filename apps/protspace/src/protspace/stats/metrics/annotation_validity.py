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
            base = {
                "space_kind": ctx.space_kind,
                "space_name": ctx.space_name,
                "annotation": name,
                "stat_family": self.family,
                "label_kind": "annotation",
            }
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
                            extra=dict(extra),
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
                                extra=dict(extra),
                                **base,
                            )
                        )
                    except Exception:  # noqa: BLE001 - best-effort
                        pass
        return rows
