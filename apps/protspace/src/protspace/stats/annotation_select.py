"""Select which annotation columns to score, and materialise their labels.

An annotation is "suitable" for cluster-validity when it is a low-cardinality
categorical column: at least 2 distinct non-empty values, at most
``min(max_card, n/2)`` (so it is not effectively an id), and not numeric. The
generated ``cluster_*`` membership columns and the id column are excluded.
"""

from __future__ import annotations

import logging

from protspace.data.annotations.scores import _strip_scores_from_cell
from protspace.stats.base import CLUSTER_COLUMN_PREFIX

logger = logging.getLogger(__name__)

# Values treated as "missing" (dropped, never a category). Kept in sync with the
# codebase's canonical sentinels: ``core.constants.standardize_missing`` maps
# ``"", nan, none, null, NA, NaN`` → the display sentinel ``"<N/A>"``; pandas
# nullable dtypes stringify to ``"<NA>"`` / ``"NaT"``. Missing any of these would
# score a phantom missing-value cluster and inflate a column's cardinality.
_MISSING = {
    "",
    "<N/A>",
    "<NA>",
    "<NaN>",
    "nan",
    "NaN",
    "NaT",
    "none",
    "None",
    "null",
    "NA",
}


def _is_missing(value) -> bool:
    """Whether a raw cell value is missing (None or a sentinel string)."""
    return value is None or str(value) in _MISSING


def _category(value) -> str:
    """The bare category label of a cell: its ``value|score`` evidence/bit-score
    suffix stripped (per ``;``-separated entry), matching ``strip_scores_from_df``.

    Scoring an annotation on ``value|EXP`` vs ``value|IEA`` would split one
    biological category into several, so silhouette/DBI/CH and ARI/NMI must see
    the stripped category — the same convention the cluster-legend carriage uses.
    """
    return _strip_scores_from_cell(str(value))


def _clean(series) -> list[str]:
    """Non-missing bare-category string values of a column (scores stripped)."""
    return [_category(v) for v in series.tolist() if not _is_missing(v)]


def _is_numeric(vals) -> bool:
    """Whether every (already-cleaned) value parses as a float."""
    if not vals:
        return False
    try:
        for s in vals:
            float(s)
        return True
    except ValueError:
        return False


def _is_suitable_column(series, cap: int) -> bool:
    """A low-cardinality categorical: 2..cap distinct non-missing values, not
    all-unique (id-like), and not numeric.

    Bails out as soon as the distinct count exceeds ``cap`` so a high-cardinality
    free-text column doesn't grow a full 570k-value set before rejection.
    """
    seen: set[str] = set()
    total = 0
    for v in series.tolist():
        if _is_missing(v):
            continue
        total += 1
        seen.add(_category(v))
        if len(seen) > cap:  # too many categories → not a low-card categorical
            return False
    distinct = len(seen)
    if distinct < 2 or distinct == total:  # too few, or all-unique (id-like)
        return False
    return not _is_numeric(seen)


def suitable_annotations(
    frame, id_col: str = "identifier", max_card: int = 50
) -> list[str]:
    n = len(frame)
    cap = min(max_card, max(2, n // 2))
    return [
        col
        for col in frame.columns
        if col != id_col
        and not col.startswith(CLUSTER_COLUMN_PREFIX)
        and _is_suitable_column(frame[col], cap)
    ]


def build_annotation_labels(
    frame, selection, id_col: str = "identifier"
) -> dict[str, dict[str, str]]:
    """``{annotation name -> {protein id -> category}}`` for the selection.

    ``selection`` is ``"auto"`` (all suitable), a comma-separated string of
    column names (the raw ``--stats-annotation`` flag), or a list of names.
    Missing / sentinel values are dropped, so a protein absent from a column's
    mapping simply has no category for it.
    """
    cols = list(getattr(frame, "columns", []))
    if id_col not in cols:
        return {}
    # ``wanted is None`` means "auto" (all suitable columns); otherwise it is the
    # explicit list of requested names. Splitting the raw flag string here keeps
    # every caller from re-implementing the "auto vs comma-list" parse.
    if isinstance(selection, str):
        stripped = selection.strip()
        wanted = (
            None
            if stripped.lower() == "auto"
            else [s.strip() for s in stripped.split(",") if s.strip()]
        )
    else:
        wanted = [str(s).strip() for s in selection if str(s).strip()]

    if wanted is None:
        names = suitable_annotations(frame, id_col=id_col)
    else:
        # Explicit names: honour the request. The suitability heuristic (cardinality
        # cap, numeric/id-like exclusion) is a *discovery* filter for ``auto``, not
        # an authorisation gate — a user who names ``ec_number`` wants it scored even
        # though it is high-cardinality. Only require what the metric needs: the
        # column exists and carries >= 2 distinct non-missing categories.
        names = []
        for name in wanted:
            if name == id_col or name not in cols:
                logger.warning(
                    "--stats-annotation '%s' is not a column; skipping", name
                )
            elif len({*_clean(frame[name])}) < 2:
                logger.warning(
                    "--stats-annotation '%s' has fewer than 2 categories; skipping",
                    name,
                )
            else:
                names.append(name)
    labels: dict[str, dict[str, str]] = {}
    ids = [str(i) for i in frame[id_col].tolist()]
    for name in names:
        mapping = {
            pid: _category(v)
            for pid, v in zip(ids, frame[name].tolist(), strict=False)
            if not _is_missing(v)
        }
        if mapping:
            labels[name] = mapping
    return labels


def pair_by_id(mapping, lookup):
    """Align an annotation ``{id: category}`` mapping to an id-keyed ``lookup``.

    Returns parallel lists ``(values, categories)`` over the ids present in both,
    where ``values[i] == lookup[id]``. Ids missing from ``lookup`` (a point absent
    from this space) are dropped — used by cluster-agreement to pair each auto
    cluster label with its annotation category over the id-intersection.
    """
    values: list = []
    categories: list = []
    for pid, cat in mapping.items():
        v = lookup.get(pid)
        if v is not None:
            values.append(v)
            categories.append(cat)
    return values, categories
