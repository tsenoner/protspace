"""Exact (brute-force) k-nearest-neighbour search over reference embeddings.

Distances are computed with a chunked BLAS matrix product (numpy ``@``) plus
``argpartition`` — the GEMM path, which is roughly an order of magnitude faster
than a naive per-pair distance loop while staying pure-numpy (no third-party
distance/ANN library).

The query axis is chunked and, adaptively, bounded against the reference axis so
the per-chunk distance block is kept at or below ``max_block_bytes`` (default
256 MiB) regardless of ``n_refs``.  This keeps peak memory close to the
reference matrix itself even at Swiss-Prot scale (~570 000 references).
"""

from __future__ import annotations

import warnings

import numpy as np

_METRICS = {"euclidean", "cosine"}

# The float32 GEMM distance loses precision to catastrophic cancellation for
# high-norm pLM embeddings, so its top-k *selection* (argpartition) can drop a
# true nearest whose float32 distance is noise.  The exact float64 rerank can
# only reorder the candidates selection kept — it cannot recover a nearest that
# was never selected.  So over-fetch a wider candidate pool before the rerank;
# the pad gives small k (e.g. the default k=1) a real margin, the factor scales
# it for larger k.  Cost is still O(b * k_pool * d) << the O(b * n_refs) GEMM.
_RERANK_OVERFETCH = 2  # multiplicative widening of the candidate pool
_RERANK_PAD = 16  # additive floor so small k still over-fetches


def _rerank_pool_size(k: int, n_refs: int) -> int:
    """Number of float32-selected candidates to rerank in float64 for a top-k."""
    return min(n_refs, max(k * _RERANK_OVERFETCH, k + _RERANK_PAD))


def _exact_distances(block: np.ndarray, sel: np.ndarray, metric: str) -> np.ndarray:
    """Distances from each query (block[i]) to its pool candidates (sel[i]) in float64.

    The fast GEMM block selects a candidate pool; this recomputes their
    distances by direct subtraction in float64 to avoid the catastrophic
    cancellation of ``||q||^2 - 2 q.r + ||r||^2`` for near-identical vectors.
    Cost is O(b * k_pool * d), not O(b * n_refs), so it is cheap.
    """
    blk = block[:, None, :].astype(np.float64)  # (b, 1, d)
    sel = sel.astype(np.float64)  # (b, k, d)
    if metric == "euclidean":
        diff = blk - sel
        return np.sqrt(np.einsum("bkd,bkd->bk", diff, diff))
    bn = np.linalg.norm(blk, axis=2, keepdims=True)
    bn = np.where(bn == 0.0, 1.0, bn)
    sn = np.linalg.norm(sel, axis=2, keepdims=True)
    sn = np.where(sn == 0.0, 1.0, sn)
    cos = np.einsum("bkd,bkd->bk", blk / bn, sel / sn)
    return np.clip(1.0 - cos, 0.0, 2.0)


