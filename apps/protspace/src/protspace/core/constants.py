import pandas as pd

from protspace.utils.arrow_reader import ArrowReader

# Raw string forms treated as missing across the codebase (before normalisation
# to the "<N/A>" display sentinel). Shared so downstream consumers (e.g. the stats
# annotation selector) don't re-list them and drift out of sync.
MISSING_VALUE_TOKENS = ("", "nan", "none", "null", "NA", "NaN")

# The browser's ``MISSING_VALUE_TOKENS`` (packages/utils/src/visualization/
# missing-values.ts), matched against the trimmed, lower-cased cell. It differs
# from the list above because the browser also folds ``n/a`` and its own
# ``__na__`` sentinel, case-insensitively; the v3 encoder mirrors the browser.
BROWSER_MISSING_TOKENS = frozenset({"na", "n/a", "nan", "null", "none", "__na__"})


def standardize_missing(series: pd.Series) -> pd.Series:
    """Replaces various forms of missing values with '<N/A>' in a pandas Series."""
    series = series.astype(str)
    replacements = dict.fromkeys(MISSING_VALUE_TOKENS, "<N/A>")

    return series.replace(replacements).fillna("<N/A>")


def is_projection_3d(reader: ArrowReader, projection_name: str) -> bool:
    """Check if a given projection is 3D."""
    if not projection_name or not reader:
        return False
    projection_info = reader.get_projection_info(projection_name)
    return projection_info["dimensions"] == 3
