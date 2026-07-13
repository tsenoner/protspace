import io

import pyarrow as pa
import pyarrow.parquet as pq
import pytest

from protspace.data.annotations.encoding import (
    BUNDLE_FORMAT_VERSION,
    FORMAT_VERSION_KEY,
    decode_field,
    encode_field,
    stamp_format_version,
)


@pytest.mark.parametrize(
    "raw",
    [
        "",
        "7tm_1",
        "Winged helix",
        "Acting on peptide bonds (peptidases)",  # parens NOT encoded
        "Ribosomal Protein L15; Chain: K; domain 2",  # semicolons
        "YojJ-like (1",  # unbalanced paren
        "weird|pipe and 50% and %3B literal",  # pipe + percent + literal %3B
        "tab\tnewline\nreturn\r",  # control chars
        "Kinase, ATP-binding",  # comma stays literal
        "Café ĸμ 名前",  # non-ASCII round-trips
    ],
)
def test_round_trip(raw):
    assert decode_field(encode_field(raw)) == raw


def test_encodes_only_reserved():
    # comma, parens, colon, slash stay literal; ; | % control get encoded
    assert encode_field("a,b(c):d/e") == "a,b(c):d/e"
    assert encode_field("a;b|c%d") == "a%3Bb%7Cc%25d"
    assert encode_field("x\ty") == "x%09y"


def test_decode_is_safe_on_plain_text():
    assert decode_field("no escapes here (with parens), commas") == (
        "no escapes here (with parens), commas"
    )


def test_stamp_round_trips_through_parquet():
    tbl = stamp_format_version(pa.table({"protein_id": ["P1"], "cath": ["6.20.10.10"]}))
    buf = io.BytesIO()
    pq.write_table(tbl, buf)
    buf.seek(0)
    md = pq.read_metadata(buf).metadata
    assert md[FORMAT_VERSION_KEY] == str(BUNDLE_FORMAT_VERSION).encode()


def test_stamp_preserves_existing_schema_metadata():
    """stamp_format_version must merge into, not clobber, existing metadata."""
    tbl = pa.table({"protein_id": ["P1"], "cath": ["6.20.10.10"]})
    tbl = tbl.replace_schema_metadata({b"seeded": b"1"})

    stamped = stamp_format_version(tbl)

    metadata = stamped.schema.metadata
    assert metadata[b"seeded"] == b"1"
    assert metadata[FORMAT_VERSION_KEY] == str(BUNDLE_FORMAT_VERSION).encode()