def nearest(
    queries: np.ndarray,
    refs: np.ndarray,
    k: int,
    metric: str = "euclidean",
    chunk: int = 4096,
    max_block_bytes: int = 256 * 1024 * 1024,
) -> tuple[np.ndarray, np.ndarray]:
    """Return (idx, dist) of the k nearest *references* per query.

    idx[i]  -> indices into ``refs`` of the k nearest, ascending by distance.
    dist[i] -> the corresponding distances.
    k is capped to the number of references.

    Memory behaviour
    ----------------
    The per-chunk distance block has shape ``(query_chunk, n_refs)``.  When
    ``n_refs`` is large (e.g. Swiss-Prot ~570 000), even a modest ``chunk`` of
    4096 yields a multi-GiB block.  To bound this, the effective query-chunk
    size ``eff_chunk`` is computed as ``min(chunk, max_block_bytes // (n_refs *
    8))`` so each block stays at or below ``max_block_bytes`` (default 256 MiB)
    independent of ``n_refs``.  The factor 8 budgets for a float64-sized block;
    each metric holds a single copy of the reference matrix (cosine folds the
    per-reference norm into the dot product rather than storing a normalized
    second copy) plus a few float32 ``(query_chunk, n_refs)`` temporaries, so the
    real peak is comparable to (not far below) that budget.  The exact-distance
    recompute only touches the over-fetched candidate pool (a small multiple of
    k, not n_refs), so peak memory remains close to the reference matrix itself,
    making the function laptop-feasible at Swiss-Prot scale.
    """
    if metric not in _METRICS:
        raise ValueError(f"Unknown metric {metric!r}; expected 'euclidean' or 'cosine'")

    if k < 1:
        raise ValueError("k must be >= 1")

    queries = np.ascontiguousarray(queries, dtype=np.float32)
    refs = np.ascontiguousarray(refs, dtype=np.float32)
    n_refs = refs.shape[0]
    k = min(k, n_refs)
    k_pool = _rerank_pool_size(k, n_refs)

    # Adaptively shrink the query chunk so the distance block stays within
    # max_block_bytes (budgeting for a float64 = 8 bytes-per-element block).
    bytes_per_row = max(1, n_refs * 8)
    eff_chunk = max(1, min(chunk, max_block_bytes // bytes_per_row))

    idx_out = np.empty((queries.shape[0], k), dtype=np.int64)
    dist_out = np.empty((queries.shape[0], k), dtype=np.float32)

    # Per-reference squared norms (shape (n_refs,), tiny) — used by both metrics:
    #   euclidean: ||q-r||^2 = ||q||^2 - 2 q.r + ||r||^2
    #   cosine:    cos = q.r / (||q|| ||r||) — folding ||r|| in here (rather than
    #              storing a second, full-size normalized copy of the reference
    #              matrix) keeps cosine at 1x reference memory, like euclidean.
    refs_sq = np.einsum("ij,ij->i", refs, refs)
    refs_norm = np.sqrt(refs_sq) if metric == "cosine" else None

    for start in range(0, queries.shape[0], eff_chunk):
        block = queries[start : start + eff_chunk]
        with warnings.catch_warnings():
            # GEMM on near-overflowing float16-origin values can emit harmless
            # RuntimeWarnings; the inputs are upcast float32 so values are safe.
            warnings.simplefilter("ignore", RuntimeWarning)
            if metric == "euclidean":
                block_sq = np.einsum("ij,ij->i", block, block)
                cross = block @ refs.T  # (b, n_refs), BLAS GEMM
                d2 = block_sq[:, None] - 2.0 * cross + refs_sq[None, :]
                np.maximum(d2, 0.0, out=d2)  # clip tiny negative fp artifacts
                d = np.sqrt(d2, dtype=np.float32)
            else:  # cosine
                cross = block @ refs.T  # (b, n_refs) raw dot products, BLAS GEMM
                block_norm = np.sqrt(np.einsum("ij,ij->i", block, block))
                # Zero-magnitude rows -> safe norm 1; the dot product is 0 there,
                # so the cosine distance stays a finite 1.0 (matches normalizing a
                # zero vector to a zero vector).
                safe_b = np.where(block_norm == 0.0, 1.0, block_norm)
                safe_r = np.where(refs_norm == 0.0, 1.0, refs_norm)
                d = (1.0 - cross / (safe_b[:, None] * safe_r[None, :])).astype(
                    np.float32
                )
                np.clip(d, 0.0, 2.0, out=d)  # cosine distance in [0, 2]

        # Over-fetch a candidate pool with the fast (float32) block, recompute
        # the pool's distances exactly in float64, then take the true top-k from
        # it — so both the *selection* and the reported distance are robust to
        # the float32 GEMM's catastrophic cancellation for near-identical (or
        # high-norm) vectors. Reranking a too-narrow pool cannot recover a true
        # nearest the float32 selection dropped; see _rerank_pool_size.
        cand = np.argpartition(d, kth=k_pool - 1, axis=1)[:, :k_pool]  # unsorted pool
        rows = np.arange(block.shape[0])[:, None]
        exact = _exact_distances(block, refs[cand], metric)  # (b, k_pool) float64
        order = np.argsort(exact, axis=1)[:, :k]  # true top-k, ascending by exact dist
        idx_out[start : start + block.shape[0]] = cand[rows, order]
        dist_out[start : start + block.shape[0]] = exact[rows, order].astype(np.float32)

    return idx_out, dist_out
