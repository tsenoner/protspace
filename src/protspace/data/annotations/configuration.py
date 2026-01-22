"""
Annotation configuration and validation.

This module handles annotation selection, validation, and source splitting.
"""

import logging

from protspace.data.annotations.retrievers.interpro_retriever import (
    INTERPRO_ANNOTATIONS,
)
from protspace.data.annotations.retrievers.taxonomy_retriever import (
    TAXONOMY_ANNOTATIONS,
)
from protspace.data.annotations.retrievers.uniprot_retriever import (
    UNIPROT_ANNOTATIONS,
)

logger = logging.getLogger(__name__)

# Constants
DEFAULT_ANNOTATIONS = UNIPROT_ANNOTATIONS + TAXONOMY_ANNOTATIONS + INTERPRO_ANNOTATIONS
ALWAYS_INCLUDED_ANNOTATIONS = ["gene_name", "protein_name", "uniprot_kb_id"]
NEEDED_UNIPROT_ANNOTATIONS = ["accession", "organism_id"]
LENGTH_BINNING_ANNOTATIONS = ["length_fixed", "length_quantile"]


class AnnotationConfiguration:
    """Manages annotation selection, validation, and source splitting."""

    def __init__(self, user_annotations: list[str] = None):
        """
        Initialize annotation configuration.

        Args:
            user_annotations: List of annotation names requested by user (None = use defaults)
        """
        self.user_annotations = self._validate(user_annotations)
        (
            self.uniprot_annotations,
            self.taxonomy_annotations,
            self.interpro_annotations,
        ) = self._split_by_source()

    @staticmethod
    def categorize_annotations_by_source(annotations: set[str]) -> dict[str, set[str]]:
        """
        Categorize annotations by their API source.

        Args:
            annotations: Set of annotation names

        Returns:
            Dictionary mapping source names to sets of annotations from that source
        """
        return {
            "uniprot": annotations & set(UNIPROT_ANNOTATIONS),
            "taxonomy": annotations & set(TAXONOMY_ANNOTATIONS),
            "interpro": annotations & set(INTERPRO_ANNOTATIONS),
        }

    @staticmethod
    def determine_sources_to_fetch(
        cached_annotations: set[str], required_annotations: set[str]
    ) -> dict[str, bool]:
        """
        Determine which API sources need querying based on cache.

        Args:
            cached_annotations: Set of annotations already in cache
            required_annotations: Set of annotations needed for current request

        Returns:
            Dictionary mapping source names to boolean indicating if fetch is needed
        """
        missing = required_annotations - cached_annotations
        categorized = AnnotationConfiguration.categorize_annotations_by_source(missing)

        sources_needed = {
            "uniprot": len(categorized["uniprot"]) > 0,
            "taxonomy": len(categorized["taxonomy"]) > 0,
            "interpro": len(categorized["interpro"]) > 0,
        }

        # Handle dependencies: taxonomy needs organism_id from UniProt
        if sources_needed["taxonomy"] and "organism_id" not in cached_annotations:
            sources_needed["uniprot"] = True

        # Handle dependencies: interpro needs sequence from UniProt
        if sources_needed["interpro"] and "sequence" not in cached_annotations:
            sources_needed["uniprot"] = True

        return sources_needed

    def _validate(self, user_annotations: list[str]) -> list[str] | None:
        """
        Validate requested annotations against available annotations.

        Args:
            user_annotations: List of requested annotation names

        Returns:
            Validated list of annotations or None

        Raises:
            ValueError: If any requested annotation is not available
        """
        if user_annotations is None:
            return None

        all_annotations = DEFAULT_ANNOTATIONS + LENGTH_BINNING_ANNOTATIONS
        normalized_annotations = []

        for annotation in user_annotations + ALWAYS_INCLUDED_ANNOTATIONS:
            if annotation not in all_annotations:
                raise ValueError(
                    f"Annotation {annotation} is not a valid annotation. Valid annotations are: {all_annotations}"
                )
            if annotation not in normalized_annotations:
                normalized_annotations.append(annotation)

        return normalized_annotations

    def _split_by_source(self) -> tuple[list[str], list[str] | None, list[str] | None]:
        """
        Split annotations into UniProt, Taxonomy, and InterPro annotations.

        Returns:
            Tuple of (uniprot_annotations, taxonomy_annotations, interpro_annotations)
        """
        if self.user_annotations:
            return self._split_user_annotations()
        else:
            return self._get_default_annotations()

    def _split_user_annotations(
        self,
    ) -> tuple[list[str], list[str] | None, list[str] | None]:
        """Split user-requested annotations by source."""
        # Extract annotations by source
        uniprot_annotations = [
            annotation
            for annotation in self.user_annotations
            if annotation in UNIPROT_ANNOTATIONS
        ]
        taxonomy_annotations = [
            annotation
            for annotation in self.user_annotations
            if annotation in TAXONOMY_ANNOTATIONS
        ]
        interpro_annotations = [
            annotation
            for annotation in self.user_annotations
            if annotation in INTERPRO_ANNOTATIONS
        ]

        # Check if user requested length binning annotations
        user_has_length_annotations = any(
            annotation in self.user_annotations
            for annotation in LENGTH_BINNING_ANNOTATIONS
        )

        # If user requested length annotations, we need the length annotation from UniProt
        if user_has_length_annotations and "length" not in uniprot_annotations:
            uniprot_annotations.append("length")

        # Add required annotations (accession, organism_id) and sequence if needed
        uniprot_annotations = self._add_required_annotations(
            uniprot_annotations, interpro_annotations
        )

        # Return based on what's needed
        if taxonomy_annotations or interpro_annotations:
            return (
                uniprot_annotations,
                taxonomy_annotations if taxonomy_annotations else None,
                interpro_annotations if interpro_annotations else None,
            )
        else:
            return uniprot_annotations, None, None

    def _get_default_annotations(
        self,
    ) -> tuple[list[str], list[str] | None, list[str] | None]:
        """Get default annotation configuration."""
        uniprot_annotations = [
            annotation
            for annotation in DEFAULT_ANNOTATIONS
            if annotation in UNIPROT_ANNOTATIONS
        ]
        taxonomy_annotations = [
            annotation
            for annotation in DEFAULT_ANNOTATIONS
            if annotation in TAXONOMY_ANNOTATIONS
        ]
        interpro_annotations = [
            annotation
            for annotation in DEFAULT_ANNOTATIONS
            if annotation in INTERPRO_ANNOTATIONS
        ]

        uniprot_annotations = self._add_required_annotations(
            uniprot_annotations, interpro_annotations
        )

        # We have taxonomy or interpro annotations
        if taxonomy_annotations or interpro_annotations:
            return (
                uniprot_annotations,
                taxonomy_annotations if taxonomy_annotations else None,
                interpro_annotations if interpro_annotations else None,
            )

        # We have other annotations than the needed ones
        elif len(uniprot_annotations) > len(NEEDED_UNIPROT_ANNOTATIONS):
            return uniprot_annotations, None, None

        else:
            logger.info("No annotations provided, using default UniProt annotations")
            return UNIPROT_ANNOTATIONS, None, None

    def _add_required_annotations(
        self, annotations: list[str], interpro_annotations: list[str] = None
    ) -> list[str]:
        """
        Add required annotations (accession, organism_id) and sequence if needed for InterPro.

        Args:
            annotations: List of requested UniProt annotations
            interpro_annotations: List of InterPro annotations (if any)

        Returns:
            Updated list with required annotations
        """
        # Remove required annotations if already present to avoid duplicates
        filtered_annotations = [
            f for f in annotations if f not in NEEDED_UNIPROT_ANNOTATIONS
        ]

        # Always start with required annotations
        result = NEEDED_UNIPROT_ANNOTATIONS + filtered_annotations

        # Always include sequence if InterPro annotations are requested (needed for MD5 calculation)
        if interpro_annotations and "sequence" not in result:
            result.append("sequence")

        return result
