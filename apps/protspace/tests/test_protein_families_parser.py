"""``protein_families``: parse UniProt SIMILARITY texts into whole family names.

The fixtures copy UniProt's own ``comments`` JSON (release 2026_03, fetched with
``https://rest.uniprot.org/uniprotkb/<acc>.json?fields=cc_similarity``), so the
tests pin the text shapes the parser really meets:

- P04191 (SERCA1): a family name carrying a transporter classification number;
- P06493 (CDK1): a superfamily / family / subfamily hierarchy;
- P00561 (AK-HD): two sections, two families;
- P27708 (CAD): four sections, two of them hierarchical;
- O43426 (synaptojanin-1): a whole-protein family plus a section, with commas
  inside the second name;
- Q8N7X0: sections listed out of sequence order, evidence carrying a source;
- Q5XPT3: one family named twice, once for a section and once for the protein;
- P44000: a text without the prefix, with dots inside names and parentheses.
"""

import pandas as pd
import pytest

from protspace.data.annotations.encoding import decode_field, encode_field
from protspace.data.annotations.scores import strip_scores_from_df
from protspace.data.annotations.transformers.transformer import (
    AnnotationTransformer,
    ProteinAnnotations,
)
from protspace.data.annotations.transformers.uniprot_transforms import (
    UniProtTransformer,
)
from protspace.data.parsers.uniprot_parser import UniProtEntry

CURATOR = [{"evidenceCode": "ECO:0000305"}]  # → IC


def _similarity(value, evidences=CURATOR):
    """One SIMILARITY comment, exactly as the UniProt REST JSON nests it."""
    return {
        "texts": [{"evidences": evidences, "value": value}],
        "commentType": "SIMILARITY",
    }


def _families(*comments):
    return UniProtEntry({"comments": list(comments)}).protein_families


# --- Real UniProt entries ---------------------------------------------------

P04191 = [
    _similarity(
        "Belongs to the cation transport ATPase (P-type) (TC 3.A.3) family. "
        "Type IIA subfamily"
    )
]
P06493 = [
    _similarity(
        "Belongs to the protein kinase superfamily. CMGC Ser/Thr protein kinase "
        "family. CDC2/CDKX subfamily"
    )
]
P00561 = [
    _similarity("In the N-terminal section; belongs to the aspartokinase family"),
    _similarity(
        "In the C-terminal section; belongs to the homoserine dehydrogenase family"
    ),
]
P27708 = [
    _similarity("In the N-terminal section; belongs to the CarA family"),
    _similarity("In the 2nd section; belongs to the CarB family"),
    _similarity(
        "In the 3rd section; belongs to the metallo-dependent hydrolases "
        "superfamily. DHOase family. CAD subfamily"
    ),
    _similarity(
        "In the C-terminal section; belongs to the aspartate/ornithine "
        "carbamoyltransferase superfamily. ATCase family"
    ),
]
O43426 = [
    _similarity("Belongs to the synaptojanin family"),
    _similarity(
        "In the central section; belongs to the inositol 1,4,5-trisphosphate "
        "5-phosphatase family"
    ),
]
Q8N7X0_EVIDENCE = [
    {"evidenceCode": "ECO:0000305", "source": "PubMed", "id": "22115833"}
]
Q8N7X0 = [
    _similarity(
        "In the central section; belongs to the globin family", Q8N7X0_EVIDENCE
    ),
    _similarity(
        "In the N-terminal section; belongs to the peptidase C2 family",
        Q8N7X0_EVIDENCE,
    ),
]

Q5XPT3 = [
    _similarity(
        "In the C-terminal section; belongs to the glycosyltransferase 49 family"
    ),
    _similarity(
        "In the N-terminal section; belongs to the glycosyltransferase 8 family"
    ),
    _similarity("Belongs to the glycosyltransferase 8 family"),
]
P44000 = [
    _similarity(
        "To E.coli YgfZ (UP14) and B.aphidicola (subsp. Acyrthosiphon pisum) BU435"
    )
]


