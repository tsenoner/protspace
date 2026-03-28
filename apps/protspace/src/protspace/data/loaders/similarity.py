"""FASTA → sequence similarity matrix via MMseqs2.

Extracted from UniProtQueryProcessor._get_similarity_matrix.
"""

import logging
import shutil
import tempfile
from pathlib import Path

import numpy as np

from protspace.data.loaders.embedding_set import EmbeddingSet
from protspace.data.loaders.h5 import parse_identifier

logger = logging.getLogger(__name__)


def compute_similarity(
    fasta_path: Path,
    headers: list[str],
) -> EmbeddingSet:
    """Compute pairwise sequence similarity using MMseqs2 easy_search.

    Args:
        fasta_path: Path to FASTA file.
        headers: Protein identifiers (order determines matrix rows/cols).

    Returns:
        EmbeddingSet with precomputed=True, name="MMseqs2".
    """
    from pymmseqs.commands import easy_search

    n_seqs = len(headers)
    input_fasta = str(fasta_path.absolute())

    logger.info("Computing sequence similarity with MMseqs2...")

    temp_dir = str(Path(tempfile.mkdtemp(prefix="protspace_mmseqs_")).absolute())
    temp_alignment = str(Path(temp_dir) / "output.tsv")

    try:
        df = easy_search(
            query_fasta=input_fasta,
            target_fasta_or_db=input_fasta,
            alignment_file=temp_alignment,
            tmp_dir=temp_dir,
            max_seqs=n_seqs * n_seqs,
            e=1000000,
            s=8,
        ).to_pandas()

        similarity_matrix = np.zeros((n_seqs, n_seqs))
        header_to_idx = {header: idx for idx, header in enumerate(headers)}

        for _, row in df.iterrows():
            target_idx = header_to_idx.get(parse_identifier(row["target"]))
            query_idx = header_to_idx.get(parse_identifier(row["query"]))
            if target_idx is not None and query_idx is not None:
                fident = row["fident"]
                similarity_matrix[target_idx, query_idx] = fident
                similarity_matrix[query_idx, target_idx] = fident

    finally:
        shutil.rmtree(temp_dir, ignore_errors=True)

    return EmbeddingSet(
        name="MMseqs2",
        data=similarity_matrix,
        headers=headers,
        precomputed=True,
        fasta_path=fasta_path,
    )
