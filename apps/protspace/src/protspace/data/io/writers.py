"""
Data writers for different file formats.

This module provides functionality for writing annotation data to various formats.
"""

import csv
from collections import namedtuple
from pathlib import Path

import pandas as pd

from protspace.data.io.formatters import DataFormatter

ProteinAnnotations = namedtuple("ProteinAnnotations", ["identifier", "annotations"])


class AnnotationWriter:
    """Writes annotation data to different formats."""

    def __init__(self, transformer=None):
        """
        Initialize writer.

        Args:
            transformer: Optional AnnotationTransformer instance for applying transformations
        """
        self.transformer = transformer

    def _build_table(
        self, proteins: list[ProteinAnnotations], apply_transforms: bool
    ) -> tuple[list[str], list[list]]:
        """Build the header row and data rows shared by every output format.

        Schema derivation lives in :class:`DataFormatter` so the file writers and
        the in-memory DataFrame path cannot disagree about which columns exist.
        """
        headers = DataFormatter.build_headers(proteins)
        rows = []
        for protein in proteins:
            row = DataFormatter.build_row(protein, headers)
            if apply_transforms and self.transformer:
                row = self.transformer.transform_row(row, headers)
            rows.append(row)
        return headers, rows

    def write_csv(
        self,
        proteins: list[ProteinAnnotations],
        path: Path,
        apply_transforms: bool = True,
    ):
        """
        Write annotations to CSV file.

        Args:
            proteins: List of ProteinAnnotations
            path: Output file path
            apply_transforms: Whether to apply transformations (default: True)
        """
        if not proteins:
            # Write empty file with just header
            with open(path, "w", newline="") as f:
                writer = csv.writer(f)
                writer.writerow(["identifier"])
            return

        headers, rows = self._build_table(proteins, apply_transforms)
        with open(path, "w", newline="") as f:
            writer = csv.writer(f)
            writer.writerow(headers)
            writer.writerows(rows)

    def write_parquet(
        self,
        proteins: list[ProteinAnnotations],
        path: Path,
        apply_transforms: bool = True,
        dataframe_attrs: dict[str, object] | None = None,
    ):
        """
        Write annotations to Parquet file.

        Args:
            proteins: List of ProteinAnnotations
            path: Output file path
            apply_transforms: Whether to apply transformations (default: True)
            dataframe_attrs: Optional attributes persisted in Parquet metadata
        """
        if not proteins:
            # Write empty DataFrame
            df = pd.DataFrame(columns=["identifier"])
            df.attrs.update(dataframe_attrs or {})
            df.to_parquet(path, index=False)
            return

        headers, rows = self._build_table(proteins, apply_transforms)
        df = pd.DataFrame(rows, columns=headers)
        df.attrs.update(dataframe_attrs or {})
        df.to_parquet(path, index=False)
