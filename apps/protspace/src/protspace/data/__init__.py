"""
ProtSpace data module.

This module provides data processing, annotation extraction, and I/O functionality.
"""

from protspace.data.annotations import (  # Annotations
    AnnotationConfiguration,
    AnnotationMerger,
    ProteinAnnotationManager,
)
from protspace.data.processors import (  # Processors
    BaseProcessor,
    LocalProcessor,
    UniProtQueryProcessor,
)

__all__ = [
    # Processors
    "BaseProcessor",
    "LocalProcessor",
    "UniProtQueryProcessor",
    # Annotations
    "ProteinAnnotationManager",
    "AnnotationConfiguration",
    "AnnotationMerger",
]
