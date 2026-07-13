#!/usr/bin/env python3
"""
Merge multiple H5 batch files into a single H5 file.

This script combines embeddings from multiple H5 batch files (e.g., from
different UniProt query batches) into a single consolidated H5 file.

Usage:
    python merge_h5_batches.py --input-dir data/clans/CL0023/embs
    python merge_h5_batches.py --input-dir data/clans/CL0023/embs --output merged.h5
"""

import argparse
from pathlib import Path

import h5py


def merge_h5_files(input_files: list[Path], output_file: Path) -> None:
    """
    Merge multiple H5 files into a single file.

    Args:
        input_files: List of paths to input H5 files
        output_file: Path to output merged H5 file
    """
    all_ids = set()
    total_embeddings = 0

    # First pass: check for duplicates and count
    print("Checking input files...")
    for input_path in input_files:
        if not input_path.exists():
            raise FileNotFoundError(f"Input file not found: {input_path}")

        with h5py.File(input_path, "r") as f:
            file_ids = set(f.keys())
            duplicates = all_ids & file_ids

            if duplicates:
                print(
                    f"  Warning: {len(duplicates)} duplicate IDs found in {input_path.name}"
                )
                print(f"    First few: {list(duplicates)[:5]}")

            all_ids.update(file_ids)
            total_embeddings += len(file_ids)

    print(f"\nTotal unique proteins: {len(all_ids)}")
    print(f"Total embeddings (with duplicates): {total_embeddings}")

    # Second pass: merge files
    print(f"\nMerging {len(input_files)} files into {output_file}...")

    with h5py.File(output_file, "w") as out_f:
        proteins_written = 0

        for input_path in input_files:
            print(f"  Processing {input_path.name}...")

            with h5py.File(input_path, "r") as in_f:
                for protein_id in in_f.keys():
                    # Skip if already written (keep first occurrence)
                    if protein_id not in out_f:
                        embedding = in_f[protein_id][:]
                        out_f.create_dataset(protein_id, data=embedding)
                        proteins_written += 1

    print(f"\n✓ Successfully merged {proteins_written} unique proteins")
    print(f"  Output: {output_file}")


def main():
    """Main function."""
    parser = argparse.ArgumentParser(
        description="Merge multiple H5 batch files into a single H5 file"
    )

    parser.add_argument(
        "--input-dir",
        "-i",
        type=Path,
        required=True,
        help="Directory containing H5 batch files (merges all *.h5 files)",
    )
    parser.add_argument(
        "--output",
        "-o",
        type=Path,
        default=None,
        help="Output file path (default: merged.h5 in input directory)",
    )

    args = parser.parse_args()

    # Find all H5 files in the directory
    input_files = sorted(args.input_dir.glob("*.h5"))
    if not input_files:
        print(f"Error: No H5 files found in {args.input_dir}")
        return

    # Check that we have files to merge
    if len(input_files) < 2:
        print(f"Error: Need at least 2 files to merge, found {len(input_files)}")
        return

    # Default output in the input directory
    if args.output is None:
        args.output = args.input_dir / "merged.h5"

    print(f"Found {len(input_files)} input files:")
    for f in input_files:
        print(f"  - {f}")

    # Merge files
    merge_h5_files(input_files, args.output)


if __name__ == "__main__":
    main()
