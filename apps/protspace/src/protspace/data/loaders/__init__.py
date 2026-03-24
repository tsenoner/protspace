"""Composable input loaders for the ProtSpace pipeline."""

from protspace.data.loaders.embedding_set import EmbeddingSet
from protspace.data.loaders.fasta import embed_fasta
from protspace.data.loaders.h5 import EMBEDDING_EXTENSIONS, load_h5
from protspace.data.loaders.query import (
    extract_identifiers_from_fasta,
    query_uniprot,
)
from protspace.data.loaders.similarity import compute_similarity

__all__ = [
    "EMBEDDING_EXTENSIONS",
    "EmbeddingSet",
    "compute_similarity",
    "embed_fasta",
    "extract_identifiers_from_fasta",
    "load_h5",
    "query_uniprot",
]
