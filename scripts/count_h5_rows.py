#!/usr/bin/env python3
"""Inspect an HDF5 embedding file: entries, dimension, dtype."""

import argparse

import h5py


def main():
    parser = argparse.ArgumentParser(description="Inspect an HDF5 embedding file")
    parser.add_argument("h5_file", help="Path to the HDF5 file")
    args = parser.parse_args()

    with h5py.File(args.h5_file, "r") as f:
        keys = list(f.keys())
        sample = f[keys[0]]
        print(f"Entries:   {len(keys)}")
        print(f"Dimension: {sample.shape}")
        print(f"Dtype:     {sample.dtype}")


if __name__ == "__main__":
    main()
