"""
Annotation extraction and management for ProtSpace.

This module handles protein annotation extraction, transformation, and processing:
- ProteinAnnotationManager: Main orchestrator for annotation extraction workflow
- AnnotationConfiguration: Annotation validation and configuration
- AnnotationMerger: Merges annotations from multiple sources
"""

from protspace.data.annotations.configuration import AnnotationConfiguration
from protspace.data.annotations.manager import ProteinAnnotationManager
from protspace.data.annotations.merging import AnnotationMerger

__all__ = ["ProteinAnnotationManager", "AnnotationConfiguration", "AnnotationMerger"]
