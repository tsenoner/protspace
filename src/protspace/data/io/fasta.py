"""FASTA file parsing utilities."""

import logging
from pathlib import Path

logger = logging.getLogger(__name__)

FASTA_EXTENSIONS = {".fasta", ".fa", ".faa"}


def is_fasta_file(path: Path) -> bool:
    """Check whether *path* has a recognised FASTA extension."""
    return path.suffix.lower() in FASTA_EXTENSIONS


def parse_fasta(path: Path) -> dict[str, str]:
    """Stream-parse a FASTA file into ``{header: sequence}``.

    The header is the first whitespace-delimited word after ``>``.
    Duplicate headers are warned about (first occurrence kept) and
    entries with empty sequences are skipped.
    """
    sequences: dict[str, str] = {}
    current_header: str | None = None
    current_parts: list[str] = []
    duplicates = 0

    with open(path) as fh:
        for line in fh:
            line = line.rstrip("\n")
            if line.startswith(">"):
                # Save previous entry
                if current_header is not None:
                    seq = "".join(current_parts)
                    if seq:
                        if current_header in sequences:
                            duplicates += 1
                        else:
                            sequences[current_header] = seq
                    else:
                        logger.warning(
                            "Empty sequence for '%s', skipping", current_header
                        )
                current_header = line[1:].split()[0]
                current_parts = []
            else:
                current_parts.append(line.strip())

        # Last entry
        if current_header is not None:
            seq = "".join(current_parts)
            if seq:
                if current_header in sequences:
                    duplicates += 1
                else:
                    sequences[current_header] = seq
            else:
                logger.warning(
                    "Empty sequence for '%s', skipping", current_header
                )

    if duplicates:
        logger.warning(
            "Found %d duplicate header(s) in FASTA (kept first occurrence)",
            duplicates,
        )

    return sequences
