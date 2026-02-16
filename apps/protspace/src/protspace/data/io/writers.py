"""
Data writers for different file formats.

This module provides functionality for writing annotation data to various formats.
"""

import csv
from collections import namedtuple
from pathlib import Path

import pandas as pd

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

        with open(path, "w", newline="") as f:
            writer = csv.writer(f)

            # Write header
            csv_headers = ["identifier"] + list(proteins[0].annotations.keys())
            writer.writerow(csv_headers)

            # Write data
            for protein in proteins:
                row = [protein.identifier] + [
                    protein.annotations.get(header, "") for header in csv_headers[1:]
                ]

                # Apply transformations if requested
                if apply_transforms and self.transformer:
                    row = self.transformer.transform_row(row, csv_headers)

                writer.writerow(row)

    def write_parquet(
        self,
        proteins: list[ProteinAnnotations],
        path: Path,
        apply_transforms: bool = True,
    ):
        """
        Write annotations to Parquet file.

        Args:
            proteins: List of ProteinAnnotations
            path: Output file path
            apply_transforms: Whether to apply transformations (default: True)
        """
        if not proteins:
            # Write empty DataFrame
            df = pd.DataFrame(columns=["identifier"])
            df.to_parquet(path, index=False)
            return

        # Convert to rows
        csv_headers = ["identifier"] + list(proteins[0].annotations.keys())
        data_rows = []

        for protein in proteins:
            row = [protein.identifier] + [
                protein.annotations.get(header, "") for header in csv_headers[1:]
            ]

            # Apply transformations if requested
            if apply_transforms and self.transformer:
                row = self.transformer.transform_row(row, csv_headers)

            data_rows.append(row)

        # Create DataFrame and write
        df = pd.DataFrame(data_rows, columns=csv_headers)
        df.to_parquet(path, index=False)
