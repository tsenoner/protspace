"""Deterministic, id-canonical subsampling shared by the stats metrics.

Bounding cost at 570k+ scale means every heavy metric subsamples. To keep the
scores *comparable across spaces* (a projection vs its source embedding) and
*reproducible* regardless of a parquet/h5 row ordering, the draw is seeded from
the id-set (not the raw seed) and taken over rows in canonical id order — two
inputs sharing an id-set then select the same proteins.
"""

from __future__ import annotations

import hashlib

import numpy as np


def id_seed(rng_seed: int, ids: list[str]) -> int:
    """Seed derived from ``(rng_seed, sorted ids)``.

    Paired with a canonical-id-order selection, two inputs with the same id-set
    draw the same subset regardless of row order.
    """
    digest = hashlib.sha256("|".join(sorted(map(str, ids))).encode()).hexdigest()[:8]
    return (rng_seed * 2654435761 + int(digest, 16)) % (2**32)


def sorted_subsample(n: int, threshold: int, rng) -> np.ndarray | None:
    """Sorted positional index subsample of size ``threshold``, or ``None`` when
    ``n <= threshold``. Positional, so the caller must pass rows in canonical id
    order for the draw to be id-canonical."""
    if n <= threshold:
        return None
    return np.sort(rng.permutation(n)[:threshold])
