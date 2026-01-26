"""
Tests for AnnotationTransformer.

This module tests the main annotation transformer orchestrator that coordinates
all annotation transformations.
"""

import pytest

from src.protspace.data.annotations.transformers.transformer import (
    AnnotationTransformer,
    ProteinAnnotations,
)

# Test data
SAMPLE_PROTEINS_WITH_LENGTH = [
    ProteinAnnotations(
        identifier="P01308",
        annotations={
            "length": "110",
            "annotation_score": "5.0",
            "protein_families": "Insulin family, Growth factor family",
            "reviewed": "Swiss-Prot",
            "xref_pdb": "1INS;2INS",
            "fragment": "fragment",
            "cc_subcellular_location": "Secreted;Extracellular",
        },
    ),
    ProteinAnnotations(
        identifier="P01315",
        annotations={
            "length": "142",
            "annotation_score": "4.5",
            "protein_families": "Insulin family",
            "reviewed": "TrEMBL",
            "xref_pdb": "",
            "fragment": "",
            "cc_subcellular_location": "Membrane",
        },
    ),
]

SAMPLE_PROTEINS_WITHOUT_LENGTH = [
    ProteinAnnotations(
        identifier="P01308",
        annotations={
            "annotation_score": "5.0",
            "protein_families": "Insulin family",
        },
    ),
]

SAMPLE_PROTEINS_WITH_INTERPRO = [
    ProteinAnnotations(
        identifier="P01308",
        annotations={
            "cath": "G3DSA:1.10.10.10;G3DSA:2.40.50.140",
            "signal_peptide": "SIGNAL_PEPTIDE",
            "pfam": "PF00013;PF00014",
        },
    ),
]


class TestAnnotationTransformerInit:
    """Test AnnotationTransformer initialization."""

    def test_init_creates_sub_transformers(self):
        """Test that initialization creates all sub-transformers."""
        transformer = AnnotationTransformer()

        # Verify sub-transformers are created and have expected methods
        assert hasattr(transformer.uniprot_transformer, "transform_annotation_score")
        assert hasattr(transformer.uniprot_transformer, "transform_protein_families")
        assert hasattr(transformer.interpro_transformer, "transform_cath")
        assert hasattr(transformer.interpro_transformer, "transform_pfam")
        assert hasattr(transformer.length_binner, "add_bins")
        assert hasattr(transformer.length_binner, "compute_fixed_bins")


