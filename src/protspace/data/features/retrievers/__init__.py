"""
Feature retrievers for external data sources.

This module contains retrievers that fetch features from various APIs:
- BaseFeatureRetriever: Abstract base class for all retrievers
- UniProtRetriever: Fetches features from UniProt API
- TaxonomyRetriever: Fetches taxonomy lineage data
- InterProRetriever: Fetches InterPro annotations
"""

from protspace.data.features.retrievers.base_retriever import BaseFeatureRetriever
from protspace.data.features.retrievers.interpro_retriever import InterProRetriever
from protspace.data.features.retrievers.taxonomy_retriever import TaxonomyRetriever
from protspace.data.features.retrievers.uniprot_retriever import UniProtRetriever

__all__ = [
    "BaseFeatureRetriever",
    "UniProtRetriever",
    "TaxonomyRetriever",
    "InterProRetriever",
]
