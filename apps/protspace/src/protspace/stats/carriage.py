"""Carriage: fan routed statistic outputs to their bundle parts.

A ``StatRow`` declares a ``destination`` (see ``stats.base``); this module moves
the non-default destinations out of the tidy fifth part and into the bundle part
whose existing frontend consumer matches the statistic's granularity.

Phase 1 routes **faithfulness** (per-projection scalars) into each projection's
``info_json.quality``. Per-protein ``annotation`` routing (Phase 2) will live here
too.
"""

from __future__ import annotations

import math

from protspace.stats.base import StatRow, StatsReport


def _json_safe(value: float) -> float | None:
    """Map a faithfulness value to a JSON-serialisable one.

    The skip row carries ``NaN``; ``json.dumps`` would emit the non-standard
    ``NaN`` token, breaking the requirement that ``info_json`` stay valid JSON, so
    ``NaN`` becomes ``None`` (the consumer reads a missing value, with the skip
    marker still in the provenance).
    """
    if isinstance(value, float) and math.isnan(value):
        return None
    return value


def _quality_from_rows(rows: list[StatRow]) -> dict:
    """One projection's faithfulness rows → a ``quality`` dict keyed by metric.

    Each metric carries its value plus its own provenance (``k``, the high-dim
    distance metric, sampling and/or skip markers) so a consumer can render
    discrete per-metric rows.
    """
    quality: dict = {}
    for row in rows:
        quality[row.metric] = {"value": _json_safe(float(row.value)), **row.extra}
    return quality


def route_faithfulness_to_metadata(report: StatsReport, reductions: list[dict]) -> None:
    """Fold ``projection_metadata``-destined rows into each reduction's
    ``info['quality']``, in place.

    Rows are matched to reductions by name (``StatRow.space_name`` ==
    ``reduction['name']``). A reduction with no faithfulness rows is left
    untouched — no ``quality`` key — so a projection without an available
    embedding omits faithfulness rather than recording a wrong value.
    """
    by_space: dict[str, list[StatRow]] = {}
    for row in report.partition().get("projection_metadata", []):
        by_space.setdefault(row.space_name, []).append(row)
    if not by_space:
        return

    for reduction in reductions:
        rows = by_space.get(reduction.get("name"))
        if not rows:
            continue
        info = reduction.get("info")
        if not isinstance(info, dict):
            info = {}
            reduction["info"] = info
        info["quality"] = _quality_from_rows(rows)
