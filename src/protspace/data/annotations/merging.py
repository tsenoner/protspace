"""
Annotation merging logic.

This module handles merging annotations from multiple sources (UniProt, Taxonomy, InterPro).
"""

from collections import namedtuple

ProteinAnnotations = namedtuple("ProteinAnnotations", ["identifier", "annotations"])


class AnnotationMerger:
    """Merges annotations from multiple sources."""

    def merge(
        self,
        uniprot_annotations: list[ProteinAnnotations],
        taxonomy_annotations: dict,
        interpro_annotations: list[ProteinAnnotations] = None,
    ) -> list[ProteinAnnotations]:
        """
        Merge annotations from UniProt, Taxonomy, and InterPro sources.

        Args:
            uniprot_annotations: List of ProteinAnnotations from UniProt
            taxonomy_annotations: Dict mapping organism_id to taxonomy annotations
            interpro_annotations: List of ProteinAnnotations from InterPro (optional)

        Returns:
            List of ProteinAnnotations with merged annotations
        """
        # Create a mapping from identifier to InterPro annotations for efficient lookup
        interpro_dict = self._create_interpro_dict(interpro_annotations)

        # Process each protein
        merged_annotations = []
        for protein in uniprot_annotations:
            merged_protein = self._merge_protein(
                protein, taxonomy_annotations, interpro_dict
            )
            merged_annotations.append(merged_protein)

        return merged_annotations

    @staticmethod
    def _create_interpro_dict(
        interpro_annotations: list[ProteinAnnotations] | None,
    ) -> dict:
        """Create a dictionary mapping protein identifier to InterPro annotations."""
        if not interpro_annotations:
            return {}

        interpro_dict = {}
        for interpro_protein in interpro_annotations:
            interpro_dict[interpro_protein.identifier] = interpro_protein.annotations

        return interpro_dict

    def _merge_protein(
        self,
        protein: ProteinAnnotations,
        taxonomy_annotations: dict,
        interpro_dict: dict,
    ) -> ProteinAnnotations:
        """
        Merge all annotation sources for a single protein.

        Args:
            protein: ProteinAnnotations from UniProt
            taxonomy_annotations: Dict of taxonomy annotations
            interpro_dict: Dict of InterPro annotations

        Returns:
            ProteinAnnotations with merged annotations
        """
        # Create a copy to avoid modifying the original
        updated_annotations = protein.annotations.copy()

        # Merge taxonomy annotations
        updated_annotations = self._merge_taxonomy(
            updated_annotations,
            protein.annotations.get("organism_id"),
            taxonomy_annotations,
        )

        # Merge InterPro annotations
        updated_annotations = self._merge_interpro(
            updated_annotations, protein.identifier, interpro_dict
        )

        return ProteinAnnotations(
            identifier=protein.identifier, annotations=updated_annotations
        )

    @staticmethod
    def _merge_taxonomy(
        annotations: dict, organism_id: str, taxonomy_annotations: dict
    ) -> dict:
        """
        Merge taxonomy annotations for a protein.

        Args:
            annotations: Existing protein annotations
            organism_id: Organism ID from UniProt
            taxonomy_annotations: Dict of taxonomy annotations

        Returns:
            Updated annotations dict
        """
        if not organism_id or not taxonomy_annotations:
            return annotations

        try:
            organism_id_int = int(organism_id)
            if organism_id_int in taxonomy_annotations:
                tax_annotations = taxonomy_annotations[organism_id_int]["annotations"]

                # Add each taxonomy annotation
                for annotation_name, annotation_value in tax_annotations.items():
                    annotations[annotation_name] = annotation_value
        except (ValueError, KeyError):
            # Invalid organism_id or missing taxonomy data
            pass

        return annotations

    @staticmethod
    def _merge_interpro(
        annotations: dict, identifier: str, interpro_dict: dict
    ) -> dict:
        """
        Merge InterPro annotations for a protein.

        Args:
            annotations: Existing protein annotations
            identifier: Protein identifier
            interpro_dict: Dict of InterPro annotations

        Returns:
            Updated annotations dict
        """
        if identifier in interpro_dict:
            interpro_data = interpro_dict[identifier]

            # Add each InterPro annotation
            for annotation_name, annotation_value in interpro_data.items():
                annotations[annotation_name] = annotation_value

        return annotations
