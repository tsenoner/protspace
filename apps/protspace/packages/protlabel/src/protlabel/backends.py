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


def _l2_normalize(x: np.ndarray) -> np.ndarray:
    """Row-wise L2 normalize.  Zero-magnitude rows stay zero (kept finite).

    A zero vector would make cosine distance NaN; mapping it to the zero vector
    yields a finite cosine distance of 1.0 to every reference instead.
    """
    norms = np.linalg.norm(x, axis=1, keepdims=True)
    safe = np.where(norms == 0.0, 1.0, norms)
    return x / safe


def _exact_distances(block: np.ndarray, sel: np.ndarray, metric: str) -> np.ndarray:
    """Distances from each query (block[i]) to its k candidates (sel[i]) in float64.

    The fast GEMM block selects the top-k candidates; this recomputes their
    distances by direct subtraction in float64 to avoid the catastrophic
    cancellation of ``||q||^2 - 2 q.r + ||r||^2`` for near-identical vectors.
    Cost is O(b * k * d), not O(b * n_refs), so it is cheap.
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
    the euclidean path holds a few float32 ``(query_chunk, n_refs)`` temporaries
    at once, so the real peak is comparable to (not far below) that budget.  The
    exact-distance recompute only touches the k surviving candidates, so peak
    memory remains close to the reference matrix itself, making the function
    laptop-feasible at Swiss-Prot scale.
    """
    if metric not in _METRICS:
        raise ValueError(f"Unknown metric {metric!r}; expected 'euclidean' or 'cosine'")

    if k < 1:
        raise ValueError("k must be >= 1")

    queries = np.ascontiguousarray(queries, dtype=np.float32)
    refs = np.ascontiguousarray(refs, dtype=np.float32)
    n_refs = refs.shape[0]
    k = min(k, n_refs)

    # Adaptively shrink the query chunk so the distance block stays within
    # max_block_bytes (budgeting for a float64 = 8 bytes-per-element block).
    bytes_per_row = max(1, n_refs * 8)
    eff_chunk = max(1, min(chunk, max_block_bytes // bytes_per_row))

    idx_out = np.empty((queries.shape[0], k), dtype=np.int64)
    dist_out = np.empty((queries.shape[0], k), dtype=np.float32)

    # Cosine: normalize once; distance is 1 - cosine similarity via a dot product.
    refs_unit = _l2_normalize(refs) if metric == "cosine" else None
    # Euclidean: precompute ||ref||^2 once; ||q-r||^2 = ||q||^2 - 2 q.r + ||r||^2.
    refs_sq = np.einsum("ij,ij->i", refs, refs) if metric == "euclidean" else None

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
                block_unit = _l2_normalize(block)
                d = (1.0 - block_unit @ refs_unit.T).astype(np.float32)
                np.clip(d, 0.0, 2.0, out=d)  # cosine distance in [0, 2]

        # Select the k candidates with the fast (float32) block, then recompute
        # their distances exactly in float64 and order by that — so the reported
        # distance is precise even for near-identical vectors.
        cand = np.argpartition(d, kth=k - 1, axis=1)[:, :k]  # unsorted top-k
        rows = np.arange(block.shape[0])[:, None]
        exact = _exact_distances(block, refs[cand], metric)  # (b, k) float64
        order = np.argsort(exact, axis=1)
        idx_out[start : start + block.shape[0]] = cand[rows, order]
        dist_out[start : start + block.shape[0]] = exact[rows, order].astype(np.float32)

    return idx_out, dist_out
