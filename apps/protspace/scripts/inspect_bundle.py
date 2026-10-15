#!/usr/bin/env python3
"""Inspect a .parquetbundle: per-table rows/cols/schema, sample, and settings."""

import argparse
from pathlib import Path

from protspace.data.io.bundle import read_settings_from_bundle, read_tables

TABLE_NAMES = ["selected_annotations", "projections_metadata", "projections_data"]


def main():
    parser = argparse.ArgumentParser(description="Inspect a .parquetbundle file")
    parser.add_argument("bundle", help="Path to the .parquetbundle file")
    parser.add_argument(
        "-n", "--sample-rows", type=int, default=3, help="Rows to preview per table"
    )
    args = parser.parse_args()

    # read_tables decodes a v3 core back to the v2 shape, so a v3 bundle
    # inspects as the three tables it logically holds, not as its parts.
    tables = read_tables(Path(args.bundle))
    settings = read_settings_from_bundle(Path(args.bundle))

    for name, table in zip(TABLE_NAMES, tables, strict=True):
        print(f"== {name}: {table.num_rows} rows × {table.num_columns} cols ==")
        print(table.schema)
        if args.sample_rows > 0 and table.num_rows > 0:
            print(table.slice(0, args.sample_rows).to_pandas())
        print()

    if settings is None:
        print("settings: <absent>")
    else:
        print(f"settings: {len(settings)} top-level keys -> {list(settings)}")


if __name__ == "__main__":
    main()
