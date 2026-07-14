"""Core data structure for embedding sets."""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from pathlib import Path

import numpy as np

logger = logging.getLogger(__name__)

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


# Abbreviations for DR parameters in projection names
_PARAM_ABBREVS: dict[str, str] = {
    "n_neighbors": "n",
    "min_dist": "d",
    "perplexity": "p",
    "learning_rate": "lr",
    "mn_ratio": "mn",
    "fp_ratio": "fp",
    "metric": "m",
    "random_state": "rs",
    "n_init": "ni",
    "max_iter": "mi",
    "eps": "e",
}


def format_param_suffix(overrides: dict[str, int | float | str]) -> str:
    """Format parameter overrides into a compact suffix string.

    Examples:
        {"n_neighbors": 50, "min_dist": 0.1} → "n=50, d=0.1"
        {"metric": "cosine"} → "m=cosine"
    """
    parts = []
    for key in sorted(overrides):
        abbr = _PARAM_ABBREVS.get(key, key)
        parts.append(f"{abbr}={overrides[key]}")
    return ", ".join(parts)


def format_projection_name(
    source: str, method: str, dims: int, param_suffix: str = ""
) -> str:
    """Format a human-readable projection name.

    Examples:
        ("prot_t5", "pca", 2) → "ProtT5 — PCA 2"
        ("esm2_650m", "umap", 2, "n=50, d=0.1") → "ESM2-650M — UMAP 2 (n=50, d=0.1)"
    """
    source_display = MODEL_DISPLAY_NAMES.get(source, source)
    method_display = METHOD_DISPLAY_NAMES.get(method, method.upper())
    name = f"{source_display} — {method_display} {dims}"
    if param_suffix:
        name += f" ({param_suffix})"
    return name


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


def merge_same_name_sets(
    embedding_sets: list[EmbeddingSet],
) -> list[EmbeddingSet]:
    """Merge EmbeddingSets that share the same name (union), leave others for intersection.

    When multiple ``-i`` inputs resolve to the same embedding name (e.g. two
    species both embedded with ProtT5), their proteins should be concatenated
    rather than intersected.  Sets with *different* names are left as separate
    entries so that ``_validate_headers`` can intersect them later.

    Raises:
        ValueError: If same-name sets have mismatched dimensions, conflicting
            embeddings for the same protein, or are precomputed matrices.
    """
    if len(embedding_sets) <= 1:
        return embedding_sets

    # Group by name, preserving insertion order
    groups: dict[str, list[EmbeddingSet]] = {}
    for es in embedding_sets:
        groups.setdefault(es.name, []).append(es)

    merged: list[EmbeddingSet] = []
    for name, group in groups.items():
        if len(group) == 1:
            merged.append(group[0])
            continue

        # Reject precomputed (similarity) matrices — can't concatenate
        if any(es.precomputed for es in group):
            raise ValueError(
                f"Cannot merge precomputed distance/similarity matrices for "
                f"'{name}'. Precomputed matrices must be provided as a single "
                f"file."
            )

        # Validate consistent embedding dimension
        dims = {es.data.shape[1] for es in group}
        if len(dims) > 1:
            dim_list = ", ".join(str(d) for d in sorted(dims))
            raise ValueError(
                f"Cannot merge embedding sets for '{name}': dimension mismatch "
                f"({dim_list}). All files with the same embedding name must "
                f"have the same embedding dimension."
            )

        # Collect unique proteins, detect conflicting duplicates
        seen: dict[str, int] = {}  # header -> index in merged_rows
        merged_headers: list[str] = []
        merged_rows: list[np.ndarray] = []
        n_dedup = 0

        for es in group:
            for i, header in enumerate(es.headers):
                if header in seen:
                    existing = merged_rows[seen[header]]
                    if np.allclose(existing, es.data[i], atol=1e-6):
                        n_dedup += 1
                        continue
                    raise ValueError(
                        f"Cannot merge embedding sets for '{name}': protein "
                        f"'{header}' has conflicting embedding data across "
                        f"input files."
                    )
                seen[header] = len(merged_rows)
                merged_headers.append(header)
                merged_rows.append(es.data[i])

        # Pick first non-None fasta_path
        fasta_path = next((es.fasta_path for es in group if es.fasta_path), None)

        merged.append(
            EmbeddingSet(
                name=name,
                data=np.vstack(merged_rows),
                headers=merged_headers,
                fasta_path=fasta_path,
            )
        )

        total = len(merged_headers)
        sources = len(group)
        logger.info(
            "Merged %d input(s) for embedding '%s': %d proteins total",
            sources,
            name,
            total,
        )
        if n_dedup:
            logger.info(
                "Deduplicated %d protein(s) with identical embeddings in '%s'",
                n_dedup,
                name,
            )

    return merged
