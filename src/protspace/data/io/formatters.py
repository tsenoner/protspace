"""
Data formatters for different output types.

This module provides utilities for formatting data into different structures.
"""

from collections import namedtuple

import pandas as pd
import pyarrow as pa

ProteinFeatures = namedtuple("ProteinFeatures", ["identifier", "features"])


class DataFormatter:
    """Format data for different outputs."""

    @staticmethod
    def to_dataframe(proteins: list[ProteinFeatures]) -> pd.DataFrame:
        """
        Convert ProteinFeatures to DataFrame.

        Args:
            proteins: List of ProteinFeatures

        Returns:
            DataFrame with identifier column and feature columns
        """
        if not proteins:
            return pd.DataFrame(columns=["identifier"])

        # Extract headers
        headers = ["identifier"] + list(proteins[0].features.keys())

        # Convert to rows
        data_rows = []
        for protein in proteins:
            row = [protein.identifier] + [
                protein.features.get(header, "") for header in headers[1:]
            ]
            data_rows.append(row)

        return pd.DataFrame(data_rows, columns=headers)

    @staticmethod
    def to_arrow_table(proteins: list[ProteinFeatures]) -> pa.Table:
        """
        Convert ProteinFeatures to Arrow Table.

        Args:
            proteins: List of ProteinFeatures

        Returns:
            PyArrow Table
        """
        # Convert to DataFrame first, then to Arrow
        df = DataFormatter.to_dataframe(proteins)
        return pa.Table.from_pandas(df)

    @staticmethod
    def to_dict_list(proteins: list[ProteinFeatures]) -> list[dict]:
        """
        Convert ProteinFeatures to list of dictionaries.

        Args:
            proteins: List of ProteinFeatures

        Returns:
            List of dicts with identifier and features
        """
        result = []
        for protein in proteins:
            entry = {"identifier": protein.identifier}
            entry.update(protein.features)
            result.append(entry)
        return result
