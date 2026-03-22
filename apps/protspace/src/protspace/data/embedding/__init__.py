"""Biocentral API embedding integration."""

from protspace.data.embedding.biocentral import (
    DEFAULT_EMBEDDER,
    MODEL_SHORT_KEYS,
    embed_sequences,
    resolve_embedder,
)

__all__ = [
    "MODEL_SHORT_KEYS",
    "DEFAULT_EMBEDDER",
    "resolve_embedder",
    "embed_sequences",
]
