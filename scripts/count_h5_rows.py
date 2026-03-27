#!/usr/bin/env python3
"""Count the total number of rows in an HDF5 file."""

import argparse
import sys

import h5py


def count_h5_rows(h5_file: str) -> int:
    """Count total number of entries across all datasets in an HDF5 file.

    Args:
        h5_file: Path to the HDF5 file

    Returns:
        Total number of rows across all datasets
    """
    with h5py.File(h5_file, "r") as f:
        return sum(len(f[k]) for k in f.keys())


def main():
    parser = argparse.ArgumentParser(description="Count rows in an HDF5 file")
    parser.add_argument("h5_file", help="Path to the HDF5 file")
    args = parser.parse_args()

    try:
        total_rows = count_h5_rows(args.h5_file)
        print(total_rows)
    except FileNotFoundError:
        print(f"Error: File '{args.h5_file}' not found", file=sys.stderr)
        sys.exit(1)
    except Exception as e:
        print(f"Error: {e}", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
