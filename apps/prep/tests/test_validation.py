import dataclasses
from pathlib import Path

import pytest

from protspace_prep.config import load_settings
from protspace_prep.validation import (
    FastaValidationError,
    ValidationCode,
    parse_and_validate,
)

FIXTURES = Path(__file__).parent / "fixtures"


def settings(**overrides):
    # These tests use tiny fixtures to exercise gates other than the product
    # sequence-count floor; default the minimum to 1 unless a test overrides it.
    return dataclasses.replace(
        load_settings(), **{"sequence_min_count": 1, **overrides}
    )


def test_accepts_well_formed_fasta():
    text = (FIXTURES / "small.fasta").read_text()
    records = parse_and_validate(text, settings())
    assert [r.identifier for r in records] == ["P12345", "P67890"]
    assert all(r.sequence.isalpha() for r in records)


@pytest.mark.parametrize(
    "text, overrides, code, message_part",
    [
        pytest.param("", {}, ValidationCode.EMPTY_FASTA, None, id="empty"),
        pytest.param(
            ">A\n>B\n", {}, ValidationCode.EMPTY_FASTA, None, id="headers-only"
        ),
        # Non-empty input below the minimum is "too few", distinct from empty.
        pytest.param(
            "".join(f">id{i}\nMKT\n" for i in range(3)),
            {"sequence_min_count": 20},
            ValidationCode.TOO_FEW_SEQUENCES,
            "20",
            id="too-few",
        ),
        pytest.param(
            "".join(f">id{i}\nMKT\n" for i in range(3)),
            {"sequence_max_count": 2},
            ValidationCode.TOO_MANY_SEQUENCES,
            None,
            id="too-many",
        ),
        pytest.param(
            ">x\n" + "A" * 11 + "\n",
            {"sequence_max_residues": 10},
            ValidationCode.SEQUENCE_TOO_LONG,
            None,
            id="sequence-too-long",
        ),
        pytest.param(
            ">id\nMKT\n>id\nMKQ\n",
            {},
            ValidationCode.DUPLICATE_IDENTIFIERS,
            None,
            id="duplicate-ids",
        ),
        pytest.param(
            ">sp|P12345|A\nMKT\n>P12345\nMKQ\n",
            {},
            ValidationCode.DUPLICATE_IDENTIFIERS,
            None,
            id="duplicate-after-normalization",
        ),
        pytest.param(
            ">a\n" + "A" * 30 + "\n>b\n" + "A" * 30 + "\n",
            {"sequence_max_total_residues": 50},
            ValidationCode.TOTAL_RESIDUES_EXCEEDED,
            None,
            id="total-residues-over-cap",
        ),
        pytest.param(
            "MKTAYIAK\n", {}, ValidationCode.MALFORMED_FASTA, None, id="no-header"
        ),
        pytest.param(
            ">id\n" + "ACGT" * 25 + "\n",
            {},
            ValidationCode.MALFORMED_FASTA,
            None,
            id="nucleotide-only",
        ),
        # A bare ">" is a 400, not an IndexError from splitting an empty header.
        pytest.param(
            ">\nMKT\n", {}, ValidationCode.MALFORMED_FASTA, None, id="empty-header"
        ),
        pytest.param(
            ">id\nMKT1A\n",
            {},
            ValidationCode.MALFORMED_FASTA,
            "non-protein",
            id="digit-in-sequence",
        ),
        pytest.param(
            ">id\nMK#T\n",
            {},
            ValidationCode.MALFORMED_FASTA,
            "non-protein",
            id="symbol-in-sequence",
        ),
    ],
)
def test_rejects_invalid_input(text, overrides, code, message_part):
    with pytest.raises(FastaValidationError) as exc:
        parse_and_validate(text, settings(**overrides))
    assert exc.value.code is code
    if message_part is not None:
        assert message_part in exc.value.message


def test_accepts_utf8_byte_order_mark():
    # Windows editors prepend a BOM; str.strip() does not remove U+FEFF.
    records = parse_and_validate("\ufeff>id\nMKT\n", settings())
    assert [r.identifier for r in records] == ["id"]


def test_strips_whitespace_and_uppercases_sequence():
    text = ">id description here\n  mkt ay ia\nKQRQ\n"
    records = parse_and_validate(text, settings())
    assert records[0].identifier == "id"
    assert records[0].sequence == "MKTAYIAKQRQ"


def test_identifier_is_first_whitespace_token_after_gt():
    text = ">P12345 extra info\nMKT\n"
    records = parse_and_validate(text, settings())
    assert records[0].identifier == "P12345"
