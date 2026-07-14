"""
Annotation retrievers for external data sources.

This module contains retrievers that fetch annotations from various APIs:
- BaseAnnotationRetriever: Abstract base class for all retrievers
- UniProtRetriever: Fetches annotations from UniProt API
- TaxonomyRetriever: Fetches taxonomy lineage data
- InterProRetriever: Fetches InterPro annotations
"""

from protspace.data.annotations.retrievers.base_retriever import BaseAnnotationRetriever
from protspace.data.annotations.retrievers.interpro_retriever import InterProRetriever
from protspace.data.annotations.retrievers.taxonomy_retriever import TaxonomyRetriever
from protspace.data.annotations.retrievers.uniprot_retriever import UniProtRetriever

__all__ = [
    "BaseAnnotationRetriever",
    "UniProtRetriever",
    "TaxonomyRetriever",
    "InterProRetriever",
]
