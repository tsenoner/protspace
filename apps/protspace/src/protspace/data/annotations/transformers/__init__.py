"""
Annotation transformers for data processing.

This module contains transformers that convert raw annotation values to user-friendly formats:
- AnnotationTransformer: Main transformation orchestrator
- UniProtTransformer: UniProt-specific transformations
- InterProTransformer: InterPro-specific transformations
"""

from protspace.data.annotations.transformers.interpro_transforms import (
    InterProTransformer,
)
from protspace.data.annotations.transformers.transformer import (
    AnnotationTransformer,
)
from protspace.data.annotations.transformers.uniprot_transforms import (
    UniProtTransformer,
)

__all__ = [
    "AnnotationTransformer",
    "UniProtTransformer",
    "InterProTransformer",
]