class TestAnnotationTransformerTransform:
    """Test the transform() method."""

    def test_transform_with_length_binning_enabled(self):
        """Test transformation with length binning enabled."""
        transformer = AnnotationTransformer()
        proteins = SAMPLE_PROTEINS_WITH_LENGTH.copy()

        result = transformer.transform(proteins, apply_length_binning=True)

        # Should have length binning fields added
        assert len(result) == 2
        assert "length_fixed" in result[0].annotations
        assert "length_quantile" in result[0].annotations
        assert "length" in result[0].annotations  # Original length kept for caching

        # Should have transformed annotations
        assert result[0].annotations["annotation_score"] == "5"
        assert result[0].annotations["protein_families"] == "Insulin family"
        assert result[0].annotations["reviewed"] == "Swiss-Prot"
        assert result[0].annotations["xref_pdb"] == "True"
        assert result[0].annotations["fragment"] == "yes"

    def test_transform_with_length_binning_disabled(self):
        """Test transformation with length binning disabled."""
        transformer = AnnotationTransformer()
        proteins = SAMPLE_PROTEINS_WITH_LENGTH.copy()

        result = transformer.transform(proteins, apply_length_binning=False)

        # Should NOT have length binning fields
        assert len(result) == 2
        assert "length_fixed" not in result[0].annotations
        assert "length_quantile" not in result[0].annotations
        assert "length" in result[0].annotations  # Original length preserved

        # Should still have transformed annotations
        assert result[0].annotations["annotation_score"] == "5"

    def test_transform_without_length_field(self):
        """Test transformation when length field is missing."""
        transformer = AnnotationTransformer()
        proteins = SAMPLE_PROTEINS_WITHOUT_LENGTH.copy()

        result = transformer.transform(proteins, apply_length_binning=True)

        # Should not add length binning when length field is missing
        assert len(result) == 1
        assert "length_fixed" not in result[0].annotations
        assert "length_quantile" not in result[0].annotations

        # Should still transform other annotations
        assert result[0].annotations["annotation_score"] == "5"

    def test_transform_empty_list(self):
        """Test transformation with empty protein list."""
        transformer = AnnotationTransformer()

        result = transformer.transform([], apply_length_binning=True)

        assert result == []

    def test_transform_preserves_identifiers(self):
        """Test that transformation preserves protein identifiers."""
        transformer = AnnotationTransformer()
        proteins = SAMPLE_PROTEINS_WITH_LENGTH.copy()

        result = transformer.transform(proteins, apply_length_binning=False)

        assert len(result) == 2
        assert result[0].identifier == "P01308"
        assert result[1].identifier == "P01315"

    def test_transform_with_interpro_annotations(self):
        """Test transformation with InterPro annotations."""
        transformer = AnnotationTransformer()
        proteins = SAMPLE_PROTEINS_WITH_INTERPRO.copy()

        result = transformer.transform(proteins, apply_length_binning=False)

        assert len(result) == 1
        # CATH should be cleaned (G3DSA: prefix removed, sorted)
        assert "1.10.10.10" in result[0].annotations["cath"]
        assert "2.40.50.140" in result[0].annotations["cath"]
        # Signal peptide should be converted to True
        assert result[0].annotations["signal_peptide"] == "True"
        # Pfam should be preserved
        assert result[0].annotations["pfam"] == "PF00013;PF00014"

    def test_transform_with_all_annotation_types(self):
        """Test transformation with all annotation types combined."""
        transformer = AnnotationTransformer()
        proteins = [
            ProteinAnnotations(
                identifier="P1",
                annotations={
                    "length": "200",
                    "annotation_score": "5.0",
                    "protein_families": "Insulin family",
                    "reviewed": "Swiss-Prot",
                    "xref_pdb": "1ABC",
                    "fragment": "",
                    "cc_subcellular_location": "Nucleus",
                    "cath": "G3DSA:1.20.20.20",
                    "signal_peptide": "",
                    "pfam": "PF12345",
                },
            ),
        ]

        result = transformer.transform(proteins, apply_length_binning=True)

        assert len(result) == 1
        # Check all transformations applied
        assert "length_fixed" in result[0].annotations
        assert result[0].annotations["annotation_score"] == "5"
        assert result[0].annotations["protein_families"] == "Insulin family"
        assert result[0].annotations["reviewed"] == "Swiss-Prot"
        assert result[0].annotations["xref_pdb"] == "True"
        assert result[0].annotations["fragment"] == ""
        assert result[0].annotations["cc_subcellular_location"] == "Nucleus"
        assert result[0].annotations["cath"] == "1.20.20.20"
        assert result[0].annotations["signal_peptide"] == "False"
        assert result[0].annotations["pfam"] == "PF12345"

    def test_transform_with_unknown_annotations(self):
        """Test that unknown annotations are preserved unchanged."""
        transformer = AnnotationTransformer()
        proteins = [
            ProteinAnnotations(
                identifier="P1",
                annotations={
                    "custom_field": "custom_value",
                    "another_field": "another_value",
                },
            ),
        ]

        result = transformer.transform(proteins, apply_length_binning=False)

        assert len(result) == 1
        assert result[0].annotations["custom_field"] == "custom_value"
        assert result[0].annotations["another_field"] == "another_value"


