"""
Base class for feature retrievers.

This module provides an abstract base class for all feature retrievers.
"""

from abc import ABC, abstractmethod
from collections import namedtuple

ProteinFeatures = namedtuple("ProteinFeatures", ["identifier", "features"])


class BaseFeatureRetriever(ABC):
    """Abstract base class for all feature retrievers."""

    def __init__(self, headers: list[str] = None, features: list = None):
        """
        Initialize the retriever.

        Args:
            headers: List of protein identifiers/accessions
            features: List of features to retrieve (retriever-specific)
        """
        self.headers = headers if headers else []
        self.features = features

    @abstractmethod
    def fetch_features(self) -> list[ProteinFeatures]:
        """
        Fetch features from the data source.

        Returns:
            List of ProteinFeatures containing identifier and features dict

        Raises:
            NotImplementedError: Must be implemented by subclass
        """
        raise NotImplementedError("Subclasses must implement fetch_features()")
