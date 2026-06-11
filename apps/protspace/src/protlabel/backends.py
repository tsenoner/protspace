"""Exact (brute-force) k-nearest-neighbour search over reference embeddings.

Chunked over the query axis so the Q_chunk x N distance block stays small,
which keeps peak memory near the reference matrix itself even at Swiss-Prot
scale. scipy.cdist handles both euclidean and cosine.
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
) -> tuple[np.ndarray, np.ndarray]:
    """Return (idx, dist) of the k nearest *references* per query.

    idx[i]  -> indices into ``refs`` of the k nearest, ascending by distance.
    dist[i] -> the corresponding distances.
    k is capped to the number of references.
    """
    if metric not in _METRICS:
        raise ValueError(f"Unknown metric {metric!r}; expected one of {_METRICS}")

    queries = np.ascontiguousarray(queries, dtype=np.float32)
    refs = np.ascontiguousarray(refs, dtype=np.float32)
    n_refs = refs.shape[0]
    k = min(k, n_refs)

    idx_out = np.empty((queries.shape[0], k), dtype=np.int64)
    dist_out = np.empty((queries.shape[0], k), dtype=np.float32)

    for start in range(0, queries.shape[0], chunk):
        block = queries[start : start + chunk]
        d = cdist(block, refs, metric=metric).astype(np.float32)  # (b, n_refs)
        part = np.argpartition(d, kth=k - 1, axis=1)[:, :k]  # unsorted top-k
        rows = np.arange(block.shape[0])[:, None]
        part_d = d[rows, part]
        order = np.argsort(part_d, axis=1)  # sort the k by distance
        sorted_idx = part[rows, order]
        idx_out[start : start + block.shape[0]] = sorted_idx
        dist_out[start : start + block.shape[0]] = d[rows, sorted_idx]

    return idx_out, dist_out
