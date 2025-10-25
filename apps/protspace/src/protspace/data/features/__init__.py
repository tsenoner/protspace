"""
Feature extraction and management for ProtSpace.

This module handles protein feature extraction, transformation, and processing:
- ProteinFeatureManager: Main orchestrator for feature extraction workflow
- FeatureConfiguration: Feature validation and configuration
- FeatureMerger: Merges features from multiple sources
"""

from protspace.data.features.configuration import FeatureConfiguration
from protspace.data.features.manager import ProteinFeatureManager
from protspace.data.features.merging import FeatureMerger

__all__ = ["ProteinFeatureManager", "FeatureConfiguration", "FeatureMerger"]
