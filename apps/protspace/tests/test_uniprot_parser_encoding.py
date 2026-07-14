"""Integration tests: UniProtEntry free-text emit points percent-encode reserved chars.

Each test constructs a real `UniProtEntry` from a raw UniProt-API-shaped `data`
dict containing a `;`-bearing free-text name, then asserts on the ACTUAL
property output (not a hand-built string). This means each test exercises the
real emit path in `src/protspace/data/parsers/uniprot_parser.py` and will FAIL
if the corresponding `encode_field` wrap is removed/reverted.
"""

from protspace.data.annotations.encoding import decode_field, encode_field
from src.protspace.data.parsers.uniprot_parser import UniProtEntry


def test_keyword_name_with_semicolon_is_encoded():
    """Keyword names containing ';' must be percent-encoded at emit (L272)."""
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
    """Subcellular location values containing ';' must be percent-encoded (L310-315)."""
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


def test_protein_families_with_semicolon_is_encoded():
    """Protein family description containing ';' must be percent-encoded (L332-338)."""
    raw_family = "Belongs to the Insulin; IGF family"
    data = {
        "comments": [
            {
                "commentType": "SIMILARITY",
                "texts": [
                    {
                        "value": raw_family,
                        "evidences": [{"evidenceCode": "ECO:0000250"}],  # ISS
                    }
                ],
            }
        ],
    }
    entry = UniProtEntry(data)
    result = entry.protein_families

    expected_raw = "Insulin; IGF family"  # "Belongs to the " prefix stripped
    encoded_value = encode_field(expected_raw)
    assert result == f"{encoded_value}|ISS"

    label, _, ev = result.rpartition("|")
    assert ev == "ISS"
    assert ";" not in label
    assert "%3B" in label
    assert decode_field(label) == expected_raw


def test_go_bp_term_with_semicolon_is_encoded():
    """GO BP terms containing ';' must be percent-encoded at emit (L370-375)."""
    raw_term = "P:response to X; regulation of Y"
    data = {
        "uniProtKBCrossReferences": [
            {
                "database": "GO",
                "id": "GO:0006915",
                "properties": [
                    {"key": "GoTerm", "value": raw_term},
                    {"key": "GoEvidenceType", "value": "IDA:UniProtKB"},
                ],
            },
        ],
    }
    entry = UniProtEntry(data)
    terms = entry.go_bp

    assert len(terms) == 1
    encoded_term = encode_field(raw_term)
    assert terms[0] == f"{encoded_term}|IDA"

    label, _, ev = terms[0].rpartition("|")
    assert ev == "IDA"
    assert ";" not in label
    assert "%3B" in label
    assert decode_field(label) == raw_term


def test_go_mf_term_with_semicolon_is_encoded():
    """GO MF terms containing ';' must be percent-encoded at emit (L382-387)."""
    raw_term = "F:binding; catalytic activity"
    data = {
        "uniProtKBCrossReferences": [
            {
                "database": "GO",
                "id": "GO:0005524",
                "properties": [
                    {"key": "GoTerm", "value": raw_term},
                    {"key": "GoEvidenceType", "value": "IEA:UniProtKB-EC"},
                ],
            },
        ],
    }
    entry = UniProtEntry(data)
    terms = entry.go_mf

    assert len(terms) == 1
    encoded_term = encode_field(raw_term)
    assert terms[0] == f"{encoded_term}|IEA"
    assert ";" not in terms[0].rpartition("|")[0]
    assert decode_field(terms[0].rpartition("|")[0]) == raw_term


def test_go_cc_term_with_semicolon_is_encoded():
    """GO CC terms containing ';' must be percent-encoded at emit (L394-398)."""
    raw_term = "C:cytoplasm; cytosol"
    data = {
        "uniProtKBCrossReferences": [
            {
                "database": "GO",
                "id": "GO:0005737",
                "properties": [
                    {"key": "GoTerm", "value": raw_term},
                    {"key": "GoEvidenceType", "value": "IDA:UniProtKB"},
                ],
            },
        ],
    }
    entry = UniProtEntry(data)
    terms = entry.go_cc

    assert len(terms) == 1
    encoded_term = encode_field(raw_term)
    assert terms[0] == f"{encoded_term}|IDA"
    assert ";" not in terms[0].rpartition("|")[0]
    assert decode_field(terms[0].rpartition("|")[0]) == raw_term
