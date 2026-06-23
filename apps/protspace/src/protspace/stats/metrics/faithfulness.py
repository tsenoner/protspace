"""Projection-faithfulness statistics: kNN-overlap, trustworthiness, continuity.

These compare a projection to its *source embedding*. The high-dimensional
distance metric (the reducer's own metric, euclidean by default unless the
projection was built with e.g. cosine) is applied to whichever computation has
the embedding as its primary input:

  trustworthiness = trustworthiness(embedding, coords, metric=high_dim_metric)
  continuity      = trustworthiness(coords, embedding, metric="euclidean")

``sklearn.manifold.trustworthiness`` materialises a full pairwise distance matrix
(no ANN path), so above a sample threshold a fixed-seed shared subsample is used,
and beyond a hard ceiling the statistic is skipped with a recorded marker.

scikit-learn imports are function-local to keep CLI startup fast.
"""

from __future__ import annotations

import hashlib

import numpy as np

from protspace.stats.base import StatContext, StatRow

DEFAULT_K = 15
DEFAULT_SAMPLE_THRESHOLD = 5000
DEFAULT_HARD_CEILING = 20000


def _subsample_seed(rng_seed: int, ids: list[str]) -> int:
    """A seed derived from (rng_seed, sorted ids). Within a single run all
    projections of one embedding share the same id row order, so they draw the
    same positional subset — keeping cross-projection scores comparable."""
    digest = hashlib.sha256("|".join(sorted(ids)).encode()).hexdigest()[:8]
    return (rng_seed * 2654435761 + int(digest, 16)) % (2**32)


def _knn_overlap(embedding, coords, k: int, metric: str) -> float:
    from sklearn.neighbors import NearestNeighbors

    n = embedding.shape[0]
    hi = (
        NearestNeighbors(n_neighbors=k + 1, metric=metric)
        .fit(embedding)
        .kneighbors(embedding, return_distance=False)
    )
    lo = (
        NearestNeighbors(n_neighbors=k + 1, metric="euclidean")
        .fit(coords)
        .kneighbors(coords, return_distance=False)
    )
    total = 0
    for i in range(n):
        # Exclude self explicitly (not by slicing column 0): on coincident points
        # self may not be the first returned neighbour.
        hi_i = [j for j in hi[i] if j != i][:k]
        lo_i = [j for j in lo[i] if j != i][:k]
        total += len(set(hi_i).intersection(lo_i))
    return float(total / (n * k))


class FaithfulnessStatistic:
    """kNN-overlap + trustworthiness + continuity of a projection vs its embedding."""

    family = "faithfulness"
    requires_embedding = True

    def compute(self, ctx: StatContext) -> list[StatRow]:
        from sklearn.manifold import trustworthiness

        if ctx.embedding is None:
            return []
        emb = np.asarray(ctx.embedding, dtype=float)
        # Use the projection coordinates ALIGNED to the embedding (id-intersection
        # join), falling back to full coords only when no aligned view was built.
        coords_src = ctx.embedding_coords if ctx.embedding_coords is not None else ctx.coords
        coords = np.asarray(coords_src, dtype=float)
        ids = ctx.embedding_ids if ctx.embedding_ids is not None else ctx.ids
        n = emb.shape[0]
        if n < 3:
            return []

        k = int(ctx.params.get("k", DEFAULT_K))
        sample_threshold = int(ctx.params.get("sample_threshold", DEFAULT_SAMPLE_THRESHOLD))
        hard_ceiling = int(ctx.params.get("hard_ceiling", DEFAULT_HARD_CEILING))
        hi_metric = ctx.high_dim_metric or "euclidean"

        base = {
            "space_kind": ctx.space_kind,
            "space_name": ctx.space_name,
            "stat_family": self.family,
            "label_kind": "none",
        }

        if n > hard_ceiling:
            return [
                StatRow(
                    metric="knn_overlap",
                    metric_kind="faithfulness",
                    value=float("nan"),
                    extra={
                        "skipped": "n_too_large",
                        "n": int(n),
                        "hard_ceiling": hard_ceiling,
                        "embedding": ctx.embedding_name,
                    },
                    **base,
                )
            ]

        sampled = False
        if n > sample_threshold:
            rng = np.random.default_rng(_subsample_seed(ctx.rng_seed, ids))
            idx = np.sort(rng.permutation(n)[:sample_threshold])
            emb = emb[idx]
            coords = coords[idx]
            n = len(idx)
            sampled = True

        # sklearn.manifold.trustworthiness requires n_neighbors < n / 2 (strict),
        # else it raises. Clamp accordingly so trustworthiness/continuity are not
        # silently dropped for small n; k+1 <= n keeps the kNN-overlap query valid.
        k = max(1, min(k, (n - 1) // 2))
        common = {
            "k": k,
            "seed": ctx.rng_seed,
            "sampled": sampled,
            "sample_size": int(n),
            "embedding": ctx.embedding_name,
        }
        rows: list[StatRow] = []

        try:
            rows.append(
                StatRow(
                    metric="knn_overlap",
                    metric_kind="faithfulness",
                    value=_knn_overlap(emb, coords, k, hi_metric),
                    extra={**common, "metric": hi_metric},
                    **base,
                )
            )
        except Exception:  # noqa: BLE001 - faithfulness is best-effort
            pass
        try:
            rows.append(
                StatRow(
                    metric="trustworthiness",
                    metric_kind="faithfulness",
                    value=float(trustworthiness(emb, coords, n_neighbors=k, metric=hi_metric)),
                    extra={**common, "metric": hi_metric},
                    **base,
                )
            )
        except Exception:  # noqa: BLE001
            pass
        try:
            rows.append(
                StatRow(
                    metric="continuity",
                    metric_kind="faithfulness",
                    value=float(
                        trustworthiness(coords, emb, n_neighbors=k, metric="euclidean")
                    ),
                    extra={**common, "metric": "euclidean"},
                    **base,
                )
            )
        except Exception:  # noqa: BLE001
            pass

        return rows
