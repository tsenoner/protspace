"""goPredSim reliability index: map an embedding distance to a [0,1] confidence.

Cosine:     s(d) = 1 - d             (clamped to [0,1]; cosine distance in [0,2])
Euclidean:  s(d) = 0.5 / (0.5 + d)   (1.0 at d=0, 0.5 at d=0.5, ->0 as d->inf)

Both branches return a value in [0, 1], and a non-finite distance (NaN/inf) maps
to 0.0 so an invalid neighbour never yields a spuriously high confidence.

The ``protspace transfer`` CLI defaults to cosine — ``1 - d`` is the cosine
similarity, which is directly interpretable and naturally bounded. The lower-level
``protlabel`` engine API (``eat``/``Lookup``/``nearest``) keeps euclidean as its
default to match the published goPredSim reference implementation.

The euclidean transform ``0.5 / (0.5 + d)`` is the published goPredSim constant,
calibrated against ProtT5 distances. On embedding spaces whose raw distances are
much larger than ~0.5 (common) it collapses toward 0 even for near neighbours, so
the *ordering* of confidences stays meaningful but the absolute value is hard to
interpret.

Reference: Littmann et al., Sci Rep 2021 (Eq. 5); goPredSim calc_reliability_index.
"""

from __future__ import annotations

import math


def similarity(distance: float, metric: str) -> float:
    """Per-neighbour distance->similarity (the goPredSim reliability transform).

    Always returns a value in [0, 1]. A negative distance is treated as 0; a
    non-finite distance (NaN/inf) maps to 0.0 so an invalid neighbour never
    produces a spuriously high confidence.
    """
    if not math.isfinite(distance):
        return 0.0
    if metric == "cosine":
        return min(1.0, max(0.0, 1.0 - distance))
    if metric == "euclidean":
        # d >= 0 makes 0.5 / (0.5 + d) fall in (0, 1] already; no clamp needed.
        return 0.5 / (0.5 + max(0.0, distance))
    raise ValueError(f"Unknown metric {metric!r}; expected 'euclidean' or 'cosine'")
