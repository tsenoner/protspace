#!/usr/bin/env python3
"""Regenerate the toxprot demo .parquetbundle.

Fetches UniProt sequences + signal-peptide positions, strips SPs, embeds
the mature peptides with ProtT5 and ESMC-300m, then runs DR + annotation
fetch via `protspace prepare`. Finally overrides the `length` column to
mature length and patches in the existing web-demo settings JSON.

See docs/superpowers/specs/2026-04-30-toxprot-demo-regeneration-design.md
"""

from __future__ import annotations

import logging
import re
import sys
from pathlib import Path

logger = logging.getLogger(__name__)

TOXPROT_QUERY = (
    "(taxonomy_id:33208) AND "
    "(cc_tissue_specificity:venom OR cc_scl_term:SL-0177) AND "
    "(reviewed:true)"
)
UNIPROT_STREAM_URL = "https://rest.uniprot.org/uniprotkb/stream"
EMBEDDERS = "prot_t5,esmc_300m"
METHODS = "umap2:n_neighbors=50;min_dist=0.5,pca2"
ANNOTATIONS = "default,interpro,taxonomy"
RANDOM_STATE = 42
SIGNAL_RE = re.compile(r"SIGNAL\s+(\d+)\.\.(\d+)")


def parse_signal_peptides(tsv_path: Path) -> dict[str, int]:
    """Return {accession: sp_end} for entries with a single confidently-bounded SP.

    Skipped (treated as no SP):
      - Empty `ft_signal`.
      - Bounds containing `?`, `<`, or `>` (uncertain).
      - Multiple SP features on a single entry.
    """
    sp_map: dict[str, int] = {}
    skipped_uncertain = 0
    skipped_multiple = 0
    total = 0

    with tsv_path.open() as f:
        header = f.readline().rstrip("\n").split("\t")
        idx_entry = header.index("Entry")
        idx_signal = header.index("Signal peptide")

        for line in f:
            total += 1
            fields = line.rstrip("\n").split("\t")
            entry = fields[idx_entry]
            signal = fields[idx_signal] if idx_signal < len(fields) else ""

            if not signal.strip():
                continue

            matches = SIGNAL_RE.findall(signal)
            if len(matches) > 1:
                skipped_multiple += 1
                continue
            if not matches:
                if any(c in signal for c in ("?", "<", ">")):
                    skipped_uncertain += 1
                continue
            if any(c in signal for c in ("?", "<", ">")):
                skipped_uncertain += 1
                continue

            sp_map[entry] = int(matches[0][1])

    logger.info(
        "Parsed signal peptides: %d total, %d with confirmed SP, "
        "%d skipped (uncertain bounds), %d skipped (multiple features)",
        total,
        len(sp_map),
        skipped_uncertain,
        skipped_multiple,
    )
    return sp_map


def main() -> int:
    raise NotImplementedError


if __name__ == "__main__":
    sys.exit(main())
