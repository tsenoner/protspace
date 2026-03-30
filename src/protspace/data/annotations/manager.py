"""
Protein annotation extraction manager.

This module provides the main orchestrator for annotation extraction workflow.
"""

import logging
from pathlib import Path

import pandas as pd

from protspace.data.annotations.configuration import AnnotationConfiguration
from protspace.data.annotations.merging import AnnotationMerger
from protspace.data.annotations.retrievers.biocentral_retriever import (
    BIOCENTRAL_ANNOTATIONS,
    BiocentralPredictionRetriever,
)
from protspace.data.annotations.retrievers.interpro_retriever import (
    INTERPRO_ANNOTATIONS,
    InterProRetriever,
)
from protspace.data.annotations.retrievers.taxonomy_retriever import (
    TAXONOMY_ANNOTATIONS,
    TaxonomyRetriever,
)
from protspace.data.annotations.retrievers.ted_retriever import (
    TED_ANNOTATIONS,
    TedRetriever,
)
from protspace.data.annotations.retrievers.uniprot_retriever import (
    UNIPROT_ANNOTATIONS,
    ProteinAnnotations,
    UniProtRetriever,
)
from protspace.data.annotations.transformers.transformer import AnnotationTransformer
from protspace.data.io.formatters import DataFormatter
from protspace.data.io.writers import AnnotationWriter

logger = logging.getLogger(__name__)


