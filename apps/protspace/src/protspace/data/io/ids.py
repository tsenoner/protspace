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
    "keyed_on_protein_id",
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


def _columns(table: pa.Table | pd.DataFrame) -> list[str]:
    return table.column_names if isinstance(table, pa.Table) else list(table.columns)


def _renamed[T: (pa.Table, pd.DataFrame)](table: T, column: str) -> T:
    """*table* with *column* renamed ``protein_id``, its metadata or ``attrs`` kept
    (``rename_columns`` drops an Arrow table's, and with it the cell-grammar stamp)."""
    if not isinstance(table, pa.Table):
        return table.rename(columns={column: PROTEIN_ID_COLUMN})
    renamed = table.rename_columns(
        [PROTEIN_ID_COLUMN if c == column else c for c in table.column_names]
    )
    return renamed.replace_schema_metadata(table.schema.metadata)


def with_protein_id[T: (pa.Table, pd.DataFrame)](
    table: T, *, source: str | None = None
) -> T:
    """*table* (Arrow or pandas) with a legacy ``identifier`` ID column renamed
    ``protein_id``.

    A table keyed on ``protein_id``, or holding neither name, comes back unchanged,
    the same object. With *source*, the file the table was read from, the rename
    logs the deprecation warning: pass it for a file the user wrote, not for a
    v1/v2 bundle (which warns for its format) or the pipeline's own cache.
    """
    if id_column_by_name(_columns(table)) != LEGACY_ID_COLUMN:
        return table
    if source is not None:
        deprecations.warn(deprecations.LEGACY_ID_COLUMN, logger, name=source)
    return _renamed(table, LEGACY_ID_COLUMN)


def keyed_on_protein_id[T: (pa.Table, pd.DataFrame)](
    table: T, *, source: str | None = None
) -> T:
    """An annotations table a user hands ``stats -a`` or ``bundle -a``, keyed on
    ``protein_id``.

    Its ID column is ``protein_id``, else ``identifier`` (as :func:`with_protein_id`,
    warning with *source*), else its first column, whatever its name. A table
    with no columns raises ``ValueError``.
    """
    columns = _columns(table)
    if not columns:
        raise ValueError("The table has no columns.")
    if id_column_by_name(columns) is not None:
        return with_protein_id(table, source=source)
    return _renamed(table, columns[0])
