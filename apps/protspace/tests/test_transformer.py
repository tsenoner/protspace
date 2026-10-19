"""
Tests for AnnotationTransformer.

This module tests the main annotation transformer orchestrator that coordinates
all annotation transformations.
"""

from unittest.mock import patch

import pytest

from protspace.data.annotations.transformers.transformer import (
    AnnotationTransformer,
    ProteinAnnotations,
)
from protspace.data.annotations.transformers.uniprot_transforms import (
    UniProtTransformer,
)

# One annotation in, the whole transformed annotations dict out: every field the
# transformer maps, the empty and None values it must leave alone, and fields it
# has no rule for, which pass through unchanged.
FIELD_MAPPINGS = [
    ("annotation_score", "5.0", "5"),
    ("annotation_score", "", ""),
    ("annotation_score", None, None),
    # Every family of a multi-section entry survives, evidence included
    (
        "protein_families",
        "Insulin family|IC;Growth factor family|IC",
        "Insulin family|IC;Growth factor family|IC",
    ),
    ("protein_families", None, None),
    ("reviewed", "Swiss-Prot", "Swiss-Prot"),
    ("reviewed", "TrEMBL", "TrEMBL"),
    ("reviewed", None, None),
    ("xref_pdb", "1INS;2INS", "True"),
    # No uniprot_kb_id key at all (legacy rows): blank means "no PDB"
    ("xref_pdb", "", "False"),
    ("fragment", "fragment", "yes"),
    ("fragment", "", ""),
    ("cc_subcellular_location", "Secreted;Extracellular", "Secreted;Extracellular"),
    # G3DSA: prefix stripped and the superfamilies sorted
    ("cath", "G3DSA:2.40.50.140;G3DSA:1.10.10.10", "1.10.10.10;2.40.50.140"),
    ("signal_peptide", "SIGNAL_PEPTIDE", "True"),
    ("signal_peptide", "", "False"),
    ("pfam", "PF00013;PF00014", "PF00013;PF00014"),
    ("length", "110", "110"),  # preserved as-is, no binning
    ("smart", "SM00220 (InsulinA)|35.7", "SM00220 (InsulinA)|35.7"),
    ("cdd", "cd00205 (IGc2)", "cd00205 (IGc2)"),
    ("prosite", "PS00009 (INSULIN)", "PS00009 (INSULIN)"),
    ("prints", "PR00276 (INSULIN)", "PR00276 (INSULIN)"),
    ("custom_field", "custom_value", "custom_value"),
    ("custom_field", 123, 123),
]


class TestAnnotationTransformerTransform:
    """Test the transform() method."""

    @pytest.mark.parametrize(
        "field,value,expected",
        FIELD_MAPPINGS,
        ids=[f"{f}={v!r}" for f, v, _ in FIELD_MAPPINGS],
    )
    def test_transform_maps_each_field(self, field, value, expected):
        result = AnnotationTransformer().transform(
            [ProteinAnnotations(identifier="P1", annotations={field: value})]
        )

        assert result[0].annotations == {field: expected}

    def test_transform_keeps_proteins_and_their_order(self):
        transformer = AnnotationTransformer()
        proteins = [
            ProteinAnnotations(identifier="P01308", annotations={}),
            ProteinAnnotations(identifier="P01315", annotations={}),
        ]

        assert transformer.transform([]) == []
        assert [p.identifier for p in transformer.transform(proteins)] == [
            "P01308",
            "P01315",
        ]

    def test_transform_does_not_modify_the_input(self):
        annotations = {"annotation_score": "5.0", "custom_field": "value"}

        result = AnnotationTransformer().transform(
            [ProteinAnnotations(identifier="P1", annotations=annotations)]
        )

        assert annotations == {"annotation_score": "5.0", "custom_field": "value"}
        assert result[0].annotations == {
            "annotation_score": "5",
            "custom_field": "value",
        }

    @pytest.mark.parametrize(
        ("uniprot_kb_id", "xref_pdb", "expected"),
        [
            ("", "", ""),
            ("NO_PDB_HUMAN", "", "False"),
            ("HBA_HUMAN", "1A3N", "True"),
        ],
    )
    def test_transform_xref_pdb_preserves_uniprot_mapping_state(
        self, uniprot_kb_id, xref_pdb, expected
    ):
        """PDB availability is missing unless a UniProt entry resolved."""
        proteins = [
            ProteinAnnotations(
                identifier="protein",
                annotations={
                    "uniprot_kb_id": uniprot_kb_id,
                    "xref_pdb": xref_pdb,
                },
            )
        ]

        result = AnnotationTransformer().transform(proteins)

        assert result[0].annotations["xref_pdb"] == expected

    @pytest.mark.parametrize(
        ("uniprot_kb_id", "xref_pdb", "expected"),
        [
            (float("nan"), float("nan"), ""),
            ("HBA_HUMAN", float("nan"), "False"),
        ],
    )
    def test_transform_xref_pdb_treats_nan_cells_as_missing(
        self, uniprot_kb_id, xref_pdb, expected
    ):
        """A parquet null reads back as NaN, which is truthy and stringifies.

        Without an explicit blank check it would be read as a PDB hit.
        """
        proteins = [
            ProteinAnnotations(
                identifier="protein",
                annotations={
                    "uniprot_kb_id": uniprot_kb_id,
                    "xref_pdb": xref_pdb,
                },
            )
        ]

        result = AnnotationTransformer().transform(proteins)

        assert result[0].annotations["xref_pdb"] == expected


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

    def test_transform_row_with_single_column(self):
        """Test transform_row with only identifier column."""
        transformer = AnnotationTransformer()
        row = ["P01308"]
        headers = ["identifier"]

        result = transformer.transform_row(row, headers)

        assert result == ["P01308"]