class TestAnnotationTransformerTransformRow:
    """Test the transform_row() method."""

    def test_transform_row_basic(self):
        """Test basic row transformation."""
        transformer = AnnotationTransformer()
        row = ["P01308", "5.0", "Insulin family", "Swiss-Prot"]
        headers = ["identifier", "annotation_score", "protein_families", "reviewed"]

        result = transformer.transform_row(row, headers)

        assert result[0] == "P01308"  # Identifier preserved
        assert result[1] == "5"  # annotation_score transformed
        assert (
            result[2] == "Insulin family"
        )  # protein_families preserved (single value)
        assert result[3] == "Swiss-Prot"  # reviewed preserved

    def test_transform_row_with_all_uniprot_annotations(self):
        """Test row transformation with all UniProt annotations."""
        transformer = AnnotationTransformer()
        row = [
            "P01308",
            "5.0",  # annotation_score
            "Insulin family, Growth factor",  # protein_families
            "TrEMBL",  # reviewed
            "1INS;2INS",  # xref_pdb
            "fragment",  # fragment
            "Secreted;Extracellular",  # cc_subcellular_location
        ]
        headers = [
            "identifier",
            "annotation_score",
            "protein_families",
            "reviewed",
            "xref_pdb",
            "fragment",
            "cc_subcellular_location",
        ]

        result = transformer.transform_row(row, headers)

        assert result[0] == "P01308"
        assert result[1] == "5"
        assert result[2] == "Insulin family"
        assert result[3] == "TrEMBL"
        assert result[4] == "True"
        assert result[5] == "yes"
        assert result[6] == "Secreted;Extracellular"

    def test_transform_row_with_interpro_annotations(self):
        """Test row transformation with InterPro annotations."""
        transformer = AnnotationTransformer()
        row = [
            "P01308",
            "G3DSA:1.10.10.10;G3DSA:2.40.50.140",  # cath
            "SIGNAL_PEPTIDE",  # signal_peptide
            "PF00013;PF00014",  # pfam
        ]
        headers = ["identifier", "cath", "signal_peptide", "pfam"]

        result = transformer.transform_row(row, headers)

        assert result[0] == "P01308"
        # CATH should be cleaned and sorted
        assert "1.10.10.10" in result[1]
        assert "2.40.50.140" in result[1]
        assert result[2] == "True"
        assert result[3] == "PF00013;PF00014"

    def test_transform_row_with_missing_values(self):
        """Test row transformation with missing/empty values."""
        transformer = AnnotationTransformer()
        row = ["P01308", "", "", "TrEMBL"]
        headers = ["identifier", "annotation_score", "xref_pdb", "reviewed"]

        result = transformer.transform_row(row, headers)

        assert result[0] == "P01308"
        assert result[1] == ""  # Empty annotation_score preserved
        assert result[2] == "False"  # Empty xref_pdb becomes "False"
        assert result[3] == "TrEMBL"  # TrEMBL preserved

    def test_transform_row_with_unknown_columns(self):
        """Test row transformation with unknown annotation columns."""
        transformer = AnnotationTransformer()
        row = ["P01308", "custom_value", "5.0"]
        headers = ["identifier", "custom_field", "annotation_score"]

        result = transformer.transform_row(row, headers)

        assert result[0] == "P01308"
        assert result[1] == "custom_value"  # Unknown field preserved
        assert result[2] == "5"  # Known field transformed

    def test_transform_row_preserves_order(self):
        """Test that transform_row preserves column order."""
        transformer = AnnotationTransformer()
        row = ["P01308", "value1", "value2", "5.0"]
        headers = ["identifier", "field1", "field2", "annotation_score"]

        result = transformer.transform_row(row, headers)

        assert len(result) == 4
        assert result[0] == "P01308"
        assert result[1] == "value1"
        assert result[2] == "value2"
        assert result[3] == "5"

    def test_transform_row_raises_on_mismatched_lengths(self):
        """Test that transform_row raises error on mismatched row/header lengths."""
        transformer = AnnotationTransformer()
        row = ["P01308", "value1", "value2"]
        headers = ["identifier", "field1"]  # Mismatched length

        with pytest.raises(ValueError, match="zip"):
            transformer.transform_row(row, headers)


