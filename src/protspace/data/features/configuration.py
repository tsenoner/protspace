"""
Feature configuration and validation.

This module handles feature selection, validation, and source splitting.
"""

import logging

from protspace.data.features.retrievers.interpro_retriever import INTERPRO_FEATURES
from protspace.data.features.retrievers.taxonomy_retriever import TAXONOMY_FEATURES
from protspace.data.features.retrievers.uniprot_retriever import UNIPROT_FEATURES

logger = logging.getLogger(__name__)

# Constants
DEFAULT_FEATURES = UNIPROT_FEATURES + TAXONOMY_FEATURES + INTERPRO_FEATURES
NEEDED_UNIPROT_FEATURES = ["accession", "organism_id"]
LENGTH_BINNING_FEATURES = ["length_fixed", "length_quantile"]


class FeatureConfiguration:
    """Manages feature selection, validation, and source splitting."""

    def __init__(self, user_features: list[str] = None):
        """
        Initialize feature configuration.

        Args:
            user_features: List of feature names requested by user (None = use defaults)
        """
        self.user_features = self._validate(user_features)
        self.uniprot_features, self.taxonomy_features, self.interpro_features = (
            self._split_by_source()
        )

    def _validate(self, user_features: list[str]) -> list[str] | None:
        """
        Validate requested features against available features.

        Args:
            user_features: List of requested feature names

        Returns:
            Validated list of features or None

        Raises:
            ValueError: If any requested feature is not available
        """
        if user_features is None:
            return None

        all_features = DEFAULT_FEATURES + LENGTH_BINNING_FEATURES

        for feature in user_features:
            if feature not in all_features:
                raise ValueError(
                    f"Feature {feature} is not a valid feature. Valid features are: {all_features}"
                )

        return user_features

    def _split_by_source(self) -> tuple[list[str], list[str] | None, list[str] | None]:
        """
        Split features into UniProt, Taxonomy, and InterPro features.

        Returns:
            Tuple of (uniprot_features, taxonomy_features, interpro_features)
        """
        if self.user_features:
            return self._split_user_features()
        else:
            return self._get_default_features()

    def _split_user_features(
        self,
    ) -> tuple[list[str], list[str] | None, list[str] | None]:
        """Split user-requested features by source."""
        # Extract features by source
        uniprot_features = [
            feature for feature in DEFAULT_FEATURES if feature in UNIPROT_FEATURES
        ]
        taxonomy_features = [
            feature for feature in DEFAULT_FEATURES if feature in TAXONOMY_FEATURES
        ]
        interpro_features = [
            feature for feature in DEFAULT_FEATURES if feature in INTERPRO_FEATURES
        ]

        # Check if user requested length binning features
        user_has_length_features = any(
            feature in self.user_features for feature in LENGTH_BINNING_FEATURES
        )

        # If user requested length features, we need the length feature from UniProt
        if user_has_length_features and "length" not in uniprot_features:
            uniprot_features.append("length")

        # Add required features (accession, organism_id) and sequence if needed
        uniprot_features = self._add_required_features(
            uniprot_features, interpro_features
        )

        # Return based on what's needed
        if taxonomy_features or interpro_features:
            return (
                uniprot_features,
                taxonomy_features if taxonomy_features else None,
                interpro_features if interpro_features else None,
            )
        else:
            return uniprot_features, None, None

    def _get_default_features(
        self,
    ) -> tuple[list[str], list[str] | None, list[str] | None]:
        """Get default feature configuration."""
        uniprot_features = [
            feature for feature in DEFAULT_FEATURES if feature in UNIPROT_FEATURES
        ]
        taxonomy_features = [
            feature for feature in DEFAULT_FEATURES if feature in TAXONOMY_FEATURES
        ]
        interpro_features = [
            feature for feature in DEFAULT_FEATURES if feature in INTERPRO_FEATURES
        ]

        uniprot_features = self._add_required_features(
            uniprot_features, interpro_features
        )

        # We have taxonomy or interpro features
        if taxonomy_features or interpro_features:
            return (
                uniprot_features,
                taxonomy_features if taxonomy_features else None,
                interpro_features if interpro_features else None,
            )

        # We have other features than the needed ones
        elif len(uniprot_features) > len(NEEDED_UNIPROT_FEATURES):
            return uniprot_features, None, None

        else:
            logger.info("No features provided, using default UniProt features")
            return UNIPROT_FEATURES, None, None

    def _add_required_features(
        self, features: list[str], interpro_features: list[str] = None
    ) -> list[str]:
        """
        Add required features (accession, organism_id) and sequence if needed for InterPro.

        Args:
            features: List of requested UniProt features
            interpro_features: List of InterPro features (if any)

        Returns:
            Updated list with required features
        """
        # Remove required features if already present to avoid duplicates
        filtered_features = [f for f in features if f not in NEEDED_UNIPROT_FEATURES]

        # Always start with required features
        result = NEEDED_UNIPROT_FEATURES + filtered_features

        # Always include sequence if InterPro features are requested (needed for MD5 calculation)
        if interpro_features and "sequence" not in result:
            result.append("sequence")

        return result
