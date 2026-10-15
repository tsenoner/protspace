import math
from numbers import Real

import pandas as pd

from protspace.utils.arrow_reader import ArrowReader

# The spellings the web app reads as a missing annotation value: its
# ``MISSING_VALUE_TOKENS`` (packages/utils/src/visualization/missing-values.ts),
# which it compares against the trimmed, lower-cased cell. The bundle contract
# suite (tests/contract) fails when the two sets differ.
MISSING_VALUE_TOKENS = frozenset({"na", "n/a", "nan", "null", "none", "__na__"})


def is_missing_value(value) -> bool:
    """Whether the web app reads this annotation cell as missing (N/A).

    The web's ``normalizeMissingValue``, which every Python reader of annotation
    cells shares so none of them can disagree with the legend: a null (``None``,
    or pandas' ``NA``/``NaT``), a NaN or infinite number, or a string that is
    blank or, trimmed and lower-cased, one of ``MISSING_VALUE_TOKENS``. Anything
    else is a value.
    """
    if isinstance(value, str):
        stripped = value.strip()
        return not stripped or stripped.lower() in MISSING_VALUE_TOKENS
    if isinstance(value, Real):
        return not math.isfinite(value)
    return pd.api.types.is_scalar(value) and bool(pd.isna(value))


def standardize_missing(series: pd.Series) -> pd.Series:
    """Show every missing cell (:func:`is_missing_value`) as ``'<N/A>'``.

    Judged on the raw values, before they become strings, so an infinite number
    or a pandas ``NA`` is N/A as on the web, not the category ``'inf'``/``'<NA>'``.
    """
    return series.astype(str).mask(series.map(is_missing_value), "<N/A>")


def is_projection_3d(reader: ArrowReader, projection_name: str) -> bool:
    """Check if a given projection is 3D."""
    if not projection_name or not reader:
        return False
    projection_info = reader.get_projection_info(projection_name)
    return projection_info["dimensions"] == 3
