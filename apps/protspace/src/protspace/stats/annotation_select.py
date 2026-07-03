"""Select which annotation columns to score, and materialise their labels.

An annotation is "suitable" for cluster-validity when it is a low-cardinality
categorical column: at least 2 distinct non-empty values, at most
``min(max_card, n/2)`` (so it is not effectively an id), and not numeric. The
generated ``cluster_*`` membership columns and the id column are excluded.
"""

from __future__ import annotations

import logging

logger = logging.getLogger(__name__)

_MISSING = {"", "<NaN>", "nan", "None"}


def _clean(series) -> list[str]:
    """Non-missing string values of a column."""
    out = []
    for v in series.tolist():
        if v is None:
            continue
        s = str(v)
        if s in _MISSING:
            continue
        out.append(s)
    return out


def _is_numeric(vals: list[str]) -> bool:
    """Whether every (already-cleaned) value parses as a float."""
    if not vals:
        return False
    try:
        for s in vals:
            float(s)
        return True
    except ValueError:
        return False


def suitable_annotations(
    frame, id_col: str = "identifier", max_card: int = 50
) -> list[str]:
    n = len(frame)
    cap = min(max_card, max(2, n // 2))
    names: list[str] = []
    for col in frame.columns:
        if col == id_col or col.startswith("cluster_"):
            continue
        vals = _clean(frame[col])
        distinct = len(set(vals))
        if distinct < 2 or distinct > cap:
            continue
        if distinct == len(vals):  # all-unique → id-like
            continue
        if _is_numeric(vals):
            continue
        names.append(col)
    return names


def build_annotation_labels(
    frame, selection, id_col: str = "identifier"
) -> dict[str, dict[str, str]]:
    """``{annotation name -> {protein id -> category}}`` for the selection.

    ``selection`` is the string ``"auto"`` (all suitable) or a list of column
    names. Missing / sentinel values are dropped, so a protein absent from a
    column's mapping simply has no category for it.
    """
    if id_col not in getattr(frame, "columns", []):
        return {}
    if isinstance(selection, str) and selection.lower() == "auto":
        names = suitable_annotations(frame, id_col=id_col)
    else:
        wanted = list(selection)
        available = suitable_annotations(frame, id_col=id_col)
        names = []
        for name in wanted:
            if name in available:
                names.append(name)
            else:
                logger.warning(
                    "--stats-annotation '%s' is missing or unsuitable; skipping", name
                )
    labels: dict[str, dict[str, str]] = {}
    ids = [str(i) for i in frame[id_col].tolist()]
    for name in names:
        col = frame[name].tolist()
        mapping: dict[str, str] = {}
        for pid, v in zip(ids, col, strict=False):
            if v is None:
                continue
            s = str(v)
            if s in _MISSING:
                continue
            mapping[pid] = s
        if mapping:
            labels[name] = mapping
    return labels
