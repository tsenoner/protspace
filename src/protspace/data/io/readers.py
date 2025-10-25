"""
Data readers for different file formats.

This module provides unified interfaces for reading data from various file formats.
"""

from pathlib import Path

import h5py
import numpy as np
import pandas as pd


class DataReader:
    """Unified interface for reading different file formats."""

    @staticmethod
    def read_h5(path: Path) -> tuple[np.ndarray, list[str]]:
        """
        Read H5/HDF5 embedding file.

        Args:
            path: Path to H5/HDF5 file

        Returns:
            Tuple of (data array, list of headers)

        Raises:
            FileNotFoundError: If file doesn't exist
            KeyError: If expected datasets not found in file
        """
        if not path.exists():
            raise FileNotFoundError(f"H5 file not found: {path}")

        with h5py.File(path, "r") as f:
            # Try common dataset names
            if "embeddings" in f:
                data = f["embeddings"][:]
            elif "data" in f:
                data = f["data"][:]
            else:
                raise KeyError(
                    f"Could not find embeddings dataset in {path}. "
                    f"Available keys: {list(f.keys())}"
                )

            # Try to get headers
            if "headers" in f:
                headers_dataset = f["headers"][:]
                # Handle both string and bytes arrays
                if headers_dataset.dtype.kind == "S":
                    headers = [h.decode("utf-8") for h in headers_dataset]
                else:
                    headers = list(headers_dataset)
            elif "identifiers" in f:
                identifiers_dataset = f["identifiers"][:]
                if identifiers_dataset.dtype.kind == "S":
                    headers = [h.decode("utf-8") for h in identifiers_dataset]
                else:
                    headers = list(identifiers_dataset)
            else:
                # Generate default headers
                headers = [f"protein_{i}" for i in range(len(data))]

        return data, headers

    @staticmethod
    def read_csv(path: Path, **kwargs) -> pd.DataFrame:
        """
        Read CSV file.

        Args:
            path: Path to CSV file
            **kwargs: Additional arguments for pd.read_csv

        Returns:
            DataFrame

        Raises:
            FileNotFoundError: If file doesn't exist
        """
        if not path.exists():
            raise FileNotFoundError(f"CSV file not found: {path}")

        return pd.read_csv(path, **kwargs)

    @staticmethod
    def read_parquet(path: Path, **kwargs) -> pd.DataFrame:
        """
        Read Parquet file.

        Args:
            path: Path to Parquet file
            **kwargs: Additional arguments for pd.read_parquet

        Returns:
            DataFrame

        Raises:
            FileNotFoundError: If file doesn't exist
        """
        if not path.exists():
            raise FileNotFoundError(f"Parquet file not found: {path}")

        return pd.read_parquet(path, **kwargs)
