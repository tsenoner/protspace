"""Core data structure for embedding sets."""

from dataclasses import dataclass, field
from pathlib import Path

import numpy as np

# Display names for pLM models and tools
MODEL_DISPLAY_NAMES: dict[str, str] = {
    "prot_t5": "ProtT5",
    "prost_t5": "ProstT5",
    "esm2_8m": "ESM2-8M",
    "esm2_35m": "ESM2-35M",
    "esm2_150m": "ESM2-150M",
    "esm2_650m": "ESM2-650M",
    "esm2_3b": "ESM2-3B",
    "ankh_base": "Ankh-Base",
    "ankh_large": "Ankh-Large",
    "ankh3_large": "Ankh3-Large",
    "esmc_300m": "ESMC-300M",
    "esmc_600m": "ESMC-600M",
    "MMseqs2": "MMseqs2",
}

# Display names for DR methods
METHOD_DISPLAY_NAMES: dict[str, str] = {
    "pca": "PCA",
    "umap": "UMAP",
    "tsne": "t-SNE",
    "pacmap": "PaCMAP",
    "mds": "MDS",
    "localmap": "LocalMAP",
}


def format_projection_name(source: str, method: str, dims: int) -> str:
    """Format a human-readable projection name.

    Examples:
        ("prot_t5", "pca", 2) → "ProtT5 — PCA 2"
        ("esm2_650m", "umap", 2) → "ESM2-650M — UMAP 2"
        ("MMseqs2", "mds", 2) → "MMseqs2 — MDS 2"
    """
    source_display = MODEL_DISPLAY_NAMES.get(source, source)
    method_display = METHOD_DISPLAY_NAMES.get(method, method.upper())
    return f"{source_display} — {method_display} {dims}"


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