class ProteinAnnotationManager:
    """Orchestrator for protein annotation extraction workflow."""

    def __init__(
        self,
        headers: list[str],
        annotations: list = None,
        output_path: Path = None,
        sequences: dict = None,
        cached_data: pd.DataFrame = None,
        sources_to_fetch: dict = None,
    ):
        """
        Initialize annotation manager.

        Args:
            headers: List of protein identifiers/accessions
            annotations: List of annotations to extract (None = use defaults)
            output_path: Path to save output file (None = return DataFrame only)
            sequences: Dictionary mapping identifiers to sequences (for InterPro)
            cached_data: Previously cached DataFrame with annotations
            sources_to_fetch: Dict indicating which sources to fetch (uniprot, taxonomy, interpro)
        """
        self.headers = headers
        self.output_path = output_path
        self.sequences = sequences
        self.cached_data = cached_data
        # Initialize configuration first so we can derive sources_to_fetch
        self.config = AnnotationConfiguration(annotations)
        self.user_annotations = self.config.user_annotations

        # Derive which sources to fetch from the requested annotations,
        # unless the caller explicitly specified sources_to_fetch
        if sources_to_fetch is not None:
            self.sources_to_fetch = sources_to_fetch
        else:
            self.sources_to_fetch = {
                "uniprot": True,  # Always needed (identifiers, organism_id)
                "taxonomy": self.config.taxonomy_annotations is not None,
                "interpro": self.config.interpro_annotations is not None,
                "ted": self.config.ted_annotations is not None,
                "biocentral": self.config.biocentral_annotations is not None,
            }

        # Initialize components
        self.transformer = AnnotationTransformer()
        self.merger = AnnotationMerger()
        self.writer = AnnotationWriter(transformer=self.transformer)

    def to_pd(self) -> pd.DataFrame:
        """
        Main workflow: fetch → merge → transform → output.

        Returns:
            DataFrame with requested annotations
        """
        # Track which annotation sources failed
        failed_sources = []

        # Extract cached annotations by source if available
        cached_uniprot = (
            self._extract_cached_source(UNIPROT_ANNOTATIONS)
            if self.cached_data is not None and not self.sources_to_fetch["uniprot"]
            else None
        )
        cached_taxonomy = (
            self._extract_cached_taxonomy(TAXONOMY_ANNOTATIONS)
            if self.cached_data is not None and not self.sources_to_fetch["taxonomy"]
            else None
        )
        cached_interpro = (
            self._extract_cached_source(INTERPRO_ANNOTATIONS)
            if self.cached_data is not None and not self.sources_to_fetch["interpro"]
            else None
        )
        cached_ted = (
            self._extract_cached_source(TED_ANNOTATIONS)
            if self.cached_data is not None and not self.sources_to_fetch.get("ted")
            else None
        )
        cached_biocentral = (
            self._extract_cached_source(BIOCENTRAL_ANNOTATIONS)
            if self.cached_data is not None
            and not self.sources_to_fetch.get("biocentral")
            else None
        )

        # 1. Conditionally fetch based on sources_to_fetch
        uniprot_annotations = (
            self._fetch_uniprot(failed_sources)
            if self.sources_to_fetch["uniprot"]
            else cached_uniprot
        )
        taxonomy_annotations = (
            self._fetch_taxonomy(uniprot_annotations, failed_sources)
            if self.sources_to_fetch["taxonomy"]
            else cached_taxonomy
        )
        interpro_annotations = (
            self._fetch_interpro(uniprot_annotations, failed_sources)
            if self.sources_to_fetch["interpro"]
            else cached_interpro
        )
        ted_annotations = (
            self._fetch_ted(failed_sources)
            if self.sources_to_fetch.get("ted")
            else cached_ted
        )
        biocentral_annotations = (
            self._fetch_biocentral(uniprot_annotations, failed_sources)
            if self.sources_to_fetch.get("biocentral")
            else cached_biocentral
        )

        # Report failed sources
        if failed_sources:
            logger.warning(
                f"Could not retrieve annotations from the following sources: {', '.join(failed_sources)}"
            )

        # 2. Merge annotations from all sources (including cached)
        merged_annotations = self.merger.merge(
            uniprot_annotations,
            taxonomy_annotations,
            interpro_annotations,
            ted_annotations,
            biocentral_annotations,
        )

        # 3. Apply transformations
        transformed_annotations = self.transformer.transform(merged_annotations)

        # 4. Create output
        if self.output_path:
            df = self._save_and_load(transformed_annotations)
        else:
            df = DataFormatter.to_dataframe(transformed_annotations)

        # 5. Remove internal-only columns from final output
        # (organism_id for taxonomy, sequence for InterPro)
        # Keep columns that the user explicitly requested
        internal_columns = ["organism_id", "sequence"]
        if self.user_annotations:
            internal_columns = [
                col for col in internal_columns if col not in self.user_annotations
            ]
        columns_to_drop = [col for col in internal_columns if col in df.columns]
        if columns_to_drop:
            df = df.drop(columns=columns_to_drop)

        # 6. Filter columns if user requested specific annotations
        if self.user_annotations:
            annotations_to_keep = [
                ann for ann in self.user_annotations if ann in df.columns
            ]
            columns_to_keep = [df.columns[0]] + annotations_to_keep
            return df[columns_to_keep]

        return df

    def _fetch_uniprot(self, failed_sources: list) -> list[ProteinAnnotations]:
        """Fetch UniProt annotations."""
        try:
            retriever = UniProtRetriever(
                headers=self.headers,
                annotations=self.config.uniprot_annotations,
            )
            return retriever.fetch_annotations()
        except Exception as e:
            failed_sources.append(f"UniProt ({str(e)})")
            logger.warning(f"Failed to retrieve UniProt annotations: {e}")
            # Create minimal annotation set with just identifiers
            return [
                ProteinAnnotations(identifier=header, annotations={"organism_id": ""})
                for header in self.headers
            ]

    def _fetch_taxonomy(
        self, uniprot_annotations: list[ProteinAnnotations], failed_sources: list
    ) -> dict:
        """Fetch taxonomy annotations if requested."""
        if not self.config.taxonomy_annotations:
            return {}

        try:
            # Extract unique taxonomy IDs
            taxon_counts = self._get_taxon_counts(uniprot_annotations)
            unique_taxons = list(taxon_counts.keys())

            if not unique_taxons:
                return {}

            retriever = TaxonomyRetriever(
                taxon_ids=unique_taxons, annotations=self.config.taxonomy_annotations
            )
            return retriever.fetch_annotations()
        except Exception as e:
            failed_sources.append(f"Taxonomy ({str(e)})")
            logger.warning(f"Failed to retrieve Taxonomy annotations: {e}")
            return {}

    def _fetch_interpro(
        self, uniprot_annotations: list[ProteinAnnotations], failed_sources: list
    ) -> list[ProteinAnnotations]:
        """Fetch InterPro annotations if requested."""
        if not self.config.interpro_annotations:
            return []

        try:
            # Merge: local sequences (from FASTA, priority) + UniProt (fallback)
            sequences = dict(self.sequences) if self.sequences else {}
            for protein in uniprot_annotations:
                seq = protein.annotations.get("sequence", "")
                if seq and protein.identifier not in sequences:
                    sequences[protein.identifier] = seq

            retriever = InterProRetriever(
                headers=self.headers,
                annotations=self.config.interpro_annotations,
                sequences=self.sequences,
            )
            return retriever.fetch_annotations()
        except Exception as e:
            failed_sources.append(f"InterPro ({str(e)})")
            logger.warning(f"Failed to retrieve InterPro annotations: {e}")
            return []

    def _fetch_biocentral(
        self, uniprot_annotations: list[ProteinAnnotations], failed_sources: list
    ) -> list[ProteinAnnotations]:
        """Fetch Biocentral prediction annotations if requested."""
        if not self.config.biocentral_annotations:
            return []

        try:
            # Merge: local sequences (from FASTA, priority) + UniProt (fallback)
            sequences = dict(self.sequences) if self.sequences else {}
            for protein in uniprot_annotations:
                seq = protein.annotations.get("sequence", "")
                if seq and protein.identifier not in sequences:
                    sequences[protein.identifier] = seq

            retriever = BiocentralPredictionRetriever(
                headers=self.headers,
                annotations=self.config.biocentral_annotations,
                sequences=sequences,
            )
            return retriever.fetch_annotations()
        except Exception as e:
            failed_sources.append(f"Biocentral ({str(e)})")
            logger.warning(f"Failed to retrieve Biocentral predictions: {e}")
            return []

    def _fetch_ted(self, failed_sources: list) -> list[ProteinAnnotations]:
        """Fetch TED domain annotations if requested."""
        if not self.config.ted_annotations:
            return []

        try:
            retriever = TedRetriever(
                headers=self.headers,
                annotations=self.config.ted_annotations,
            )
            return retriever.fetch_annotations()
        except Exception as e:
            failed_sources.append(f"TED ({str(e)})")
            logger.warning(f"Failed to retrieve TED annotations: {e}")
            return []

    def _save_and_load(self, proteins: list[ProteinAnnotations]) -> pd.DataFrame:
        """Save to file and load back."""
        self.writer.write_parquet(
            proteins, self.output_path, apply_transforms=False
        )  # Already transformed
        return pd.read_parquet(self.output_path)

    @staticmethod
    def _get_taxon_counts(fetched_uniprot: list[ProteinAnnotations]) -> dict:
        """Returns a dictionary with organism IDs as keys and their occurrence counts as values."""
        id_counts = {}

        for protein in fetched_uniprot:
            organism_id = protein.annotations.get("organism_id")
            if organism_id:
                try:
                    org_id = int(organism_id)
                    id_counts[org_id] = id_counts.get(org_id, 0) + 1
                except ValueError:
                    pass

        return id_counts

    def _extract_cached_source(
        self, source_annotations: list[str]
    ) -> list[ProteinAnnotations]:
        """
        Extract cached annotations for a specific source (UniProt or InterPro).

        Args:
            source_annotations: List of annotation names from this source

        Returns:
            List of ProteinAnnotations with cached data for this source
        """
        if self.cached_data is None:
            return []

        # Find available annotations from this source in cache
        available = [f for f in source_annotations if f in self.cached_data.columns]
        if not available:
            return []

        # Convert DataFrame to ProteinAnnotations format
        result = []
        identifier_col = self.cached_data.columns[0]  # First column is identifier

        for _, row in self.cached_data.iterrows():
            annotations_dict = {}
            for annotation in available:
                annotations_dict[annotation] = row[annotation]

            result.append(
                ProteinAnnotations(
                    identifier=row[identifier_col], annotations=annotations_dict
                )
            )

        return result

    def _extract_cached_taxonomy(self, taxonomy_annotations: list[str]) -> dict:
        """
        Extract cached taxonomy annotations.

        Args:
            taxonomy_annotations: List of taxonomy annotation names

        Returns:
            Dict mapping organism_id to taxonomy annotations (same format as TaxonomyRetriever)
        """
        if self.cached_data is None or "organism_id" not in self.cached_data.columns:
            return {}

        # Find available taxonomy annotations in cache
        available = [f for f in taxonomy_annotations if f in self.cached_data.columns]
        if not available:
            return {}

        # Convert to taxonomy format: {organism_id: {"annotations": {annotation: value}}}
        taxonomy_dict = {}

        # Group by organism_id
        for _, row in self.cached_data.iterrows():
            organism_id = row["organism_id"]
            if pd.isna(organism_id) or organism_id == "":
                continue

            try:
                org_id = int(organism_id)
                if org_id not in taxonomy_dict:
                    annotations_dict = {}
                    for annotation in available:
                        annotations_dict[annotation] = row[annotation]
                    taxonomy_dict[org_id] = {"annotations": annotations_dict}
            except (ValueError, TypeError):
                pass

        return taxonomy_dict
