"""FASTA → embedding loader via Biocentral API.

Extracted from LocalProcessor._embed_fasta_to_h5.
"""

import logging
from pathlib import Path

from protspace.data.loaders.embedding_set import EmbeddingSet
from protspace.data.loaders.h5 import load_h5, parse_identifier

logger = logging.getLogger(__name__)


def embed_fasta(
    fasta_path: Path,
    embedder: str,
    *,
    batch_size: int = 1000,
    embedding_cache: Path | None = None,
) -> EmbeddingSet:
    """Parse FASTA, embed via Biocentral API, return EmbeddingSet.

    FASTA headers are parsed to extract UniProt accessions before embedding,
    so H5 keys are clean identifiers (e.g. P12345 instead of sp|P12345|NAME).
    The model_name attribute is written to H5 root attrs.
    """
    from protspace.data.embedding.biocentral import (
        derive_h5_cache_path,
        embed_sequences,
        resolve_embedder,
    )
    from protspace.data.io.fasta import parse_fasta

    raw_sequences = parse_fasta(fasta_path)
    if not raw_sequences:
        raise ValueError(f"No sequences found in {fasta_path}")

    # Remap keys: sp|P12345|NAME → P12345
    sequences = {parse_identifier(header): seq for header, seq in raw_sequences.items()}

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
    )

    # Write model_name attr to H5 so load_h5 can resolve it later
    import h5py

    with h5py.File(h5_path, "a") as f:
        f.attrs["model_name"] = embedder

    return load_h5([h5_path], name_override=embedder)
