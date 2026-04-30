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
import sys

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


def main() -> int:
    raise NotImplementedError


if __name__ == "__main__":
    sys.exit(main())
