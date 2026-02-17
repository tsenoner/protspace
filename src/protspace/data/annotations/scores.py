"""Score stripping utility for annotation DataFrames.

Moves the --no-scores presentation concern out of the retriever/parser layer
and into the CLI output stage, so that cached data always retains full scores.
"""

import pandas as pd

# Columns that may contain pipe-separated scores (evidence codes or bit scores).
# UniProt evidence codes: value|CODE  (e.g. "Cytoplasm|EXP")
# InterPro bit scores:    accession (name)|score  (e.g. "PF00001 (7tm_1)|50.2")
SCORE_BEARING_COLUMNS = [
    # UniProt evidence codes
    "ec",
    "cc_subcellular_location",
    "protein_families",
    "go_bp",
    "go_mf",
    "go_cc",
    # InterPro bit scores
    "pfam",
    "superfamily",
    "cath",
    "signal_peptide",
    "smart",
    "cdd",
    "panther",
    "prosite",
    "prints",
]


def strip_scores_from_df(df: pd.DataFrame) -> pd.DataFrame:
    """Remove |score suffixes from all score-bearing columns in a DataFrame.

    For each column in SCORE_BEARING_COLUMNS that exists in *df*, split each
    semicolon-separated entry on ``|`` and keep only the left side.

    Args:
        df: DataFrame with annotation columns (modified copy is returned).

    Returns:
        A new DataFrame with scores stripped from the relevant columns.
    """
    df = df.copy()
    for col in SCORE_BEARING_COLUMNS:
        if col not in df.columns:
            continue
        df[col] = df[col].apply(_strip_scores_from_cell)
    return df


def _strip_scores_from_cell(value) -> str:
    """Strip |score from every semicolon-separated entry in a single cell value."""
    if pd.isna(value) or value == "":
        return value
    value = str(value)
    parts = value.split(";")
    stripped = [part.split("|")[0] for part in parts]
    return ";".join(stripped)
