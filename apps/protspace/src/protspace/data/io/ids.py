"""The protein ID column: the one name every written table uses, and how a read finds it.

Every table protspace writes keys its proteins on :data:`PROTEIN_ID_COLUMN`
(``protein_id``), shared with the web app through ``contracts/shared-constants.json``.
A v3 bundle names its ID column in the manifest (``idColumn``), so its reader needs
no rule. A table without a manifest (an unbundled directory, an annotation
parquet, the annotation cache, a v1/v2 bundle part) is found by name:
``protein_id``, else :data:`LEGACY_ID_COLUMN` (``identifier``), the name older
releases wrote. Beside ``protein_id``, an ``identifier`` column is an annotation.
That fallback ends in 5.0.0 (``deprecations.LEGACY_ID_COLUMN``).
"""

from __future__ import annotations

import logging
from collections.abc import Sequence

import pandas as pd
import pyarrow as pa

from protspace import deprecations
from protspace._generated.shared_constants import PROTEIN_ID_COLUMN

__all__ = [
    "LEGACY_ID_COLUMN",
    "PROTEIN_ID_COLUMN",
    "id_column_by_name",
    "with_protein_id",
]

logger = logging.getLogger(__name__)

#: The ID column's name before 4.17.0, read until 5.0.0.
LEGACY_ID_COLUMN = "identifier"


def id_column_by_name(columns: Sequence[str]) -> str | None:
    """``protein_id``, else ``identifier``, else ``None``: the ID column of a table
    without a manifest."""
    for name in (PROTEIN_ID_COLUMN, LEGACY_ID_COLUMN):
        if name in columns:
            return name
    return None


def with_protein_id[T: (pa.Table, pd.DataFrame)](
    table: T, *, source: str | None = None
) -> T:
    """*table* (Arrow or pandas) with a legacy ``identifier`` ID column renamed
    ``protein_id``.

    A table keyed on ``protein_id``, or holding neither name, comes back unchanged.
    An Arrow table keeps its schema metadata, which ``rename_columns`` drops and
    with it the cell-grammar stamp; a pandas frame keeps its ``attrs``. With
    *source*, the file the table was read from, the rename logs the deprecation
    warning: pass it for a file the user wrote, not for a v1/v2 bundle (which warns
    for its format) or the pipeline's own cache.
    """
    arrow = isinstance(table, pa.Table)
    columns = table.column_names if arrow else list(table.columns)
    if id_column_by_name(columns) != LEGACY_ID_COLUMN:
        return table
    if source is not None:
        deprecations.warn(deprecations.LEGACY_ID_COLUMN, logger, name=source)
    if not arrow:
        return table.rename(columns={LEGACY_ID_COLUMN: PROTEIN_ID_COLUMN})
    renamed = table.rename_columns(
        [PROTEIN_ID_COLUMN if c == LEGACY_ID_COLUMN else c for c in columns]
    )
    return renamed.replace_schema_metadata(table.schema.metadata)
