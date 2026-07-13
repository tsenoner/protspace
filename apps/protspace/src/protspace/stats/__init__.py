"""Projection statistics — registry + entry point.

Mirrors the lazy ``REDUCERS`` pattern in ``protspace.utils``: statistic classes
(which pull in scikit-learn) are imported on first ``get_statistics()`` call, not
at package import, so ``import protspace`` / CLI startup stays fast.
"""

from __future__ import annotations

_STATISTICS: list | None = None


def get_statistics() -> list:
    """Return the registered Statistic instances (lazy-imported)."""
    global _STATISTICS
    if _STATISTICS is None:
        from protspace.stats.metrics.annotation_validity import (
            AnnotationValidityStatistic,
        )
        from protspace.stats.metrics.faithfulness import FaithfulnessStatistic
        from protspace.stats.metrics.validity import ClusterValidityStatistic

        _STATISTICS = [
            ClusterValidityStatistic(),
            AnnotationValidityStatistic(),
            FaithfulnessStatistic(),
        ]
    return _STATISTICS


def compute_statistics(*args, **kwargs):
    """Run the statistics driver (lazy import to keep this module light)."""
    from protspace.stats.driver import compute_statistics as _compute

    return _compute(*args, **kwargs)


__all__ = ["get_statistics", "compute_statistics"]