class TestAnnotationTransformerTransformAnnotations:
    """Test the _transform_annotations() private method."""

    def test_transform_annotations_uniprot_all_fields(self):
        """Test transformation of all UniProt annotation fields."""
        transformer = AnnotationTransformer()
        annotations = {
            "annotation_score": "5.0",
            "protein_families": "Family1, Family2",
            "reviewed": "Swiss-Prot",
            "xref_pdb": "1ABC;2DEF",
            "fragment": "fragment",
            "cc_subcellular_location": "Nucleus;Membrane",
        }

        result = transformer._transform_annotations(annotations)

        assert result["annotation_score"] == "5"
        assert result["protein_families"] == "Family1"
        assert result["reviewed"] == "Swiss-Prot"
        assert result["xref_pdb"] == "True"
        assert result["fragment"] == "yes"
        assert result["cc_subcellular_location"] == "Nucleus;Membrane"

    def test_transform_annotations_interpro_all_fields(self):
        """Test transformation of all InterPro annotation fields."""
        transformer = AnnotationTransformer()
        annotations = {
            "cath": "G3DSA:1.10.10.10;G3DSA:2.40.50.140",
            "signal_peptide": "SIGNAL_PEPTIDE",
            "pfam": "PF00013;PF00014",
        }

        result = transformer._transform_annotations(annotations)

        # CATH should be cleaned and sorted
        cath_parts = result["cath"].split(";")
        assert len(cath_parts) == 2
        assert "1.10.10.10" in cath_parts
        assert "2.40.50.140" in cath_parts
        assert cath_parts == sorted(cath_parts)

        assert result["signal_peptide"] == "True"
        assert result["pfam"] == "PF00013;PF00014"

    def test_transform_annotations_empty_dict(self):
        """Test transformation with empty annotations dictionary."""
        transformer = AnnotationTransformer()

        result = transformer._transform_annotations({})

        assert result == {}

    def test_transform_annotations_preserves_unknown_fields(self):
        """Test that unknown annotation fields are preserved."""
        transformer = AnnotationTransformer()
        annotations = {
            "custom_field": "custom_value",
            "another_field": 123,
            "annotation_score": "5.0",  # Known field
        }

        result = transformer._transform_annotations(annotations)

        assert result["custom_field"] == "custom_value"
        assert result["another_field"] == 123
        assert result["annotation_score"] == "5"

    def test_transform_annotations_creates_copy(self):
        """Test that transformation creates a copy and doesn't modify original."""
        transformer = AnnotationTransformer()
        annotations = {"annotation_score": "5.0", "custom_field": "value"}

        result = transformer._transform_annotations(annotations)

        # Original should be unchanged
        assert annotations["annotation_score"] == "5.0"
        assert annotations["custom_field"] == "value"

        # Result should be transformed
        assert result["annotation_score"] == "5"
        assert result["custom_field"] == "value"

        # Should be different objects
        assert result is not annotations


class TestAnnotationTransformerEdgeCases:
    """Test edge cases and error handling."""

    def test_transform_with_none_values(self):
        """Test transformation handles None values gracefully."""
        transformer = AnnotationTransformer()
        proteins = [
            ProteinAnnotations(
                identifier="P1",
                annotations={
                    "annotation_score": None,
                    "protein_families": None,
                    "reviewed": None,
                },
            ),
        ]

        result = transformer.transform(proteins, apply_length_binning=False)

        # Should handle None values without crashing
        assert len(result) == 1
        assert result[0].identifier == "P1"

    def test_transform_with_empty_strings(self):
        """Test transformation with empty string values."""
        transformer = AnnotationTransformer()
        proteins = [
            ProteinAnnotations(
                identifier="P1",
                annotations={
                    "annotation_score": "",
                    "xref_pdb": "",
                    "signal_peptide": "",
                },
            ),
        ]

        result = transformer.transform(proteins, apply_length_binning=False)

        assert len(result) == 1
        assert result[0].annotations["xref_pdb"] == "False"
        assert result[0].annotations["signal_peptide"] == "False"

    def test_transform_row_with_single_column(self):
        """Test transform_row with only identifier column."""
        transformer = AnnotationTransformer()
        row = ["P01308"]
        headers = ["identifier"]

        result = transformer.transform_row(row, headers)

        assert result == ["P01308"]
