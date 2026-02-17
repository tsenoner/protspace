"""
Input/Output operations for ProtSpace data.

This module centralizes file I/O operations:
- DataReader: Unified interface for reading different file formats
- AnnotationWriter: Writes annotation data to different formats
- DataFormatter: Format data for different outputs
- Bundle I/O: Read/write .parquetbundle files
- Settings converter: Bidirectional conversion between settings formats
"""

from protspace.data.io.bundle import (
    PARQUET_BUNDLE_DELIMITER,
    create_settings_parquet,
    extract_bundle_to_dir,
    read_bundle,
    read_settings_from_bytes,
    read_settings_from_file,
    replace_settings_in_bundle,
    write_bundle,
)
from protspace.data.io.formatters import DataFormatter
from protspace.data.io.readers import DataReader
from protspace.data.io.settings_converter import (
    settings_to_visualization_state,
    visualization_state_to_settings,
)
from protspace.data.io.writers import AnnotationWriter

__all__ = [
    "DataReader",
    "AnnotationWriter",
    "DataFormatter",
    "PARQUET_BUNDLE_DELIMITER",
    "extract_bundle_to_dir",
    "read_bundle",
    "write_bundle",
    "replace_settings_in_bundle",
    "create_settings_parquet",
    "read_settings_from_bytes",
    "read_settings_from_file",
    "settings_to_visualization_state",
    "visualization_state_to_settings",
]
