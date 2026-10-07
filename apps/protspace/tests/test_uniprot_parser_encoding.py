"""Integration tests: UniProtEntry free-text emit points percent-encode reserved chars.

Each test constructs a real `UniProtEntry` from a raw UniProt-API-shaped `data`
dict containing a `;`-bearing free-text name, then asserts on the ACTUAL
property output (not a hand-built string). This means each test exercises the
real emit path in `src/protspace/data/parsers/uniprot_parser.py` and will FAIL
if the corresponding `encode_field` wrap is removed/reverted.
"""

import pytest

from protspace.data.annotations.encoding import decode_field, encode_field
from src.protspace.data.parsers.uniprot_parser import UniProtEntry


def test_keyword_name_with_semicolon_is_encoded():
    """Keyword names containing ';' must be percent-encoded at emit (`keyword`)."""
    raw_name = "Complete proteome; reference set"
    data = {
        "keywords": [
            {"id": "KW-0181", "name": raw_name},
        ],
    }
    entry = UniProtEntry(data)
    keywords = entry.keyword

    assert len(keywords) == 1
    encoded_name = encode_field(raw_name)
    assert keywords[0] == f"KW-0181 ({encoded_name})"
    assert "%3B" in keywords[0]

    # No raw ';' survives inside the emitted cell (the reserved hit
    # separator), only its percent-encoded form.
    assert ";" not in keywords[0]

    # Decoding the emitted name restores the exact original (round-trip).
    name_in_parens = keywords[0].split("(", 1)[1].rsplit(")", 1)[0]
    assert name_in_parens == encoded_name
    assert decode_field(name_in_parens) == raw_name


def test_cc_subcellular_location_with_semicolon_is_encoded():
    """Subcellular location values containing ';' must be percent-encoded
    (`cc_subcellular_location`)."""
    raw_value = "Cytoplasm; cytosol; perinuclear region"
    data = {
        "comments": [
            {
                "commentType": "SUBCELLULAR LOCATION",
                "subcellularLocations": [
                    {
                        "location": {
                            "value": raw_value,
                            "evidences": [{"evidenceCode": "ECO:0000269"}],  # EXP
                        }
                    },
                ],
            },
        ],
    }
    entry = UniProtEntry(data)
    locations = entry.cc_subcellular_location

    assert len(locations) == 1
    encoded_value = encode_field(raw_value)
    assert locations[0] == f"{encoded_value}|EXP"
    assert "%3B" in locations[0]

    # Split off the evidence suffix the same way the production/downstream
    # transformer would; the location itself must carry no raw ';'.
    label, _, ev = locations[0].rpartition("|")
    assert ev == "EXP"
    assert ";" not in label
    assert label == encoded_value
    assert decode_field(label) == raw_value


# The protein_families emit site is covered by test_protein_families_parser.py
# (test_semicolon_inside_a_name_is_percent_encoded).


@pytest.mark.parametrize(
    "prop,go_id,raw_term,evidence_type,expected_code",
    [
        (
            "go_bp",
            "GO:0006915",
            "P:response to X; regulation of Y",
            "IDA:UniProtKB",
            "IDA",
        ),
        (
            "go_mf",
            "GO:0005524",
            "F:binding; catalytic activity",
            "IEA:UniProtKB-EC",
            "IEA",
        ),
        ("go_cc", "GO:0005737", "C:cytoplasm; cytosol", "IDA:UniProtKB", "IDA"),
    ],
    ids=["go_bp", "go_mf", "go_cc"],
)
def test_go_term_with_semicolon_is_encoded(
    prop, go_id, raw_term, evidence_type, expected_code
):
    """GO terms containing ';' must be percent-encoded at emit (`_go_terms_encoded`,
    shared by go_bp, go_mf and go_cc)."""
    data = {
        "uniProtKBCrossReferences": [
            {
                "database": "GO",
                "id": go_id,
                "properties": [
                    {"key": "GoTerm", "value": raw_term},
                    {"key": "GoEvidenceType", "value": evidence_type},
                ],
            },
        ],
    }
    terms = getattr(UniProtEntry(data), prop)

    assert len(terms) == 1
    encoded_term = encode_field(raw_term)
    assert terms[0] == f"{encoded_term}|{expected_code}"

    label, _, ev = terms[0].rpartition("|")
    assert ev == expected_code
    assert ";" not in label
    assert "%3B" in label
    assert decode_field(label) == raw_term