class TestGoTermTransformations:
    """Test GO term prefix stripping transformations."""

    def test_go_f_prefix_stripped(self):
        """Test that F: prefix is stripped from GO Molecular Function terms."""
        result = UniProtTransformer.transform_go_terms(
            "F:kinase activity;F:ATP binding"
        )
        assert result == "kinase activity;ATP binding"

    def test_go_p_prefix_stripped(self):
        """Test that P: prefix is stripped from GO Biological Process terms."""
        result = UniProtTransformer.transform_go_terms(
            "P:phosphorylation;P:signal transduction"
        )
        assert result == "phosphorylation;signal transduction"

    def test_go_c_prefix_stripped(self):
        """Test that C: prefix is stripped from GO Cellular Component terms."""
        result = UniProtTransformer.transform_go_terms("C:cytoplasm;C:nucleus")
        assert result == "cytoplasm;nucleus"

    def test_go_terms_without_prefix_unchanged(self):
        """Test that terms without prefix are left unchanged."""
        result = UniProtTransformer.transform_go_terms("kinase activity;ATP binding")
        assert result == "kinase activity;ATP binding"

    def test_go_terms_empty_string(self):
        """Test that empty string returns empty string."""
        result = UniProtTransformer.transform_go_terms("")
        assert result == ""

    def test_go_terms_single_term(self):
        """Test single term with prefix."""
        result = UniProtTransformer.transform_go_terms("F:kinase activity")
        assert result == "kinase activity"

    def test_go_terms_integrated_in_transformer(self):
        """Test that GO terms are transformed through the main transformer."""
        transformer = AnnotationTransformer()
        annotations = {
            "go_mf": "F:kinase activity;F:ATP binding",
            "go_bp": "P:phosphorylation",
            "go_cc": "C:cytoplasm;C:nucleus",
        }

        result = transformer._transform_annotations(annotations)

        assert result["go_mf"] == "kinase activity;ATP binding"
        assert result["go_bp"] == "phosphorylation"
        assert result["go_cc"] == "cytoplasm;nucleus"


