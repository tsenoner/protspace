"""
Data formatters for different output types.

This module provides utilities for formatting data into different structures.
"""

from collections import namedtuple

import pandas as pd
import pyarrow as pa

ProteinAnnotations = namedtuple("ProteinAnnotations", ["identifier", "annotations"])


class DataFormatter:
    """Format data for different outputs."""

    @staticmethod
    def to_dataframe(proteins: list[ProteinAnnotations]) -> pd.DataFrame:
        """
        Convert ProteinAnnotations to DataFrame.

        Args:
            proteins: List of ProteinAnnotations

        Returns:
            DataFrame with identifier column and annotation columns
        """
        if not proteins:
            return pd.DataFrame(columns=["identifier"])

        # Extract headers
        headers = ["identifier"] + list(proteins[0].annotations.keys())

        # Convert to rows
        data_rows = []
        for protein in proteins:
            row = [protein.identifier] + [
                protein.annotations.get(header, "") for header in headers[1:]
            ]
            data_rows.append(row)

        return pd.DataFrame(data_rows, columns=headers)

    @staticmethod
    def to_arrow_table(proteins: list[ProteinAnnotations]) -> pa.Table:
        """
        Convert ProteinAnnotations to Arrow Table.

        Args:
            proteins: List of ProteinAnnotations

        Returns:
            PyArrow Table
        """
        # Convert to DataFrame first, then to Arrow
        df = DataFormatter.to_dataframe(proteins)
        return pa.Table.from_pandas(df)

    @staticmethod
    def to_dict_list(proteins: list[ProteinAnnotations]) -> list[dict]:
        """
        Convert ProteinAnnotations to list of dictionaries.

        Args:
            proteins: List of ProteinAnnotations

        Returns:
            List of dicts with identifier and annotations
        """
        result = []
        for protein in proteins:
            entry = {"identifier": protein.identifier}
            entry.update(protein.annotations)
            result.append(entry)
        return result
