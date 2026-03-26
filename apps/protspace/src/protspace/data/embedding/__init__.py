"""Biocentral API embedding integration."""

from protspace.data.embedding.biocentral import (
    ALL_SHORT_KEYS,
    DEFAULT_EMBEDDER,
    EXTRA_SHORT_KEYS,
    MODEL_SHORT_KEYS,
    embed_sequences,
    resolve_embedder,
)

__all__ = [
    "ALL_SHORT_KEYS",
    "DEFAULT_EMBEDDER",
    "EXTRA_SHORT_KEYS",
    "MODEL_SHORT_KEYS",
    "resolve_embedder",
    "embed_sequences",
]
