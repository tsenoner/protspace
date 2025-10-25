"""
Feature merging logic.

This module handles merging features from multiple sources (UniProt, Taxonomy, InterPro).
"""

from collections import namedtuple

ProteinFeatures = namedtuple("ProteinFeatures", ["identifier", "features"])


class FeatureMerger:
    """Merges features from multiple sources."""

    def merge(
        self,
        uniprot_features: list[ProteinFeatures],
        taxonomy_features: dict,
        interpro_features: list[ProteinFeatures] = None,
    ) -> list[ProteinFeatures]:
        """
        Merge features from UniProt, Taxonomy, and InterPro sources.

        Args:
            uniprot_features: List of ProteinFeatures from UniProt
            taxonomy_features: Dict mapping organism_id to taxonomy features
            interpro_features: List of ProteinFeatures from InterPro (optional)

        Returns:
            List of ProteinFeatures with merged features
        """
        # Create a mapping from identifier to InterPro features for efficient lookup
        interpro_dict = self._create_interpro_dict(interpro_features)

        # Process each protein
        merged_features = []
        for protein in uniprot_features:
            merged_protein = self._merge_protein(
                protein, taxonomy_features, interpro_dict
            )
            merged_features.append(merged_protein)

        return merged_features

    @staticmethod
    def _create_interpro_dict(
        interpro_features: list[ProteinFeatures] | None,
    ) -> dict:
        """Create a dictionary mapping protein identifier to InterPro features."""
        if not interpro_features:
            return {}

        interpro_dict = {}
        for interpro_protein in interpro_features:
            interpro_dict[interpro_protein.identifier] = interpro_protein.features

        return interpro_dict

    def _merge_protein(
        self,
        protein: ProteinFeatures,
        taxonomy_features: dict,
        interpro_dict: dict,
    ) -> ProteinFeatures:
        """
        Merge all feature sources for a single protein.

        Args:
            protein: ProteinFeatures from UniProt
            taxonomy_features: Dict of taxonomy features
            interpro_dict: Dict of InterPro features

        Returns:
            ProteinFeatures with merged features
        """
        # Create a copy to avoid modifying the original
        updated_features = protein.features.copy()

        # Merge taxonomy features
        updated_features = self._merge_taxonomy(
            updated_features, protein.features.get("organism_id"), taxonomy_features
        )

        # Merge InterPro features
        updated_features = self._merge_interpro(
            updated_features, protein.identifier, interpro_dict
        )

        return ProteinFeatures(identifier=protein.identifier, features=updated_features)

    @staticmethod
    def _merge_taxonomy(
        features: dict, organism_id: str, taxonomy_features: dict
    ) -> dict:
        """
        Merge taxonomy features for a protein.

        Args:
            features: Existing protein features
            organism_id: Organism ID from UniProt
            taxonomy_features: Dict of taxonomy features

        Returns:
            Updated features dict
        """
        if not organism_id or not taxonomy_features:
            return features

        try:
            organism_id_int = int(organism_id)
            if organism_id_int in taxonomy_features:
                tax_features = taxonomy_features[organism_id_int]["features"]

                # Add each taxonomy feature
                for feature_name, feature_value in tax_features.items():
                    features[feature_name] = feature_value
        except (ValueError, KeyError):
            # Invalid organism_id or missing taxonomy data
            pass

        return features

    @staticmethod
    def _merge_interpro(features: dict, identifier: str, interpro_dict: dict) -> dict:
        """
        Merge InterPro features for a protein.

        Args:
            features: Existing protein features
            identifier: Protein identifier
            interpro_dict: Dict of InterPro features

        Returns:
            Updated features dict
        """
        if identifier in interpro_dict:
            interpro_data = interpro_dict[identifier]

            # Add each InterPro feature
            for feature_name, feature_value in interpro_data.items():
                features[feature_name] = feature_value

        return features
