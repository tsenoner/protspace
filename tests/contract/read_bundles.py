"""Read .parquetbundle files with the real Python reader and print what they mean.

The TypeScript -> Python half of the seam. ``bundle.contract.test.ts`` exports
bundles with the web writer (``packages/utils/src/parquet/bundle-writer.ts``) and
hands them here, next to the Python-written originals, so the two sides are
compared by the reader every downstream tool (``style``, ``transfer``,
``convert``, ``serve``) uses: ``read_tables``, which decodes v3 through
``decode_v3``.

The summary is what a bundle means: per protein, every annotation cell and
every finite coordinate, the Arrow type each annotation column decodes to, and a
digest of the statistics part. The column types are compared as strictly as the
values: the web writer echoes the ``sourceType`` the browser read from the
Python-written manifest, so a ``bool`` or ``double`` column must come back as
that type, not as re-inferred ``true``/``false`` labels or ``int64``. Only a
missing cell is folded, because it is null or the empty string depending on the
column type.
"""

from __future__ import annotations

import hashlib
import json
import sys
from pathlib import Path

from protspace.data.io.bundle import (
    read_settings_from_bundle,
    read_statistics_from_bundle,
    read_tables,
)


def cell(value: object) -> object:
    return None if value is None or value == "" else value


def summarize(path: Path) -> dict:
    annotations, _metadata, data = read_tables(path)
    id_column, *columns = annotations.column_names
    rows = {
        row[id_column]: {column: cell(row[column]) for column in columns}
        for row in annotations.to_pylist()
    }

    projections: dict[str, dict[str, list[float]]] = {}
    for row in data.to_pylist():
        axes = [row["x"], row["y"]] + ([row["z"]] if row.get("z") is not None else [])
        projections.setdefault(row["projection_name"], {})[row["identifier"]] = axes

    statistics = read_statistics_from_bundle(path)
    return {
        "annotations": rows,
        "types": {
            column: str(annotations.schema.field(column).type) for column in columns
        },
        "projections": projections,
        "statistics": hashlib.sha256(statistics).hexdigest() if statistics else None,
        "hasSettings": read_settings_from_bundle(path) is not None,
    }


if __name__ == "__main__":
    if len(sys.argv) < 2:
        raise SystemExit("usage: read_bundles.py <bundle>...")
    print(json.dumps({path: summarize(Path(path)) for path in sys.argv[1:]}))
