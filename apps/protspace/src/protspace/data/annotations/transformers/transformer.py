"""
Main annotation transformer orchestrator.

This module coordinates annotation transformations by delegating to specific transformers.
"""

from collections import namedtuple

from protspace.data.annotations.transformers.interpro_transforms import (
    InterProTransformer,
)
from protspace.data.annotations.transformers.length_binning import LengthBinner
from protspace.data.annotations.transformers.uniprot_transforms import (
    UniProtTransformer,
)

ProteinAnnotations = namedtuple("ProteinAnnotations", ["identifier", "annotations"])


class AnnotationTransformer:
    """Main transformer that delegates to specific transformers."""

    def __init__(self):
        self.uniprot_transformer = UniProtTransformer()
        self.interpro_transformer = InterProTransformer()
        self.length_binner = LengthBinner()

    def transform(
        self, proteins: list[ProteinAnnotations], apply_length_binning: bool = True
    ) -> list[ProteinAnnotations]:
        """
        Apply all transformations to protein annotations.

        Args:
            proteins: List of ProteinAnnotations to transform
            apply_length_binning: Whether to apply length binning (default: True)

        Returns:
            List of transformed ProteinAnnotations
        """
        # Apply length binning if requested and length field exists
        if apply_length_binning and proteins and "length" in proteins[0].annotations:
            proteins = self.length_binner.add_bins(proteins)

        # Apply field-specific transformations
        transformed_proteins = []
        for protein in proteins:
            transformed_annotations = self._transform_annotations(protein.annotations)
            transformed_proteins.append(
                ProteinAnnotations(
                    identifier=protein.identifier, annotations=transformed_annotations
                )
            )

        return transformed_proteins

    def _transform_annotations(self, annotations: dict) -> dict:
        """
        Transform individual annotation values.

        Args:
            annotations: Dictionary of annotation name to value

        Returns:
            Dictionary with transformed values
        """
        transformed = annotations.copy()

        # UniProt transformations
        if "annotation_score" in transformed:
            transformed["annotation_score"] = (
                self.uniprot_transformer.transform_annotation_score(
                    transformed["annotation_score"]
                )
            )

        if "protein_families" in transformed:
            transformed["protein_families"] = (
                self.uniprot_transformer.transform_protein_families(
                    transformed["protein_families"]
                )
            )

        if "reviewed" in transformed:
            transformed["reviewed"] = self.uniprot_transformer.transform_reviewed(
                transformed["reviewed"]
            )

        if "xref_pdb" in transformed:
            transformed["xref_pdb"] = self.uniprot_transformer.transform_xref_pdb(
                transformed["xref_pdb"]
            )

        if "fragment" in transformed:
            transformed["fragment"] = self.uniprot_transformer.transform_fragment(
                transformed["fragment"]
            )

        if "cc_subcellular_location" in transformed:
            transformed["cc_subcellular_location"] = (
                self.uniprot_transformer.transform_cc_subcellular_location(
                    transformed["cc_subcellular_location"]
                )
            )

        # InterPro transformations
        if "cath" in transformed:
            transformed["cath"] = self.interpro_transformer.transform_cath(
                transformed["cath"]
            )

        if "signal_peptide" in transformed:
            transformed["signal_peptide"] = (
                self.interpro_transformer.transform_signal_peptide(
                    transformed["signal_peptide"]
                )
            )

        if "pfam" in transformed:
            transformed["pfam"] = self.interpro_transformer.transform_pfam(
                transformed["pfam"]
            )

        return transformed

    def transform_row(self, row: list, headers: list[str]) -> list:
        """
        Transform a row of data (used for CSV/Parquet writing).

        Args:
            row: List of values
            headers: List of column names

        Returns:
            Transformed row
        """
        # Convert row to dict
        annotations_dict = dict(
            zip(headers[1:], row[1:], strict=True)
        )  # Skip identifier

        # Transform
        transformed_dict = self._transform_annotations(annotations_dict)

        # Convert back to row
        transformed_row = [row[0]]  # Keep identifier
        for header in headers[1:]:
            transformed_row.append(transformed_dict.get(header, ""))

        return transformed_row
