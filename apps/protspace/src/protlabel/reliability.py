"""goPredSim reliability index: map an embedding distance to a [0,1] confidence.

Euclidean:  s(d) = 0.5 / (0.5 + d)   (1.0 at d=0, 0.5 at d=0.5, ->0 as d->inf)
Cosine:     s(d) = 1 - d             (clamped to [0,1]; cosine distance in [0,2])

Reference: Littmann et al., Sci Rep 2021 (Eq. 5); goPredSim calc_reliability_index.
"""

from __future__ import annotations


def similarity(distance: float, metric: str) -> float:
    """Per-neighbour distance->similarity (the goPredSim reliability transform)."""
    if metric == "euclidean":
        return 0.5 / (0.5 + distance)
    if metric == "cosine":
        return min(1.0, max(0.0, 1.0 - distance))
    raise ValueError(f"Unknown metric {metric!r}; expected 'euclidean' or 'cosine'")
