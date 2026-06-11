"""Exact (brute-force) k-nearest-neighbour search over reference embeddings.

Chunked over both the query axis and, adaptively, the reference axis so the
per-chunk float64 distance block emitted by ``cdist`` is bounded to
``max_block_bytes`` (default 256 MiB) regardless of ``n_refs``.  This keeps
peak memory near the reference matrix itself even at Swiss-Prot scale
(~570 000 references).  scipy.cdist handles both euclidean and cosine.
"""

from __future__ import annotations

import numpy as np
from scipy.spatial.distance import cdist

_METRICS = {"euclidean", "cosine"}


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
    ``cdist`` internally produces a float64 block of shape
    ``(query_chunk, n_refs)``.  When ``n_refs`` is large (e.g. Swiss-Prot
    ~570 000), even a modest ``chunk`` of 4096 yields a ~19 GiB block.
    To bound this, the effective query-chunk size ``eff_chunk`` is computed
    as ``min(chunk, max_block_bytes // (n_refs * 8))`` so the float64 block
    stays at or below ``max_block_bytes`` (default 256 MiB) independent of
    ``n_refs``.  Peak memory therefore remains close to the reference matrix
    itself, making the function laptop-feasible at Swiss-Prot scale.
    """
    if metric not in _METRICS:
        raise ValueError(f"Unknown metric {metric!r}; expected 'euclidean' or 'cosine'")

    if k < 1:
        raise ValueError("k must be >= 1")

    queries = np.ascontiguousarray(queries, dtype=np.float32)
    refs = np.ascontiguousarray(refs, dtype=np.float32)
    n_refs = refs.shape[0]
    k = min(k, n_refs)

    # Adaptively shrink the query chunk so the float64 cdist block stays
    # within max_block_bytes (cdist emits float64 = 8 bytes per element).
    bytes_per_row = max(1, n_refs * 8)
    eff_chunk = max(1, min(chunk, max_block_bytes // bytes_per_row))

    idx_out = np.empty((queries.shape[0], k), dtype=np.int64)
    dist_out = np.empty((queries.shape[0], k), dtype=np.float32)

    for start in range(0, queries.shape[0], eff_chunk):
        block = queries[start : start + eff_chunk]
        d = cdist(block, refs, metric=metric).astype(np.float32)  # (b, n_refs)
        part = np.argpartition(d, kth=k - 1, axis=1)[:, :k]  # unsorted top-k
        rows = np.arange(block.shape[0])[:, None]
        part_d = d[rows, part]
        order = np.argsort(part_d, axis=1)  # sort the k by distance
        sorted_idx = part[rows, order]
        idx_out[start : start + block.shape[0]] = sorted_idx
        dist_out[start : start + block.shape[0]] = d[rows, sorted_idx]

    return idx_out, dist_out
