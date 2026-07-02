"""Projection-faithfulness statistics vs. the source embedding.

Two families (tagged by ``scope`` in each row's ``extra``):
  local  — kNN-neighbourhood preservation: ``knn_overlap``, ``trustworthiness``,
           ``continuity`` (do nearby points stay nearby?).
  global — whole-layout preservation: ``random_triplet`` (relative-ordering
           accuracy over random triplets) and ``spearman_distance`` (rank
           correlation of all pairwise distances) — the mid/long-range structure
           the local metrics miss.

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
DEFAULT_N_TRIPLETS_PER_POINT = 5


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


def _random_triplet_accuracy(
    embedding, coords, k_per_point: int, metric: str, rng
) -> float:
    """Global structure: fraction of random triplets (i, j, l) whose distance
    ordering agrees between the embedding and the projection.

    For each anchor i and two random others j, l: does "is j or l closer to i?"
    match in high-dim (``metric``) and low-dim (euclidean)? 0.5 ≈ chance, 1.0 =
    every relative ordering preserved. Samples ``k_per_point`` triplets per point
    (O(n·k_per_point)), so it probes mid/long-range layout, unlike the kNN metrics.
    """
    from sklearn.metrics.pairwise import paired_distances

    n = embedding.shape[0]
    anchors = np.repeat(np.arange(n), k_per_point)
    t = anchors.shape[0]
    j = rng.integers(0, n, t)
    m = rng.integers(0, n, t)
    d_hi_j = paired_distances(embedding[anchors], embedding[j], metric=metric)
    d_hi_m = paired_distances(embedding[anchors], embedding[m], metric=metric)
    d_lo_j = paired_distances(coords[anchors], coords[j], metric="euclidean")
    d_lo_m = paired_distances(coords[anchors], coords[m], metric="euclidean")
    agree = (d_hi_j < d_hi_m) == (d_lo_j < d_lo_m)
    return float(np.mean(agree))


def _spearman_distance(embedding, coords, metric: str) -> float:
    """Global structure: Spearman (rank) correlation between all pairwise
    embedding distances (``metric``) and projection distances (euclidean).

    Uses every unique pair (upper triangle), so it measures whether the *overall*
    distance layout — not just local neighbourhoods — is preserved. Range [-1, 1],
    higher = better. Computed with numpy ranks + Pearson (no scipy dependency).
    """
    from sklearn.metrics import pairwise_distances

    n = embedding.shape[0]
    iu = np.triu_indices(n, k=1)
    hi = pairwise_distances(embedding, metric=metric)[iu]
    lo = pairwise_distances(coords, metric="euclidean")[iu]
    # Spearman = Pearson on ranks; argsort-of-argsort gives dense 0-based ranks.
    rank_hi = np.argsort(np.argsort(hi))
    rank_lo = np.argsort(np.argsort(lo))
    return float(np.corrcoef(rank_hi, rank_lo)[0, 1])


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
        n_per_point = int(
            ctx.params.get("n_triplets_per_point", DEFAULT_N_TRIPLETS_PER_POINT)
        )
        triplet_rng = np.random.default_rng(ctx.rng_seed)
        # Two families, each entry (name, value_fn, extra). ``scope="local"`` are the
        # kNN-neighbourhood metrics (trustworthiness/continuity are metric-consistent
        # duals via ``_continuity``); ``scope="global"`` probe the whole-layout
        # structure the local metrics miss. Each is best-effort — a failure drops
        # only that row.
        metrics = (
            (
                "knn_overlap",
                lambda: _knn_overlap(emb, coords, k, hi_metric),
                {"metric": hi_metric, "scope": "local"},
            ),
            (
                "trustworthiness",
                lambda: float(
                    trustworthiness(emb, coords, n_neighbors=k, metric=hi_metric)
                ),
                {"metric": hi_metric, "scope": "local"},
            ),
            (
                "continuity",
                lambda: _continuity(emb, coords, k, hi_metric),
                {"metric": hi_metric, "scope": "local"},
            ),
            (
                "random_triplet",
                lambda: _random_triplet_accuracy(
                    emb, coords, n_per_point, hi_metric, triplet_rng
                ),
                {
                    "metric": hi_metric,
                    "scope": "global",
                    "n_triplets": int(n_per_point * n),
                },
            ),
            (
                "spearman_distance",
                lambda: _spearman_distance(emb, coords, hi_metric),
                {"metric": hi_metric, "scope": "global"},
            ),
        )
        rows: list[StatRow] = []
        for metric_name, value_fn, extra_extra in metrics:
            try:
                rows.append(
                    StatRow(
                        metric=metric_name,
                        value=value_fn(),
                        extra={**common, **extra_extra},
                        **base,
                    )
                )
            except Exception:  # noqa: BLE001 - faithfulness is best-effort
                pass

        return rows
