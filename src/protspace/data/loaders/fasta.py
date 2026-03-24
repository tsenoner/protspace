"""FASTA → embedding loader via Biocentral API.

Extracted from LocalProcessor._embed_fasta_to_h5.
"""

import logging
from pathlib import Path

from protspace.data.loaders.embedding_set import EmbeddingSet
from protspace.data.loaders.h5 import load_h5

logger = logging.getLogger(__name__)


def embed_fasta(
    fasta_path: Path,
    embedder: str,
    *,
    batch_size: int = 1000,
    half_precision: bool = False,
    embedding_cache: Path | None = None,
) -> EmbeddingSet:
    """Parse FASTA, embed via Biocentral API, return EmbeddingSet.

    The model_name attribute is written to the HDF5 root attrs so that
    subsequent load_h5 calls can resolve the PLM name automatically.

    Args:
        fasta_path: Path to FASTA file.
        embedder: Biocentral model shortcut (e.g. "esm2_3b", "prot_t5").
        batch_size: Sequences per API call.
        half_precision: Request float16 embeddings.
        embedding_cache: Override HDF5 cache path.

    Returns:
        EmbeddingSet with embeddings and PLM name.
    """
    from protspace.data.embedding.biocentral import (
        derive_h5_cache_path,
        embed_sequences,
        resolve_embedder,
    )
    from protspace.data.io.fasta import parse_fasta

    sequences = parse_fasta(fasta_path)
    if not sequences:
        raise ValueError(f"No sequences found in {fasta_path}")

    resolved = resolve_embedder(embedder)
    h5_path = (
        Path(embedding_cache)
        if embedding_cache
        else derive_h5_cache_path(fasta_path, resolved)
    )

    h5_path = embed_sequences(
        sequences,
        resolved,
        h5_path,
        batch_size=batch_size,
        half_precision=half_precision,
    )

    # Write model_name attr to H5 so load_h5 can resolve it later
    import h5py

    with h5py.File(h5_path, "a") as f:
        f.attrs["model_name"] = embedder

    return load_h5([h5_path], name_override=embedder)
