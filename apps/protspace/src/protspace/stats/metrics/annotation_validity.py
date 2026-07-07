"""Annotation-based cluster-validity: how well an annotation's categories
separate in a given space (embedding or projection).

silhouette / Davies-Bouldin / Calinski-Harabasz are computed with the
annotation's category labels (not auto-KMeans labels), on ``ctx.coords`` —
the driver hands us the embedding for the once-per-embedding pass and the 2D
projection for the per-projection pass. scikit-learn imports are function-local.
"""

from __future__ import annotations

import numpy as np

from protspace.stats._sampling import id_seed, sorted_subsample
from protspace.stats.base import DEFAULT_SAMPLE_THRESHOLD, StatContext, StatRow


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

        coords = np.asarray(ctx.coords)
        threshold = int(ctx.params.get("sample_threshold", DEFAULT_SAMPLE_THRESHOLD))
        id_to_row = {pid: i for i, pid in enumerate(ctx.ids)}
        rows: list[StatRow] = []

        for name, mapping in ctx.annotations.items():
            # Annotated points present in this space, in canonical id order — so the
            # subsample below is reproducible and picks the *same* proteins across
            # spaces (embedding vs projection) whenever the annotated id-set matches;
            # otherwise the "separability ceiling" would compare two different draws.
            present = sorted(
                (pid, id_to_row[pid], cat)
                for pid, cat in mapping.items()
                if pid in id_to_row
            )
            if len(present) < 3 or len({c for _, _, c in present}) < 2:
                continue  # need >= 3 points, >= 2 categories

            # Bound cost: subsample (id-seeded) BEFORE gathering + upcasting, so at
            # 570k scale we materialise ~threshold float64 rows, not all of them
            # (label integers are arbitrary, so renumbering post-subsample is
            # metric-invariant). Shared across all three metrics.
            rng = np.random.default_rng(id_seed(ctx.rng_seed, [p[0] for p in present]))
            sub = sorted_subsample(len(present), threshold, rng)
            if sub is not None:
                present = [present[i] for i in sub]
            row_idx = [r for _, r, _ in present]
            cats = [c for _, _, c in present]
            cat_to_int = {c: j for j, c in enumerate(sorted(set(cats)))}
            Xa = np.asarray(coords[row_idx], dtype=float)
            labels = np.asarray([cat_to_int[c] for c in cats])
            n = Xa.shape[0]
            _, counts = np.unique(labels, return_counts=True)
            achieved = len(counts)
            if achieved < 2:  # a category vanished under subsampling
                continue
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

            # silhouette needs 2 <= k <= n-1; DBI/CH are unstable with singletons.
            candidates: list = []
            if 2 <= achieved <= n - 1:
                candidates.append(("silhouette", silhouette_score))
            if not bool((counts < 2).any()):
                candidates += [
                    ("davies_bouldin", davies_bouldin_score),
                    ("calinski_harabasz", calinski_harabasz_score),
                ]
            for metric_name, fn in candidates:
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
