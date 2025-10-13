import pandas as pd
from protspace.utils import JsonReader


def standardize_missing(series: pd.Series) -> pd.Series:
    """Replaces various forms of missing values with '<NaN>' in a pandas Series."""
    series = series.astype(str)
    missing_values = ["", "nan", "none", "null", "<NA>"]
    replacements = {value: "<NaN>" for value in missing_values}

    return series.replace(replacements).fillna("<NaN>")


def is_projection_3d(reader: JsonReader, projection_name: str) -> bool:
    """Check if a given projection is 3D."""
    if not projection_name or not reader:
        return False
    projection_info = reader.get_projection_info(projection_name)
    return projection_info["dimensions"] == 3
