"""
Protein feature extraction manager.

This module provides the main orchestrator for feature extraction workflow.
"""

import logging
from pathlib import Path

import pandas as pd

from protspace.data.features.configuration import FeatureConfiguration
from protspace.data.features.merging import FeatureMerger
from protspace.data.features.retrievers.interpro_retriever import (
    INTERPRO_FEATURES,
    InterProRetriever,
)
from protspace.data.features.retrievers.taxonomy_retriever import (
    TAXONOMY_FEATURES,
    TaxonomyRetriever,
)
from protspace.data.features.retrievers.uniprot_retriever import (
    UNIPROT_FEATURES,
    ProteinFeatures,
    UniProtRetriever,
)
from protspace.data.features.transformers.transformer import FeatureTransformer
from protspace.data.io.formatters import DataFormatter
from protspace.data.io.writers import FeatureWriter

logging.basicConfig(format="%(levelname)s: %(message)s")
logger = logging.getLogger(__name__)


class ProteinFeatureManager:
    """Orchestrator for protein feature extraction workflow."""

    def __init__(
        self,
        headers: list[str],
        features: list = None,
        output_path: Path = None,
        non_binary: bool = False,
        sequences: dict = None,
        cached_data: pd.DataFrame = None,
        sources_to_fetch: dict = None,
    ):
        """
        Initialize feature manager.

        Args:
            headers: List of protein identifiers/accessions
            features: List of features to extract (None = use defaults)
            output_path: Path to save output file (None = return DataFrame only)
            non_binary: If True, save as CSV; if False, save as Parquet
            sequences: Dictionary mapping identifiers to sequences (for InterPro)
            cached_data: Previously cached DataFrame with features
            sources_to_fetch: Dict indicating which sources to fetch (uniprot, taxonomy, interpro)
        """
        self.headers = headers
        self.output_path = output_path
        self.non_binary = non_binary
        self.sequences = sequences
        self.cached_data = cached_data
        self.sources_to_fetch = sources_to_fetch or {
            "uniprot": True,
            "taxonomy": True,
            "interpro": True,
        }

        # Initialize configuration
        self.config = FeatureConfiguration(features)
        self.user_features = self.config.user_features

        # Initialize components
        self.transformer = FeatureTransformer()
        self.merger = FeatureMerger()
        self.writer = FeatureWriter(transformer=self.transformer)

    def to_pd(self) -> pd.DataFrame:
        """
        Main workflow: fetch → merge → transform → output.

        Returns:
            DataFrame with requested features
        """
        # Track which feature sources failed
        failed_sources = []

        # Extract cached features by source if available
        cached_uniprot = (
            self._extract_cached_source(UNIPROT_FEATURES)
            if self.cached_data is not None and not self.sources_to_fetch["uniprot"]
            else None
        )
        cached_taxonomy = (
            self._extract_cached_taxonomy(TAXONOMY_FEATURES)
            if self.cached_data is not None and not self.sources_to_fetch["taxonomy"]
            else None
        )
        cached_interpro = (
            self._extract_cached_source(INTERPRO_FEATURES)
            if self.cached_data is not None and not self.sources_to_fetch["interpro"]
            else None
        )

        # 1. Conditionally fetch based on sources_to_fetch
        uniprot_features = (
            self._fetch_uniprot(failed_sources)
            if self.sources_to_fetch["uniprot"]
            else cached_uniprot
        )
        taxonomy_features = (
            self._fetch_taxonomy(uniprot_features, failed_sources)
            if self.sources_to_fetch["taxonomy"]
            else cached_taxonomy
        )
        interpro_features = (
            self._fetch_interpro(uniprot_features, failed_sources)
            if self.sources_to_fetch["interpro"]
            else cached_interpro
        )

        # Report failed sources
        if failed_sources:
            logger.warning(
                f"Could not retrieve features from the following sources: {', '.join(failed_sources)}"
            )

        # 2. Merge features from all sources (including cached)
        merged_features = self.merger.merge(
            uniprot_features, taxonomy_features, interpro_features
        )

        # 3. Apply transformations
        apply_binning = (
            self.user_features is None
            or "length_fixed" in self.user_features
            or "length_quantile" in self.user_features
        )
        transformed_features = self.transformer.transform(
            merged_features, apply_length_binning=apply_binning
        )

        # 4. Create output
        if self.output_path:
            df = self._save_and_load(transformed_features)
        else:
            df = DataFormatter.to_dataframe(transformed_features)

        # 5. Always remove organism_id from final output (it's only needed internally)
        if "organism_id" in df.columns:
            df = df.drop(columns=["organism_id"])

        # 6. Filter columns if user requested specific features
        if self.user_features:
            columns_to_keep = [df.columns[0]]  # Keep identifier
            for feature in self.user_features:
                if feature in df.columns:
                    columns_to_keep.append(feature)
            return df[columns_to_keep]
        else:
            # Filter out sequence if it was auto-added for InterPro but not explicitly requested
            if (
                self.config.interpro_features
                and "sequence" in df.columns
                and (not self.user_features or "sequence" not in self.user_features)
            ):
                df = df.drop(columns=["sequence"])
            return df

    def _fetch_uniprot(self, failed_sources: list) -> list[ProteinFeatures]:
        """Fetch UniProt features."""
        try:
            retriever = UniProtRetriever(
                headers=self.headers, features=self.config.uniprot_features
            )
            return retriever.fetch_features()
        except Exception as e:
            failed_sources.append(f"UniProt ({str(e)})")
            logger.warning(f"Failed to retrieve UniProt features: {e}")
            # Create minimal feature set with just identifiers
            return [
                ProteinFeatures(identifier=header, features={"organism_id": ""})
                for header in self.headers
            ]

    def _fetch_taxonomy(
        self, uniprot_features: list[ProteinFeatures], failed_sources: list
    ) -> dict:
        """Fetch taxonomy features if requested."""
        if not self.config.taxonomy_features:
            return {}

        try:
            # Extract unique taxonomy IDs
            taxon_counts = self._get_taxon_counts(uniprot_features)
            unique_taxons = list(taxon_counts.keys())

            if not unique_taxons:
                return {}

            retriever = TaxonomyRetriever(
                taxon_ids=unique_taxons, features=self.config.taxonomy_features
            )
            return retriever.fetch_features()
        except Exception as e:
            failed_sources.append(f"Taxonomy ({str(e)})")
            logger.warning(f"Failed to retrieve Taxonomy features: {e}")
            return {}

    def _fetch_interpro(
        self, uniprot_features: list[ProteinFeatures], failed_sources: list
    ) -> list[ProteinFeatures]:
        """Fetch InterPro features if requested."""
        if not self.config.interpro_features:
            return []

        try:
            # Extract sequences from UniProt data for InterPro MD5 calculation
            sequences = {}
            for protein in uniprot_features:
                if "sequence" in protein.features and protein.features["sequence"]:
                    sequences[protein.identifier] = protein.features["sequence"]

            # Update self.sequences for InterPro retrieval
            self.sequences = sequences

            retriever = InterProRetriever(
                headers=self.headers,
                features=self.config.interpro_features,
                sequences=self.sequences,
            )
            return retriever.fetch_features()
        except Exception as e:
            failed_sources.append(f"InterPro ({str(e)})")
            logger.warning(f"Failed to retrieve InterPro features: {e}")
            return []

    def _save_and_load(self, proteins: list[ProteinFeatures]) -> pd.DataFrame:
        """Save to file and load back."""
        if self.non_binary:
            self.writer.write_csv(
                proteins, self.output_path, apply_transforms=False
            )  # Already transformed
            df = pd.read_csv(self.output_path)
        else:
            self.writer.write_parquet(
                proteins, self.output_path, apply_transforms=False
            )  # Already transformed
            df = pd.read_parquet(self.output_path)
        return df

    @staticmethod
    def _get_taxon_counts(fetched_uniprot: list[ProteinFeatures]) -> dict:
        """Returns a dictionary with organism IDs as keys and their occurrence counts as values."""
        id_counts = {}

        for protein in fetched_uniprot:
            organism_id = protein.features.get("organism_id")
            if organism_id:
                try:
                    org_id = int(organism_id)
                    id_counts[org_id] = id_counts.get(org_id, 0) + 1
                except ValueError:
                    pass

        return id_counts

    def _extract_cached_source(
        self, source_features: list[str]
    ) -> list[ProteinFeatures]:
        """
        Extract cached features for a specific source (UniProt or InterPro).

        Args:
            source_features: List of feature names from this source

        Returns:
            List of ProteinFeatures with cached data for this source
        """
        if self.cached_data is None:
            return []

        # Find available features from this source in cache
        available = [f for f in source_features if f in self.cached_data.columns]
        if not available:
            return []

        # Convert DataFrame to ProteinFeatures format
        result = []
        identifier_col = self.cached_data.columns[0]  # First column is identifier

        for _, row in self.cached_data.iterrows():
            features_dict = {}
            for feature in available:
                features_dict[feature] = row[feature]

            result.append(
                ProteinFeatures(identifier=row[identifier_col], features=features_dict)
            )

        return result

    def _extract_cached_taxonomy(self, taxonomy_features: list[str]) -> dict:
        """
        Extract cached taxonomy features.

        Args:
            taxonomy_features: List of taxonomy feature names

        Returns:
            Dict mapping organism_id to taxonomy features (same format as TaxonomyRetriever)
        """
        if self.cached_data is None or "organism_id" not in self.cached_data.columns:
            return {}

        # Find available taxonomy features in cache
        available = [f for f in taxonomy_features if f in self.cached_data.columns]
        if not available:
            return {}

        # Convert to taxonomy format: {organism_id: {"features": {feature: value}}}
        taxonomy_dict = {}

        # Group by organism_id
        for _, row in self.cached_data.iterrows():
            organism_id = row["organism_id"]
            if pd.isna(organism_id) or organism_id == "":
                continue

            try:
                org_id = int(organism_id)
                if org_id not in taxonomy_dict:
                    features_dict = {}
                    for feature in available:
                        features_dict[feature] = row[feature]
                    taxonomy_dict[org_id] = {"features": features_dict}
            except (ValueError, TypeError):
                pass

        return taxonomy_dict
