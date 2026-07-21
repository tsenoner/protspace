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
    base = load_settings()
    fields = {k: getattr(base, k) for k in base.__slots__}
    # These tests use tiny fixtures to exercise gates other than the product
    # sequence-count floor; default the minimum to 1 unless a test overrides it.
    fields["sequence_min_count"] = 1
    fields.update(overrides)
    return type(base)(**fields)


def test_accepts_well_formed_fasta():
    text = (FIXTURES / "small.fasta").read_text()
    records = parse_and_validate(text, settings())
    assert [r.identifier for r in records] == ["P12345", "P67890"]
    assert all(r.sequence.isalpha() for r in records)


def test_rejects_empty_input():
    with pytest.raises(FastaValidationError) as exc:
        parse_and_validate("", settings())
    assert exc.value.code is ValidationCode.EMPTY_FASTA


def test_rejects_when_no_sequences_only_headers():
    with pytest.raises(FastaValidationError) as exc:
        parse_and_validate(">A\n>B\n", settings())
    assert exc.value.code is ValidationCode.EMPTY_FASTA


def test_rejects_too_few_sequences():
    # Non-empty input below the minimum is "too few", distinct from empty.
    text = "".join(f">id{i}\nMKT\n" for i in range(3))
    with pytest.raises(FastaValidationError) as exc:
        parse_and_validate(text, settings(sequence_min_count=20))
    assert exc.value.code is ValidationCode.TOO_FEW_SEQUENCES
    assert "20" in exc.value.message


def test_rejects_too_many_sequences():
    text = "".join(f">id{i}\nMKT\n" for i in range(3))
    with pytest.raises(FastaValidationError) as exc:
        parse_and_validate(text, settings(sequence_max_count=2))
    assert exc.value.code is ValidationCode.TOO_MANY_SEQUENCES


def test_rejects_sequence_too_long():
    text = ">x\n" + ("A" * 11) + "\n"
    with pytest.raises(FastaValidationError) as exc:
        parse_and_validate(text, settings(sequence_max_residues=10))
    assert exc.value.code is ValidationCode.SEQUENCE_TOO_LONG


def test_rejects_duplicate_identifiers():
    text = ">id\nMKT\n>id\nMKQ\n"
    with pytest.raises(FastaValidationError) as exc:
        parse_and_validate(text, settings())
    assert exc.value.code is ValidationCode.DUPLICATE_IDENTIFIERS


def test_rejects_duplicate_after_identifier_normalization():
    text = ">sp|P12345|A\nMKT\n>P12345\nMKQ\n"
    with pytest.raises(FastaValidationError) as exc:
        parse_and_validate(text, settings())
    assert exc.value.code is ValidationCode.DUPLICATE_IDENTIFIERS


def test_rejects_total_residues_over_cap():
    text = ">a\n" + ("A" * 30) + "\n>b\n" + ("A" * 30) + "\n"
    with pytest.raises(FastaValidationError) as exc:
        parse_and_validate(text, settings(sequence_max_total_residues=50))
    assert exc.value.code is ValidationCode.TOTAL_RESIDUES_EXCEEDED


def test_rejects_malformed_no_header():
    text = "MKTAYIAK\n"
    with pytest.raises(FastaValidationError) as exc:
        parse_and_validate(text, settings())
    assert exc.value.code is ValidationCode.MALFORMED_FASTA


def test_rejects_nucleotide_only():
    text = ">id\n" + ("ACGT" * 25) + "\n"
    with pytest.raises(FastaValidationError) as exc:
        parse_and_validate(text, settings())
    assert exc.value.code is ValidationCode.MALFORMED_FASTA


def test_strips_whitespace_and_uppercases_sequence():
    text = ">id description here\n  mkt ay ia\nKQRQ\n"
    records = parse_and_validate(text, settings())
    assert records[0].identifier == "id"
    assert records[0].sequence == "MKTAYIAKQRQ"


def test_identifier_is_first_whitespace_token_after_gt():
    text = ">P12345 extra info\nMKT\n"
    records = parse_and_validate(text, settings())
    assert records[0].identifier == "P12345"
