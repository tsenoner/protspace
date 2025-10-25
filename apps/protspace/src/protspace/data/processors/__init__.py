"""
Data processors for ProtSpace.

This module contains processors for different data sources:
- BaseProcessor: Base class with common dimension reduction logic
- LocalProcessor: Processes local H5/HDF5 embedding files
- UniProtQueryProcessor: Processes UniProt queries and generates embeddings
"""

from protspace.data.processors.base_processor import BaseProcessor
from protspace.data.processors.local_processor import LocalProcessor
from protspace.data.processors.uniprot_query_processor import UniProtQueryProcessor

__all__ = ["BaseProcessor", "LocalProcessor", "UniProtQueryProcessor"]