class TestEcTransformation:
    """Test EC number name resolution transformations."""

    def test_ec_with_known_names(self):
        """Test EC numbers are annotated with enzyme names."""
        ec_map = {
            "2.7.11.1": "Non-specific serine/threonine protein kinase",
            "2.7.11.24": "Mitogen-activated protein kinase",
        }
        result = UniProtTransformer.transform_ec("2.7.11.1;2.7.11.24", ec_map)
        assert result == (
            "2.7.11.1 (Non-specific serine/threonine protein kinase);"
            "2.7.11.24 (Mitogen-activated protein kinase)"
        )

    def test_ec_with_unknown_number(self):
        """Test EC number not in map is left as-is."""
        ec_map = {"2.7.11.1": "Non-specific serine/threonine protein kinase"}
        result = UniProtTransformer.transform_ec("2.7.11.1;9.9.9.9", ec_map)
        assert result == (
            "2.7.11.1 (Non-specific serine/threonine protein kinase);9.9.9.9"
        )

    def test_ec_empty_string(self):
        """Test empty EC value returns empty string."""
        result = UniProtTransformer.transform_ec("", {})
        assert result == ""

    def test_ec_single_number(self):
        """Test single EC number."""
        ec_map = {"1.1.1.1": "Alcohol dehydrogenase"}
        result = UniProtTransformer.transform_ec("1.1.1.1", ec_map)
        assert result == "1.1.1.1 (Alcohol dehydrogenase)"

    def test_ec_empty_map(self):
        """Test EC number with empty map leaves numbers unchanged."""
        result = UniProtTransformer.transform_ec("2.7.11.1;2.7.11.24", {})
        assert result == "2.7.11.1;2.7.11.24"

    def test_ec_integrated_in_transformer(self):
        """Test that EC transform is wired through the main transformer."""
        transformer = AnnotationTransformer()
        # Inject a known EC name map directly to avoid network calls
        transformer._ec_name_map = {
            "1.1.1.1": "Alcohol dehydrogenase",
        }
        annotations = {"ec": "1.1.1.1"}

        result = transformer._transform_annotations(annotations)

        assert result["ec"] == "1.1.1.1 (Alcohol dehydrogenase)"

    def test_ec_name_with_semicolon_encoded(self):
        """Test that EC names with reserved characters like ; are percent-encoded."""
        out = UniProtTransformer.transform_ec("1.1.1.1", {"1.1.1.1": "Foo; bar"})
        assert out == "1.1.1.1 (Foo%3B bar)"


class TestEcNameMapParsing:
    """Test parsing of ExPASy enzyme.dat format."""

    def test_parse_enzyme_dat_basic(self):
        """Test basic enzyme.dat parsing."""
        text = (
            "ID   1.1.1.1\n"
            "DE   Alcohol dehydrogenase.\n"
            "//\n"
            "ID   2.7.11.1\n"
            "DE   Non-specific serine/threonine protein kinase.\n"
            "//\n"
        )
        result = UniProtTransformer._parse_enzyme_dat(text)
        assert result == {
            "1.1.1.1": "Alcohol dehydrogenase",
            "2.7.11.1": "Non-specific serine/threonine protein kinase",
        }

    def test_parse_enzyme_dat_multiline_de(self):
        """Test that multi-line DE fields are joined."""
        text = "ID   1.1.1.1\nDE   Alcohol dehydrogenase\nDE   (NAD(+)).\n//\n"
        result = UniProtTransformer._parse_enzyme_dat(text)
        assert result == {"1.1.1.1": "Alcohol dehydrogenase (NAD(+))"}

    def test_parse_enzyme_dat_skips_entries_without_de(self):
        """Test that entries without DE lines are skipped."""
        text = "ID   1.1.1.-\n//\nID   1.1.1.1\nDE   Alcohol dehydrogenase.\n//\n"
        result = UniProtTransformer._parse_enzyme_dat(text)
        assert "1.1.1.-" not in result
        assert result == {"1.1.1.1": "Alcohol dehydrogenase"}

    def test_parse_enzyme_dat_empty(self):
        """Test parsing empty input."""
        result = UniProtTransformer._parse_enzyme_dat("")
        assert result == {}


class TestEnzclassParsing:
    """Test parsing of ExPASy enzclass.txt format."""

    def test_parse_enzclass_basic(self):
        """Test basic enzclass.txt parsing with all three hierarchy levels."""
        text = (
            "1. -. -.-  Oxidoreductases.\n"
            "1. 1. -.-   Acting on the CH-OH group of donors.\n"
            "1. 1. 1.-    With NAD(+) or NADP(+) as acceptor.\n"
        )
        result = UniProtTransformer._parse_enzclass_txt(text)
        assert result == {
            "1.-.-.-": "Oxidoreductases",
            "1.1.-.-": "Acting on the CH-OH group of donors",
            "1.1.1.-": "With NAD(+) or NADP(+) as acceptor",
        }

    def test_parse_enzclass_skips_headers(self):
        """Test that header/separator lines are skipped."""
        text = "---\n  ENZYME nomenclature database\n\n1. -. -.-  Oxidoreductases.\n"
        result = UniProtTransformer._parse_enzclass_txt(text)
        assert result == {"1.-.-.-": "Oxidoreductases"}

    def test_parse_enzclass_two_digit_subclass(self):
        """Test parsing of two-digit sub-subclass numbers."""
        text = "3. 4.21.-    Serine endopeptidases.\n"
        result = UniProtTransformer._parse_enzclass_txt(text)
        assert result == {"3.4.21.-": "Serine endopeptidases"}

    def test_parse_enzclass_empty(self):
        """Test parsing empty input."""
        result = UniProtTransformer._parse_enzclass_txt("")
        assert result == {}


