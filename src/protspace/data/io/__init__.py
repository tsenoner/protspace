"""
Input/Output operations for ProtSpace data.

This module centralizes file I/O operations:
- DataReader: Unified interface for reading different file formats
- AnnotationWriter: Writes annotation data to different formats
- DataFormatter: Format data for different outputs
"""

from protspace.data.io.formatters import DataFormatter
from protspace.data.io.readers import DataReader
from protspace.data.io.writers import AnnotationWriter

__all__ = ["DataReader", "AnnotationWriter", "DataFormatter"]