class TestSingleFamily:
    def test_transporter_classification_number_is_kept_whole(self):
        assert (
            _families(*P04191)
            == "cation transport ATPase (P-type) (TC 3.A.3) family|IC"
        )

    def test_hierarchy_keeps_its_first_level(self):
        assert _families(*P06493) == "protein kinase superfamily|IC"

    def test_text_without_prefix_yields_its_first_sentence(self):
        assert _families(_similarity("Kinase family. Subfamily 1")) == (
            "Kinase family|IC"
        )

    def test_text_without_prefix_keeps_abbreviated_names_whole(self):
        assert _families(*P44000) == (
            "To E.coli YgfZ (UP14) and B.aphidicola (subsp. Acyrthosiphon pisum) "
            "BU435|IC"
        )

    def test_evidence_code_is_the_best_one(self):
        evidences = [
            {"evidenceCode": "ECO:0007669"},  # IEA
            {"evidenceCode": "ECO:0000250"},  # ISS, higher priority
        ]
        assert _families(_similarity("Belongs to the Insulin family", evidences)) == (
            "Insulin family|ISS"
        )

    def test_no_evidence_means_no_suffix(self):
        assert _families(_similarity("Belongs to the Insulin family", [])) == (
            "Insulin family"
        )

    def test_no_similarity_comment_yields_empty(self):
        assert UniProtEntry({"comments": []}).protein_families == ""
        assert UniProtEntry({}).protein_families == ""

    def test_trailing_period_is_not_part_of_the_name(self):
        assert _families(_similarity("Belongs to the Insulin family.")) == (
            "Insulin family|IC"
        )

    def test_period_followed_by_non_space_does_not_end_the_name(self):
        assert _families(
            _similarity("Belongs to the glycosyl hydrolase 2.4.1.x family. Foo")
        ) == ("glycosyl hydrolase 2.4.1.x family|IC")

    def test_sentence_end_inside_parentheses_does_not_end_the_name(self):
        assert _families(
            _similarity("Belongs to the X (subgroup A. B) family. Y subfamily")
        ) == ("X (subgroup A. B) family|IC")

    def test_unbalanced_parenthesis_still_cuts_at_the_first_sentence(self):
        assert _families(
            _similarity("Belongs to the X (subgroup A family. Y subfamily")
        ) == ("X (subgroup A family|IC")

    def test_semicolon_inside_a_name_is_percent_encoded(self):
        result = _families(_similarity("Belongs to the Insulin; IGF family"))
        label, _, evidence = result.rpartition("|")
        assert evidence == "IC"
        assert label == encode_field("Insulin; IGF family")
        assert ";" not in result
        assert decode_field(label) == "Insulin; IGF family"


class TestMultiSection:
    def test_two_sections_yield_two_families_in_order(self):
        assert _families(*P00561) == (
            "aspartokinase family|IC;homoserine dehydrogenase family|IC"
        )

    def test_four_sections_yield_four_families(self):
        assert _families(*P27708) == (
            "CarA family|IC;CarB family|IC;"
            "metallo-dependent hydrolases superfamily|IC;"
            "aspartate/ornithine carbamoyltransferase superfamily|IC"
        )

    def test_whole_protein_family_and_a_section_family_with_commas(self):
        assert _families(*O43426) == (
            "synaptojanin family|IC;"
            "inositol 1,4,5-trisphosphate 5-phosphatase family|IC"
        )

    def test_uniprot_order_is_kept(self):
        assert _families(*Q8N7X0) == "globin family|IC;peptidase C2 family|IC"

    def test_section_qualifier_is_case_insensitive(self):
        assert _families(
            _similarity("in the N-terminal section; Belongs to the CarA family")
        ) == ("CarA family|IC")

    def test_repeated_family_appears_once(self):
        assert _families(*Q5XPT3) == (
            "glycosyltransferase 49 family|IC;glycosyltransferase 8 family|IC"
        )

    def test_repeated_family_keeps_its_first_evidence(self):
        assert _families(
            _similarity("In the N-terminal section; belongs to the RRM family"),
            _similarity(
                "In the C-terminal section; belongs to the RRM family",
                [{"evidenceCode": "ECO:0000269"}],  # EXP
            ),
        ) == ("RRM family|IC")

    def test_several_texts_of_one_comment_are_all_read(self):
        comment = {
            "texts": [
                {"evidences": CURATOR, "value": "Belongs to the CarA family"},
                {"evidences": CURATOR, "value": "Belongs to the CarB family"},
            ],
            "commentType": "SIMILARITY",
        }
        assert _families(comment) == "CarA family|IC;CarB family|IC"

    def test_semicolon_inside_a_section_family_is_percent_encoded(self):
        result = _families(
            _similarity("In the N-terminal section; belongs to the A; B family"),
            _similarity("In the C-terminal section; belongs to the C family"),
        )
        assert result == f"{encode_field('A; B family')}|IC;C family|IC"
        assert result.count(";") == 1


class TestDownstreamKeepsEveryFamily:
    MULTI = "CarA family|IC;metallo-dependent hydrolases superfamily|ISS"

    @pytest.mark.parametrize(
        "value",
        [
            MULTI,
            # The old transform cut at the first "," or ";": a comma is part of
            # the name, and nothing else guards that.
            "inositol 1,4,5-trisphosphate 5-phosphatase family|IC",
            _families(*P27708),
            "",
            None,
        ],
        ids=["multi_family", "comma_in_name", "parsed_p27708", "blank", "none"],
    )
    def test_transformer_passes_the_value_through_unchanged(self, value):
        assert UniProtTransformer.transform_protein_families(value) == value

    def test_annotation_transformer_keeps_every_family(self):
        proteins = [
            ProteinAnnotations(
                identifier="P27708", annotations={"protein_families": self.MULTI}
            )
        ]
        result = AnnotationTransformer().transform(proteins)
        assert result[0].annotations["protein_families"] == self.MULTI

    def test_no_scores_strips_each_familys_evidence(self):
        df = pd.DataFrame({"identifier": ["P27708"], "protein_families": [self.MULTI]})
        result = strip_scores_from_df(df)
        assert result["protein_families"].iloc[0] == (
            "CarA family;metallo-dependent hydrolases superfamily"
        )
