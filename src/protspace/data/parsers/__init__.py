"""Data parsers for external data sources."""

from protspace.data.parsers.uniprot_parser import (
    AVAILABLE_PROPERTIES,
    UniProtEntry,
    fetch_uniprot_data,
)

__all__ = ["AVAILABLE_PROPERTIES", "UniProtEntry", "fetch_uniprot_data"]
