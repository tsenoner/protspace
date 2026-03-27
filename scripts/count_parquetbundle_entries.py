#!/usr/bin/env python3
"""Count the number of protein entries in a .parquetbundle file."""

import argparse
import io
import sys

import pyarrow.parquet as pq

DELIMITER = b"---PARQUET_DELIMITER---"


def count_entries(bundle_path: str) -> int:
    """Count unique protein IDs in a .parquetbundle file.

    The bundle contains three concatenated Parquet tables separated by a
    delimiter. The first table (selected_annotations) has one row per protein.
    Only reads up to the first delimiter to avoid loading the entire file.

    Args:
        bundle_path: Path to the .parquetbundle file

    Returns:
        Number of protein entries
    """
    with open(bundle_path, "rb") as f:
        chunks = []
        while True:
            chunk = f.read(1024 * 1024)
            if not chunk:
                break
            chunks.append(chunk)
            combined = b"".join(chunks)
            idx = combined.find(DELIMITER)
            if idx != -1:
                first_table_bytes = combined[:idx]
                return pq.read_table(io.BytesIO(first_table_bytes)).num_rows
        # No delimiter found — single table in file
        return pq.read_table(io.BytesIO(b"".join(chunks))).num_rows


def main():
    parser = argparse.ArgumentParser(
        description="Count protein entries in a .parquetbundle file"
    )
    parser.add_argument("bundle_file", help="Path to the .parquetbundle file")
    args = parser.parse_args()

    try:
        count = count_entries(args.bundle_file)
        print(count)
    except FileNotFoundError:
        print(f"Error: File '{args.bundle_file}' not found", file=sys.stderr)
        sys.exit(1)
    except Exception as e:
        print(f"Error: {e}", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
