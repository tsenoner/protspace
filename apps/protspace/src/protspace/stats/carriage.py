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


def merge_annotation_columns(
    report: StatsReport, frame, id_col: str = "identifier"
) -> list[str]:
    """Merge ``annotation``-destined per-protein columns into an annotations frame.

    Each ``AnnotationColumn`` is joined onto ``frame`` by identifier (proteins
    absent from a column get no value, not a fabricated one). Mutates ``frame`` in
    place and returns the names of the columns added — membership values are
    non-numeric ``cluster N`` strings (optionally carrying an attached
    ``|silhouette`` confidence, like ECO / InterPro bit scores), so the downstream
    ``.astype(str)`` writer keeps them categorical.
    """
    if id_col not in getattr(frame, "columns", []):
        return []
    added: list[str] = []
    for col in report.annotation_columns:
        frame[col.name] = frame[id_col].map(col.values)
        added.append(col.name)
    return added


def _cluster_label_sort_key(label: str):
    """Order ``cluster N`` labels by their integer N, others alphabetically."""
    head, _, tail = label.rpartition(" ")
    if head and tail.isdigit():
        return (0, int(tail))
    return (1, label)


def build_cluster_legend_settings(report: StatsReport) -> dict:
    """Build a legend-settings map auto-styling each categorical membership column.

    Returns ``{column_name: LegendPersistedSettings}`` (the bundle's settings part
    format) with a full envelope per ``categorical`` ``AnnotationColumn`` — every
    field the frontend's ``sanitizeLegendSettingsEntry`` requires, categories keyed
    by the exact label strings with a Kelly-palette ``color`` + ``zOrder`` + ``shape``
    — so clusters are colored when selected without a manual styling step. Numeric
    columns (per-point silhouette) are left to the default continuous ramp.
    """
    from protspace.data.io.settings_converter import KELLYS_COLORS

    settings: dict = {}
    for col in report.annotation_columns:
        if col.kind != "categorical":
            continue
        # Membership values may carry an attached ``|silhouette`` confidence
        # (value|score) — strip it to recover the bare "cluster N" category, matching
        # how the frontend splits score-bearing annotation values.
        labels = sorted(
            {str(v).split("|", 1)[0] for v in col.values.values()},
            key=_cluster_label_sort_key,
        )
        categories = {
            label: {
                "zOrder": i,
                "color": KELLYS_COLORS[i % len(KELLYS_COLORS)],
                "shape": "circle",
            }
            for i, label in enumerate(labels)
        }
        settings[col.name] = {
            "maxVisibleValues": max(10, len(labels)),
            "shapeSize": 30,
            "sortMode": "size-desc",
            "hiddenValues": [],
            "enableDuplicateStackUI": False,
            "selectedPaletteId": "kellys",
            "categories": categories,
        }
    return settings