class TestEcPartialNumbers:
    """Test EC name resolution for partial/incomplete EC numbers."""

    def test_ec_partial_two_level(self):
        """Test partial EC like 3.4.-.- resolves to class name."""
        ec_map = {
            "3.4.-.-": "Acting on peptide bonds (peptidases)",
            "3.4.21.1": "Chymotrypsin",
        }
        result = UniProtTransformer.transform_ec("3.4.-.-", ec_map)
        assert result == "3.4.-.- (Acting on peptide bonds (peptidases))"

    def test_ec_partial_three_level(self):
        """Test partial EC like 3.4.21.- resolves to sub-subclass name."""
        ec_map = {
            "3.4.-.-": "Acting on peptide bonds (peptidases)",
            "3.4.21.-": "Serine endopeptidases",
        }
        result = UniProtTransformer.transform_ec("3.4.21.-", ec_map)
        assert result == "3.4.21.- (Serine endopeptidases)"

    def test_ec_partial_one_level(self):
        """Test partial EC like 2.-.-.- resolves to top-level class."""
        ec_map = {"2.-.-.-": "Transferases"}
        result = UniProtTransformer.transform_ec("2.-.-.-", ec_map)
        assert result == "2.-.-.- (Transferases)"

    def test_ec_partial_with_evidence(self):
        """Test partial EC with evidence code preserved."""
        ec_map = {"3.4.-.-": "Acting on peptide bonds (peptidases)"}
        result = UniProtTransformer.transform_ec("3.4.-.-|EXP", ec_map)
        assert result == "3.4.-.- (Acting on peptide bonds (peptidases))|EXP"

    def test_ec_mixed_partial_and_complete(self):
        """Test mix of partial and complete EC numbers."""
        ec_map = {
            "2.7.11.1": "Non-specific serine/threonine protein kinase",
            "3.4.-.-": "Acting on peptide bonds (peptidases)",
        }
        result = UniProtTransformer.transform_ec("2.7.11.1;3.4.-.-", ec_map)
        assert result == (
            "2.7.11.1 (Non-specific serine/threonine protein kinase);"
            "3.4.-.- (Acting on peptide bonds (peptidases))"
        )

    def test_ec_partial_no_match(self):
        """Test that partial EC with no match stays unchanged."""
        result = UniProtTransformer.transform_ec("9.-.-.-", {})
        assert result == "9.-.-.-"

    def test_ec_partial_integrated_in_transformer(self):
        """Test partial EC resolution through main transformer."""
        transformer = AnnotationTransformer()
        transformer._ec_name_map = {
            "1.1.1.1": "Alcohol dehydrogenase",
            "3.4.-.-": "Acting on peptide bonds (peptidases)",
        }
        annotations = {"ec": "1.1.1.1;3.4.-.-"}
        result = transformer._transform_annotations(annotations)
        assert result["ec"] == (
            "1.1.1.1 (Alcohol dehydrogenase);"
            "3.4.-.- (Acting on peptide bonds (peptidases))"
        )


class TestKeywordCombinedFormat:
    """Test that keyword annotations come through in combined id (name) format."""

    @patch.object(UniProtTransformer, "_get_ec_name_map", return_value={})
    def test_keyword_combined_format_in_annotations(self, _mock):
        """Test keyword values are in 'id (name)' format after extraction."""
        transformer = AnnotationTransformer()
        annotations = {
            "keyword": "KW-0418 (Kinase);KW-0808 (Transferase)",
        }

        result = transformer._transform_annotations(annotations)

        # keyword is a pass-through in the transformer, format comes from parser
        assert result["keyword"] == "KW-0418 (Kinase);KW-0808 (Transferase)"
