import pandas as pd


def standardize_missing(series: pd.Series) -> pd.Series:
    """Replaces various forms of missing values with '<NaN>' in a pandas Series."""
    series = series.astype(str)
    missing_values = ["", "nan", "none", "null", "<NA>"]
    replacements = {value: "<NaN>" for value in missing_values}

    return series.replace(replacements).fillna("<NaN>")
