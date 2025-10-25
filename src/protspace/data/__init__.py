"""
ProtSpace data module.

This module provides data processing, feature extraction, and I/O functionality.
"""

from protspace.data.features import (  # Features
    FeatureConfiguration,
    FeatureMerger,
    ProteinFeatureManager,
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
    # Features
    "ProteinFeatureManager",
    "FeatureConfiguration",
    "FeatureMerger",
]
