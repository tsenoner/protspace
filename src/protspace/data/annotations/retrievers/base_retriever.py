"""
Base class for annotation retrievers.

This module provides an abstract base class for all annotation retrievers.
"""

from abc import ABC, abstractmethod
from collections import namedtuple

ProteinAnnotations = namedtuple("ProteinAnnotations", ["identifier", "annotations"])


class BaseAnnotationRetriever(ABC):
    """Abstract base class for all annotation retrievers."""

    def __init__(self, headers: list[str] = None, annotations: list = None):
        """
        Initialize the retriever.

        Args:
            headers: List of protein identifiers/accessions
            annotations: List of annotations to retrieve (retriever-specific)
        """
        self.headers = headers if headers else []
        self.annotations = annotations

    @abstractmethod
    def fetch_annotations(self) -> list[ProteinAnnotations]:
        """
        Fetch annotations from the data source.

        Returns:
            List of ProteinAnnotations containing identifier and annotations dict

        Raises:
            NotImplementedError: Must be implemented by subclass
        """
        raise NotImplementedError("Subclasses must implement fetch_annotations()")
