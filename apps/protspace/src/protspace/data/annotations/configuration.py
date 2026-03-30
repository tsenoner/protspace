"""
Annotation configuration and validation.

This module handles annotation selection, validation, and source splitting.
"""

import logging

from protspace.data.annotations.retrievers.biocentral_retriever import (
    BIOCENTRAL_ANNOTATIONS,
)
from protspace.data.annotations.retrievers.interpro_retriever import (
    INTERPRO_ANNOTATIONS,
)
from protspace.data.annotations.retrievers.taxonomy_retriever import (
    TAXONOMY_ANNOTATIONS,
)
from protspace.data.annotations.retrievers.ted_retriever import (
    TED_ANNOTATIONS,
)
from protspace.data.annotations.retrievers.uniprot_retriever import (
    UNIPROT_ANNOTATIONS,
)

logger = logging.getLogger(__name__)

# Constants
ALL_ANNOTATIONS = (
    UNIPROT_ANNOTATIONS
    + TAXONOMY_ANNOTATIONS
    + INTERPRO_ANNOTATIONS
    + TED_ANNOTATIONS
    + BIOCENTRAL_ANNOTATIONS
)
ALWAYS_INCLUDED_ANNOTATIONS = ["gene_name", "protein_name", "uniprot_kb_id"]
NEEDED_UNIPROT_ANNOTATIONS = ["accession", "organism_id"]

# User-facing UniProt annotations (excludes internal: sequence, organism_id)
_UNIPROT_USER_ANNOTATIONS = [
    "annotation_score",
    "cc_subcellular_location",
    "ec",
    "fragment",
    "go_bp",
    "go_cc",
    "go_mf",
    "keyword",
    "length",
    "protein_existence",
    "protein_families",
    "reviewed",
    "xref_pdb",
    # gene_name, protein_name, uniprot_kb_id added via ALWAYS_INCLUDED
]

ANNOTATION_GROUPS = {
    "default": [
        "ec",
        "keyword",
        "length",
        "protein_families",
        "reviewed",
    ],
    "uniprot": _UNIPROT_USER_ANNOTATIONS,
    "interpro": INTERPRO_ANNOTATIONS,
    "taxonomy": TAXONOMY_ANNOTATIONS,
    "ted": TED_ANNOTATIONS,
    "biocentral": BIOCENTRAL_ANNOTATIONS,
    "all": _UNIPROT_USER_ANNOTATIONS
    + TAXONOMY_ANNOTATIONS
    + INTERPRO_ANNOTATIONS
    + TED_ANNOTATIONS
    + BIOCENTRAL_ANNOTATIONS,
}


def expand_annotation_groups(annotations: list[str]) -> list[str]:
    """Replace group names with their member annotations.

    Expands group preset names (default, all, uniprot, interpro, taxonomy)
    into their individual annotation names. Individual annotation names are
    passed through unchanged. Deduplicates while preserving order.

    Args:
        annotations: List of annotation names and/or group names

    Returns:
        List of individual annotation names with groups expanded and duplicates removed
    """
    expanded = []
    seen = set()
    for name in annotations:
        members = ANNOTATION_GROUPS.get(name, [name])
        for member in members:
            if member not in seen:
                seen.add(member)
                expanded.append(member)
    return expanded


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
            self.ted_annotations,
            self.biocentral_annotations,
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
            "ted": annotations & set(TED_ANNOTATIONS),
            "biocentral": annotations & set(BIOCENTRAL_ANNOTATIONS),
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
            "ted": len(categorized["ted"]) > 0,
            "biocentral": len(categorized["biocentral"]) > 0,
        }

        # Handle dependencies: taxonomy needs organism_id from UniProt
        if sources_needed["taxonomy"] and "organism_id" not in cached_annotations:
            sources_needed["uniprot"] = True

        # Handle dependencies: interpro needs sequence from UniProt
        if sources_needed["interpro"] and "sequence" not in cached_annotations:
            sources_needed["uniprot"] = True

        return sources_needed

    def _validate(self, user_annotations: list[str] | None) -> list[str]:
        """
        Validate requested annotations against available annotations.

        Args:
            user_annotations: List of requested annotation names (None = use default group)

        Returns:
            Validated list of annotations

        Raises:
            ValueError: If any requested annotation is not available
        """
        if user_annotations is None:
            user_annotations = ["default"]

        user_annotations = expand_annotation_groups(user_annotations)

        all_annotations = ALL_ANNOTATIONS
        normalized_annotations = []

        for annotation in user_annotations + ALWAYS_INCLUDED_ANNOTATIONS:
            if annotation not in all_annotations:
                from difflib import get_close_matches

                candidates = list(ANNOTATION_GROUPS.keys()) + all_annotations
                suggestions = get_close_matches(annotation, candidates, n=3, cutoff=0.5)
                hint = (
                    f" Did you mean: {', '.join(suggestions)}?" if suggestions else ""
                )
                groups = ", ".join(sorted(ANNOTATION_GROUPS.keys()))
                raise ValueError(
                    f"Unknown annotation '{annotation}'.{hint}\n"
                    f"  Groups: {groups}\n"
                    f"  See https://github.com/tsenoner/protspace/blob/main/docs/annotations.md"
                )
            if annotation not in normalized_annotations:
                normalized_annotations.append(annotation)

        return normalized_annotations

    def _split_by_source(
        self,
    ) -> tuple[
        list[str],
        list[str] | None,
        list[str] | None,
        list[str] | None,
        list[str] | None,
    ]:
        """Split annotations into source-specific lists.

        Returns:
            Tuple of (uniprot, taxonomy, interpro, ted, biocentral) annotations
        """
        uniprot_annotations = [
            a for a in self.user_annotations if a in UNIPROT_ANNOTATIONS
        ]
        taxonomy_annotations = [
            a for a in self.user_annotations if a in TAXONOMY_ANNOTATIONS
        ]
        interpro_annotations = [
            a for a in self.user_annotations if a in INTERPRO_ANNOTATIONS
        ]
        ted_annotations = [a for a in self.user_annotations if a in TED_ANNOTATIONS]
        biocentral_annotations = [
            a for a in self.user_annotations if a in BIOCENTRAL_ANNOTATIONS
        ]

        # Add required annotations (accession, organism_id) and sequence if needed
        # Biocentral predictions also need sequences
        needs_sequence = bool(interpro_annotations or biocentral_annotations)
        uniprot_annotations = self._add_required_annotations(
            uniprot_annotations, interpro_annotations if needs_sequence else None
        )

        return (
            uniprot_annotations,
            taxonomy_annotations or None,
            interpro_annotations or None,
            ted_annotations or None,
            biocentral_annotations or None,
        )

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
