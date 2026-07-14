from __future__ import annotations
import enum
from dataclasses import dataclass
from typing import Iterable

from protspace.data.loaders.h5 import parse_identifier

from .config import Settings


class ValidationCode(str, enum.Enum):
    EMPTY_FASTA = "EMPTY_FASTA"
    TOO_FEW_SEQUENCES = "TOO_FEW_SEQUENCES"
    TOO_MANY_SEQUENCES = "TOO_MANY_SEQUENCES"
    SEQUENCE_TOO_LONG = "SEQUENCE_TOO_LONG"
    MALFORMED_FASTA = "MALFORMED_FASTA"
    DUPLICATE_IDENTIFIERS = "DUPLICATE_IDENTIFIERS"
    FILE_TOO_LARGE = "FILE_TOO_LARGE"
    TOTAL_RESIDUES_EXCEEDED = "TOTAL_RESIDUES_EXCEEDED"


@dataclass(frozen=True, slots=True)
class FastaRecord:
    identifier: str
    sequence: str


class FastaValidationError(ValueError):
    def __init__(self, code: ValidationCode, message: str):
        super().__init__(message)
        self.code = code
        self.message = message


_PROTEIN_ALPHABET = set("ACDEFGHIKLMNPQRSTVWYBXZUO*-")
_NUCLEOTIDE_ALPHABET = set("ACGTUN")
_NUCLEOTIDE_HEURISTIC_MIN_LEN = 50


def _looks_like_nucleotide(seq: str) -> bool:
    if len(seq) < _NUCLEOTIDE_HEURISTIC_MIN_LEN:
        return False
    return all(ch in _NUCLEOTIDE_ALPHABET for ch in seq)


def _iter_records(text: str) -> Iterable[FastaRecord]:
    current_id: str | None = None
    current_chunks: list[str] = []
    for raw in text.splitlines():
        line = raw.strip()
        if not line:
            continue
        if line.startswith(">"):
            if current_id is not None:
                yield FastaRecord(current_id, "".join(current_chunks).upper())
            header = line[1:].strip()
            if not header:
                raise FastaValidationError(
                    ValidationCode.MALFORMED_FASTA,
                    "FASTA header line has no identifier.",
                )
            current_id = header.split()[0]
            current_chunks = []
        else:
            if current_id is None:
                raise FastaValidationError(
                    ValidationCode.MALFORMED_FASTA,
                    "Sequence data before any '>' header.",
                )
            current_chunks.append("".join(line.split()))
    if current_id is not None:
        yield FastaRecord(current_id, "".join(current_chunks).upper())


def parse_and_validate(text: str, settings: Settings) -> list[FastaRecord]:
    text = text.lstrip("\ufeff")
    if not text.strip():
        raise FastaValidationError(ValidationCode.EMPTY_FASTA, "Input is empty.")

    records = list(_iter_records(text))
    records = [r for r in records if r.sequence]
    if not records:
        raise FastaValidationError(
            ValidationCode.EMPTY_FASTA,
            "No sequence data found in FASTA.",
        )
    if len(records) < settings.sequence_min_count:
        # Non-empty but below the floor is "too few", not "empty" — keep the
        # codes distinct so the UI can tell the user the actual minimum.
        raise FastaValidationError(
            ValidationCode.TOO_FEW_SEQUENCES,
            f"Need at least {settings.sequence_min_count} sequences; got {len(records)}.",
        )
    if len(records) > settings.sequence_max_count:
        raise FastaValidationError(
            ValidationCode.TOO_MANY_SEQUENCES,
            f"At most {settings.sequence_max_count} sequences allowed; got {len(records)}.",
        )

    seen: set[str] = set()
    total_residues = 0
    for record in records:
        # Dedup on the parsed identifier (what pipeline.py rewrites headers to),
        # so e.g. `sp|P12345|A` and bare `P12345` collide as the downstream join
        # sees them — but report the original identifier for user clarity.
        normalized = parse_identifier(record.identifier)
        if normalized in seen:
            raise FastaValidationError(
                ValidationCode.DUPLICATE_IDENTIFIERS,
                f"Duplicate identifier: {record.identifier!r}.",
            )
        seen.add(normalized)
        total_residues += len(record.sequence)
        if len(record.sequence) > settings.sequence_max_residues:
            raise FastaValidationError(
                ValidationCode.SEQUENCE_TOO_LONG,
                f"Sequence {record.identifier!r} exceeds {settings.sequence_max_residues} residues.",
            )
        if not all(ch in _PROTEIN_ALPHABET for ch in record.sequence):
            raise FastaValidationError(
                ValidationCode.MALFORMED_FASTA,
                f"Sequence {record.identifier!r} contains non-protein characters.",
            )
        if _looks_like_nucleotide(record.sequence):
            raise FastaValidationError(
                ValidationCode.MALFORMED_FASTA,
                f"Sequence {record.identifier!r} appears to be nucleotide; protein input required.",
            )

    if total_residues > settings.sequence_max_total_residues:
        raise FastaValidationError(
            ValidationCode.TOTAL_RESIDUES_EXCEEDED,
            f"Total residues {total_residues} exceed the {settings.sequence_max_total_residues} limit.",
        )

    return records
