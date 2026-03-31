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
    cache_dir: Path | None = None,
    force_refetch: bool = False,
) -> EmbeddingSet:
    """Compute pairwise sequence similarity using MMseqs2 easy_search.

    Args:
        fasta_path: Path to FASTA file.
        headers: Protein identifiers (order determines matrix rows/cols).
        cache_dir: Optional directory for cached results and temp files.
        force_refetch: If True, recompute even if cache exists.

    Returns:
        EmbeddingSet with precomputed=True, name="MMseqs2".
    """
    # --- Cache check ---
    matrix_cache = cache_dir / "similarity_matrix.npy" if cache_dir else None
    headers_cache = cache_dir / "similarity_headers.npy" if cache_dir else None

    if (
        matrix_cache
        and matrix_cache.exists()
        and headers_cache
        and headers_cache.exists()
        and not force_refetch
    ):
        cached_headers = list(np.load(headers_cache, allow_pickle=False))
        if cached_headers == headers:
            logger.warning(
                "Using cached similarity matrix from %s "
                "(use --force-refetch to recompute)",
                matrix_cache,
            )
            return EmbeddingSet(
                name="MMseqs2",
                data=np.load(matrix_cache),
                headers=headers,
                precomputed=True,
                fasta_path=fasta_path,
            )
        logger.info("Cached similarity headers differ; recomputing.")

    # --- Compute ---
    from pymmseqs.commands import easy_search

    n_seqs = len(headers)
    input_fasta = str(fasta_path.absolute())

    logger.info("Computing sequence similarity with MMseqs2...")

    if cache_dir:
        cache_dir.mkdir(parents=True, exist_ok=True)
        temp_dir = str((cache_dir / "mmseqs_tmp").absolute())
        Path(temp_dir).mkdir(exist_ok=True)
    else:
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
        if not cache_dir:
            shutil.rmtree(temp_dir, ignore_errors=True)

    # --- Save cache ---
    if matrix_cache:
        np.save(matrix_cache, similarity_matrix)
        np.save(headers_cache, np.array(headers))

    return EmbeddingSet(
        name="MMseqs2",
        data=similarity_matrix,
        headers=headers,
        precomputed=True,
        fasta_path=fasta_path,
    )
