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
    def build_headers(proteins: list[ProteinAnnotations]) -> list[str]:
        """Return the column names for a set of records.

        Headers are the union across all records, in first-seen order: merging
        only inserts keys when a source lookup hits, so proteins with no
        taxonomy/InterPro/TED match carry shorter annotation dicts. Deriving the
        schema from the first record alone would silently drop every column that
        only later records carry.
        """
        return [
            "identifier",
            *dict.fromkeys(
                header for protein in proteins for header in protein.annotations
            ),
        ]

    @staticmethod
    def build_row(protein: ProteinAnnotations, headers: list[str]) -> list:
        """Return one row for *protein*, filling absent keys with empty strings."""
        return [protein.identifier] + [
            protein.annotations.get(header, "") for header in headers[1:]
        ]

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

        headers = DataFormatter.build_headers(proteins)
        data_rows = [DataFormatter.build_row(protein, headers) for protein in proteins]

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
