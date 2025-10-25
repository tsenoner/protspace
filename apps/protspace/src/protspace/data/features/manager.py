"""
Protein feature extraction manager.

This module provides the main orchestrator for feature extraction workflow.
"""

import logging
from pathlib import Path

import pandas as pd

from protspace.data.features.configuration import FeatureConfiguration
from protspace.data.features.merging import FeatureMerger
from protspace.data.features.retrievers.interpro_retriever import InterProRetriever
from protspace.data.features.retrievers.taxonomy_retriever import TaxonomyRetriever
from protspace.data.features.retrievers.uniprot_retriever import (
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
    ):
        """
        Initialize feature manager.

        Args:
            headers: List of protein identifiers/accessions
            features: List of features to extract (None = use defaults)
            output_path: Path to save output file (None = return DataFrame only)
            non_binary: If True, save as CSV; if False, save as Parquet
            sequences: Dictionary mapping identifiers to sequences (for InterPro)
        """
        self.headers = headers
        self.output_path = output_path
        self.non_binary = non_binary
        self.sequences = sequences

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

        # 1. Fetch features from all sources
        uniprot_features = self._fetch_uniprot(failed_sources)
        taxonomy_features = self._fetch_taxonomy(uniprot_features, failed_sources)
        interpro_features = self._fetch_interpro(uniprot_features, failed_sources)

        # Report failed sources
        if failed_sources:
            logger.warning(
                f"Could not retrieve features from the following sources: {', '.join(failed_sources)}"
            )

        # 2. Merge features from all sources
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
