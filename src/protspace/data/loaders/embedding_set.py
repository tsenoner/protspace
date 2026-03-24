"""Core data structure for embedding sets."""

from dataclasses import dataclass, field
from pathlib import Path

import numpy as np


@dataclass
class EmbeddingSet:
    """A named set of protein embeddings from a single source.

    Attributes:
        name: Source identifier (e.g. "esm2_3b", "prot_t5", "MMseqs2").
        data: Embedding matrix (n_proteins, dim) or (n, n) for similarity.
        headers: Protein identifiers in row order.
        precomputed: True when data is a precomputed distance/similarity matrix.
        fasta_path: Path to source FASTA file, if available.
    """

    name: str
    data: np.ndarray
    headers: list[str] = field(repr=False)
    precomputed: bool = False
    fasta_path: Path | None = None
