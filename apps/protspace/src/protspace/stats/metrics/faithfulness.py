"""Projection-faithfulness statistics: kNN-overlap, trustworthiness, continuity.

These compare a projection to its *source embedding*. The high-dimensional
distance metric (the reducer's own metric, euclidean by default unless the
projection was built with e.g. cosine) defines the embedding-space neighbourhoods
for all three statistics, so trustworthiness and continuity form a consistent
dual pair — both define the embedding's neighbourhoods by ``high_dim_metric`` and
the coords' by euclidean (differing only in which space supplies ranks vs sets):

  trustworthiness = penalises false neighbours (near in coords, far in embedding)
  continuity      = penalises missed neighbours (near in embedding, far in coords)

``sklearn.manifold.trustworthiness`` only applies its ``metric`` argument to the
first (ranked) input, so continuity with a non-euclidean high-dim metric is not
expressible via a single call; ``_continuity`` computes it with the same
normalisation as sklearn (and is bit-identical when the metric is euclidean).

Both build a full pairwise distance matrix (no ANN path), so above a sample
threshold a fixed-seed shared subsample is used, and beyond a hard ceiling the
statistic is skipped with a recorded marker.

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
    """A seed derived from (rng_seed, sorted ids). Paired with a canonical-id-order
    selection (see ``compute``), two inputs with the same id-set draw the same
    id subset regardless of row order — keeping cross-projection scores comparable
    and reproducible without relying on a shared row ordering."""
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


def _continuity(embedding, coords, k: int, metric: str) -> float:
    """Continuity — the dual of ``sklearn.manifold.trustworthiness``.

    High-dim neighbour sets use ``metric``; low-dim ranks use euclidean. Uses
    sklearn's exact normalisation, so it is directly comparable to the
    trustworthiness value and is bit-identical to
    ``trustworthiness(coords, embedding, metric="euclidean")`` when ``metric`` is
    euclidean. sklearn's ``trustworthiness`` only applies ``metric`` to its first
    (ranked) argument, so continuity with a non-euclidean high-dim metric cannot
    be expressed through it — hence this helper.
    """
    from sklearn.metrics import pairwise_distances
    from sklearn.neighbors import NearestNeighbors

    n = coords.shape[0]
    # Ranks come from the low-dim (output) space, euclidean.
    dist_lo = pairwise_distances(coords, metric="euclidean")
    np.fill_diagonal(dist_lo, np.inf)
    ind_lo = np.argsort(dist_lo, axis=1)
    # Neighbour sets come from the high-dim (input) space, using hi_metric.
    ind_hi = (
        NearestNeighbors(n_neighbors=k, metric=metric)
        .fit(embedding)
        .kneighbors(return_distance=False)
    )
    inverted = np.zeros((n, n), dtype=int)
    order = np.arange(n + 1)
    inverted[order[:-1, np.newaxis], ind_lo] = order[1:]
    ranks = inverted[order[:-1, np.newaxis], ind_hi] - k
    c = np.sum(ranks[ranks > 0])
    c = 1.0 - c * (2.0 / (n * k * (2.0 * n - 3.0 * k - 1.0)))
    return float(c)


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
        coords_src = (
            ctx.embedding_coords if ctx.embedding_coords is not None else ctx.coords
        )
        coords = np.asarray(coords_src, dtype=float)
        ids = ctx.embedding_ids if ctx.embedding_ids is not None else ctx.ids
        n = emb.shape[0]
        if n < 3:
            return []

        k = int(ctx.params.get("k", DEFAULT_K))
        sample_threshold = int(
            ctx.params.get("sample_threshold", DEFAULT_SAMPLE_THRESHOLD)
        )
        hard_ceiling = int(ctx.params.get("hard_ceiling", DEFAULT_HARD_CEILING))
        hi_metric = ctx.high_dim_metric or "euclidean"

        base = {
            "space_kind": ctx.space_kind,
            "space_name": ctx.space_name,
            "stat_family": self.family,
            "label_kind": "none",
            "metric_kind": "faithfulness",
            # Faithfulness is a per-projection scalar: route it into the
            # projection's info_json.quality, not the aggregate fifth part.
            "destination": "projection_metadata",
        }

        if n > hard_ceiling:
            return [
                StatRow(
                    metric="knn_overlap",
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
            # Select in canonical id order so WHICH proteins are sampled depends
            # only on the id-set (matching the order-invariant seed), not on the
            # input row order. order[r] = original row of the r-th smallest id.
            order = np.argsort(np.asarray(ids), kind="stable")
            idx = np.sort(order[rng.permutation(n)[:sample_threshold]])
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
        # Each metric differs only in its value computation and the high-dim metric
        # recorded in ``extra``. Trustworthiness and continuity are duals that both
        # rank the embedding by ``hi_metric`` (continuity via ``_continuity`` since
        # sklearn can only metric-rank its first arg). Each is best-effort — a
        # failure drops only that row.
        metrics = (
            ("knn_overlap", lambda: _knn_overlap(emb, coords, k, hi_metric), hi_metric),
            (
                "trustworthiness",
                lambda: float(
                    trustworthiness(emb, coords, n_neighbors=k, metric=hi_metric)
                ),
                hi_metric,
            ),
            (
                "continuity",
                lambda: _continuity(emb, coords, k, hi_metric),
                hi_metric,
            ),
        )
        rows: list[StatRow] = []
        for metric_name, value_fn, extra_metric in metrics:
            try:
                rows.append(
                    StatRow(
                        metric=metric_name,
                        value=value_fn(),
                        extra={**common, "metric": extra_metric},
                        **base,
                    )
                )
            except Exception:  # noqa: BLE001 - faithfulness is best-effort
                pass

        return rows
