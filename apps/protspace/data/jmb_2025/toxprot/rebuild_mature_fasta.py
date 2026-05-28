#!/usr/bin/env python3
"""Reconstruct the FASTA files for the JMB 2025 toxprot dataset.

The original FASTAs were never committed; the embeddings in ``toxins_prott5.h5``
were generated from signal-peptide-stripped (mature) sequences. This script
recovers the 5,181 UniProt accessions from the ``.h5`` keys, re-fetches their
sequences + signal-peptide annotations from UniProt, and writes two files:

  - ``toxins_full.fasta``   — full UniProt sequences (signal peptide included)
  - ``toxins_mature.fasta`` — mature sequences (signal peptide cleaved; the
                              actual input used to compute the embeddings)

Note: UniProt entries may have changed since November 2024, so the result is a
faithful reconstruction, not necessarily byte-identical to the original input.
Accessions that are now obsolete/merged are reported and skipped.
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

import h5py
import requests

HERE = Path(__file__).resolve().parent
H5_PATH = HERE / "toxins_prott5.h5"
FULL_OUT = HERE / "toxins_full.fasta"
MATURE_OUT = HERE / "toxins_mature.fasta"

UNIPROT_ACCESSIONS_URL = "https://rest.uniprot.org/uniprotkb/accessions"
SIGNAL_RE = re.compile(r"SIGNAL\s+(\d+)\.\.(\d+)")
BATCH = 100


def read_accessions(h5_path: Path) -> list[str]:
    with h5py.File(h5_path, "r") as f:
        return sorted(f.keys())


def fetch_batch(accessions: list[str]) -> dict[str, tuple[str, str]]:
    """Return {accession: (sequence, ft_signal)} for one batch."""
    params = {
        "accessions": ",".join(accessions),
        "format": "tsv",
        "fields": "accession,sequence,ft_signal",
    }
    resp = requests.get(UNIPROT_ACCESSIONS_URL, params=params, timeout=300)
    resp.raise_for_status()
    out: dict[str, tuple[str, str]] = {}
    lines = resp.text.splitlines()
    header = lines[0].split("\t")
    i_acc, i_seq, i_sig = (
        header.index("Entry"),
        header.index("Sequence"),
        header.index("Signal peptide"),
    )
    for line in lines[1:]:
        cols = line.split("\t")
        if len(cols) <= max(i_acc, i_seq, i_sig):
            continue
        out[cols[i_acc]] = (cols[i_seq], cols[i_sig])
    return out


def mature(seq: str, signal: str) -> str:
    """Strip a single confidently-bounded signal peptide; else return seq."""
    matches = SIGNAL_RE.findall(signal or "")
    if len(matches) == 1:
        return seq[int(matches[0][1]) :]
    return seq


def main() -> int:
    accessions = read_accessions(H5_PATH)
    print(f"{len(accessions)} accessions from {H5_PATH.name}")

    records: dict[str, tuple[str, str]] = {}
    for start in range(0, len(accessions), BATCH):
        chunk = accessions[start : start + BATCH]
        records.update(fetch_batch(chunk))
        print(f"  fetched {min(start + BATCH, len(accessions))}/{len(accessions)}")

    missing = [a for a in accessions if a not in records]
    n_written = 0
    n_sp = 0
    with FULL_OUT.open("w") as ffull, MATURE_OUT.open("w") as fmat:
        for acc in accessions:
            if acc not in records:
                continue
            seq, signal = records[acc]
            if not seq:
                missing.append(acc)
                continue
            m = mature(seq, signal)
            if len(m) != len(seq):
                n_sp += 1
            ffull.write(f">{acc}\n{seq}\n")
            fmat.write(f">{acc}\n{m}\n")
            n_written += 1

    print(
        f"Wrote {FULL_OUT.name} + {MATURE_OUT.name}: {n_written} sequences, "
        f"{n_sp} with SP stripped in the mature file"
    )
    if missing:
        print(f"WARNING: {len(missing)} accessions not retrievable (obsolete/merged):")
        print(
            "  "
            + ", ".join(sorted(set(missing))[:20])
            + (" ..." if len(set(missing)) > 20 else "")
        )
    return 0


if __name__ == "__main__":
    sys.exit(main())
