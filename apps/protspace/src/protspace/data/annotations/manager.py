"""
Protein annotation extraction manager.

This module provides the main orchestrator for annotation extraction workflow.
"""

import logging
from pathlib import Path

import pandas as pd
import pyarrow.parquet as pq

from protspace.data.annotations.configuration import (
    INTERNAL_ANNOTATIONS,
    SOURCE_ANNOTATIONS,
    SOURCE_CACHE_DEPENDENTS,
    TAXONOMY_LOOKUP_ANNOTATION,
    AnnotationConfiguration,
)
from protspace.data.annotations.encoding import annotation_cache_version_attrs
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
from protspace.data.io.fasta import count_residues
from protspace.data.io.formatters import DataFormatter
from protspace.data.io.writers import AnnotationWriter

logger = logging.getLogger(__name__)


def resolve_fasta_sequence_length(
    identifier: str,
    length: str,
    sequences: dict[str, str],
) -> str:
    """Return a FASTA-derived residue count, or *length* if none can be derived.

    Callers filter out non-empty lengths first: a UniProt length always wins.
    A sequence made up entirely of ``*``/``-`` markers has no residues, so it
    yields no usable length either and *length* is returned unchanged.
    """
    sequence = sequences.get(identifier)
    if not sequence:
        return length
    residues = count_residues(sequence)
    return str(residues) if residues > 0 else length


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
        protect_cached_columns: bool = True,
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
            protect_cached_columns: Leave an existing cache alone rather than
                replacing its columns with fewer, when a source did not finish.
                On by default: a source that failed emits empty values that
                cannot be told apart from a real absence, and values already
                cached were written by a run where that source completed. An
                explicit refetch turns this off, because there the cached values
                are what the user is trying to replace.
        """
        self.headers = headers
        self.output_path = output_path
        self.sequences = sequences
        self.cached_data = cached_data
        self._protect_cached_columns = protect_cached_columns
        # Sources whose retrieval did not complete this run. Their columns are
        # all-empty placeholders, indistinguishable from real absences, so they
        # must not reach the cache.
        self.incomplete_sources: set[str] = set()
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

    @property
    def uniprot_fetch_failed(self) -> bool:
        """Whether the UniProt retrieval lost data this run."""
        return "uniprot" in self.incomplete_sources

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
        uniprot_annotations = self._fill_missing_fasta_lengths(uniprot_annotations)
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
        df = self._write_cache_and_frame(transformed_annotations)

        # 5. Remove internal-only columns from final output
        # (organism_id for taxonomy, sequence for InterPro)
        # Keep columns that the user explicitly requested
        internal_columns = INTERNAL_ANNOTATIONS
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

    def _uncacheable_sources(self) -> set[str]:
        """Sources that must stay out of the cache this run.

        A source that did not finish, plus every source whose cached columns are
        read back through it: taxonomy is looked up by UniProt's ``organism_id``,
        so caching taxonomy without it leaves a cache that reads as complete and
        resolves to nothing.
        """
        sources = set(self.incomplete_sources)
        for source in self.incomplete_sources:
            sources |= SOURCE_CACHE_DEPENDENTS.get(source, set())
        return sources

    def _incomplete_columns(self) -> set[str]:
        """Columns that must not reach the cache, by source."""
        return set().union(
            *(SOURCE_ANNOTATIONS[source] for source in self._uncacheable_sources())
        )

    def _cached_columns(self) -> set[str]:
        """Column names already on disk, read from the parquet footer only."""
        if not self.output_path.exists():
            return set()
        return set(pq.read_schema(self.output_path).names)

    def _write_cache_and_frame(
        self, proteins: list[ProteinAnnotations]
    ) -> pd.DataFrame:
        """Return the run's annotations, caching only the sources that completed.

        A source that did not finish emits all-empty values indistinguishable
        from a real absence, so caching them would make the next run's
        column-based completeness check reuse the gaps forever. Columns from
        sources that *did* finish are still worth caching, so only the
        incomplete ones are dropped (plus the sources that depend on them --
        see :meth:`_uncacheable_sources`).

        Dropping shrinks the cache, which is the right trade when the columns
        being dropped are untrustworthy but the wrong one when the cache already
        holds good values for them. So a cache that already has those columns is
        left alone -- unless this run was an explicit refetch, where the user has
        said the cached values are the problem.
        """
        if not self.output_path:
            return DataFormatter.to_dataframe(proteins)

        drop = self._incomplete_columns()
        df = DataFormatter.to_dataframe(proteins)
        if not drop:
            self._write_cache(df)
            return df

        incomplete = ", ".join(sorted(self.incomplete_sources))
        remaining = set(df.columns) - drop - {"identifier"}
        # An explicit refetch skips both guards: leaving the cache alone there
        # would strand exactly the values the user asked to replace, and writing
        # without the failed source's columns is what removes them, so the next
        # run fetches that source instead of reading stale ones.
        shadowed = bool(self._cached_columns() & drop)
        if self._protect_cached_columns and (not remaining or shadowed):
            reason = (
                "the cache already holds those columns"
                if shadowed
                else "nothing else was retrieved either"
            )
            logger.warning(
                "Not caching annotations at %s: %s could not be fully retrieved, "
                "and %s. This run's annotations are still returned. Use "
                "--refetch annotations to rewrite the cache regardless.",
                self.output_path,
                incomplete,
                reason,
            )
            return df

        logger.warning(
            "Caching annotations at %s without %s: that source could not be "
            "fully retrieved, so its columns are left out and the next run "
            "fetches it again instead of reusing empty values.",
            self.output_path,
            incomplete,
        )
        self._write_cache(df.drop(columns=[c for c in df.columns if c in drop]))
        return df

    def _write_cache(self, df: pd.DataFrame) -> None:
        """Persist *df* as the annotation cache, stamped with the current semantics."""
        df = df.copy()
        df.attrs.update(annotation_cache_version_attrs())
        df.to_parquet(self.output_path, index=False)

    def _fill_missing_fasta_lengths(
        self, proteins: list[ProteinAnnotations]
    ) -> list[ProteinAnnotations]:
        """Fill empty sequence lengths from matching local FASTA sequences.

        Rows that need no fallback are returned untouched; a filled row is
        returned as a copy so the fallback can never leak into a retriever's or
        the cache DataFrame's own dicts.
        """
        if not proteins or not self.sequences:
            return proteins

        filled = False
        key_missing = False
        result = []
        for protein in proteins:
            annotations = protein.annotations
            length = annotations.get("length", "")
            if "length" not in annotations:
                key_missing = True
            if length:
                result.append(protein)
                continue
            resolved = resolve_fasta_sequence_length(
                protein.identifier, length, self.sequences
            )
            if not resolved:
                result.append(protein)
                continue
            filled = True
            result.append(
                protein._replace(annotations={**annotations, "length": resolved})
            )

        if not filled:
            return proteins
        if not key_missing:
            return result

        # Downstream formatters derive their columns from the first row, so a
        # "length" key added to only some rows would be dropped (or silently
        # blanked) depending on row order. Keep the key on every row.
        return [
            protein
            if "length" in protein.annotations
            else protein._replace(annotations={**protein.annotations, "length": ""})
            for protein in result
        ]

    def _fetch_uniprot(self, failed_sources: list) -> list[ProteinAnnotations]:
        """Fetch UniProt annotations."""
        try:
            retriever = UniProtRetriever(
                headers=self.headers,
                annotations=self.config.uniprot_annotations,
            )
            annotations = retriever.fetch_annotations()
        except Exception as e:
            self.incomplete_sources.add("uniprot")
            failed_sources.append(f"UniProt ({str(e)})")
            logger.warning(f"Failed to retrieve UniProt annotations: {e}")
            return [
                ProteinAnnotations(
                    identifier=header, annotations={TAXONOMY_LOOKUP_ANNOTATION: ""}
                )
                for header in self.headers
            ]

        # Read outside the try: a problem reading the failure counter must not be
        # swallowed as "UniProt is unreachable" and discard a successful fetch.
        if retriever.failed_batch_count > 0:
            self.incomplete_sources.add("uniprot")
        return annotations

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
            annotations = retriever.fetch_annotations()
            if retriever.failed_batch_count:
                self.incomplete_sources.add("taxonomy")
            return annotations
        except Exception as e:
            self.incomplete_sources.add("taxonomy")
            failed_sources.append(f"Taxonomy ({str(e)})")
            logger.warning(f"Failed to retrieve Taxonomy annotations: {e}")
            return {}

    def _build_sequence_map(
        self, uniprot_annotations: list[ProteinAnnotations]
    ) -> dict[str, str]:
        """Build a mapping from headers to sequences.

        Merges local sequences (from FASTA, priority) with UniProt results (fallback).
        """
        sequences = dict(self.sequences) if self.sequences else {}
        for protein in uniprot_annotations:
            seq = protein.annotations.get("sequence", "")
            if seq and protein.identifier not in sequences:
                sequences[protein.identifier] = seq
        return sequences

    def _fetch_interpro(
        self, uniprot_annotations: list[ProteinAnnotations], failed_sources: list
    ) -> list[ProteinAnnotations]:
        """Fetch InterPro annotations if requested."""
        if not self.config.interpro_annotations:
            return []

        try:
            sequences = self._build_sequence_map(uniprot_annotations)

            retriever = InterProRetriever(
                headers=self.headers,
                annotations=self.config.interpro_annotations,
                sequences=sequences,
            )
            annotations = retriever.fetch_annotations()
            if retriever.failed_batch_count:
                self.incomplete_sources.add("interpro")
            return annotations
        except Exception as e:
            self.incomplete_sources.add("interpro")
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
            sequences = self._build_sequence_map(uniprot_annotations)

            retriever = BiocentralPredictionRetriever(
                headers=self.headers,
                annotations=self.config.biocentral_annotations,
                sequences=sequences,
            )
            annotations = retriever.fetch_annotations()
            if retriever.prediction_failed:
                self.incomplete_sources.add("biocentral")
            return annotations
        except Exception as e:
            self.incomplete_sources.add("biocentral")
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
            annotations = retriever.fetch_annotations()
            if retriever.failed_lookup_count:
                self.incomplete_sources.add("ted")
            return annotations
        except Exception as e:
            self.incomplete_sources.add("ted")
            failed_sources.append(f"TED ({str(e)})")
            logger.warning(f"Failed to retrieve TED annotations: {e}")
            return []

    @staticmethod
    def _get_taxon_counts(fetched_uniprot: list[ProteinAnnotations]) -> dict:
        """Returns a dictionary with organism IDs as keys and their occurrence counts as values."""
        id_counts = {}

        for protein in fetched_uniprot:
            organism_id = protein.annotations.get(TAXONOMY_LOOKUP_ANNOTATION)
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
        if (
            self.cached_data is None
            or TAXONOMY_LOOKUP_ANNOTATION not in self.cached_data.columns
        ):
            return {}

        # Find available taxonomy annotations in cache
        available = [f for f in taxonomy_annotations if f in self.cached_data.columns]
        if not available:
            return {}

        # Convert to taxonomy format: {organism_id: {"annotations": {annotation: value}}}
        taxonomy_dict = {}

        # Group by organism_id
        for _, row in self.cached_data.iterrows():
            organism_id = row[TAXONOMY_LOOKUP_ANNOTATION]
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
