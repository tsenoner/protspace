"""Unified reduction pipeline — replaces LocalProcessor and UniProtQueryProcessor.

Composes: loaders → annotation fetch → dimensionality reduction → output.
"""

import logging
import shutil
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Any

import pandas as pd

from protspace.data.loaders import EmbeddingSet
from protspace.data.loaders.embedding_set import format_projection_name
from protspace.data.processors.base_processor import BaseProcessor
from protspace.utils import get_reducers
from protspace.utils.constants import MDS_NAME

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class ReducerParams:
    """User-configurable dimensionality reduction parameters."""

    metric: str = "euclidean"
    random_state: int = 42
    n_neighbors: int = 25
    min_dist: float = 0.1
    perplexity: float = 30.0
    learning_rate: float = 200.0
    mn_ratio: float = 0.5
    fp_ratio: float = 2.0
    n_init: int = 4
    max_iter: int = 300
    eps: float = 1e-6


@dataclass
class PipelineConfig:
    """Configuration for a ReductionPipeline run."""

    methods: list[str]
    output_path: Path
    bundled: bool = True
    keep_tmp: bool = False
    no_scores: bool = False
    force_refetch: bool = False
    annotations: list[str] | None = None
    intermediate_dir: Path | None = None
    reducer_params: ReducerParams = field(default_factory=ReducerParams)


def parse_method_spec(method_spec: str) -> tuple[str, int]:
    """Parse 'pca2' into ('pca', 2)."""
    method = "".join(filter(str.isalpha, method_spec))
    dims = int("".join(filter(str.isdigit, method_spec)))
    return method, dims


class ReductionPipeline:
    """Unified pipeline: load → annotate → reduce → output.

    This class orchestrates the full data preparation workflow, replacing
    both LocalProcessor and UniProtQueryProcessor with a single composable
    pipeline that works with any input source via EmbeddingSet.
    """

    def __init__(self, config: PipelineConfig):
        self.config = config
        reducer_dict = asdict(config.reducer_params)
        self.base = BaseProcessor(reducer_dict, get_reducers())

    def run(self, embedding_sets: list[EmbeddingSet]) -> Path:
        """Execute the full pipeline.

        Args:
            embedding_sets: One or more EmbeddingSets to process.

        Returns:
            Path to the output file/directory.
        """
        if not embedding_sets:
            raise ValueError("At least one EmbeddingSet is required.")

        # Validate all sets share the same headers (or compute intersection)
        all_headers = self._validate_headers(embedding_sets)

        # Fetch annotations (pass embedding sets so FASTA sequences can be reused)
        metadata = self._fetch_annotations(all_headers, embedding_sets)

        # Apply score stripping
        if self.config.no_scores:
            from protspace.data.annotations.scores import strip_scores_from_df

            metadata = strip_scores_from_df(metadata)

        # Build full metadata with all headers
        full_metadata = pd.DataFrame({"identifier": all_headers})
        if len(metadata.columns) > 1:
            metadata = metadata.astype(str)
            id_col = metadata.columns[0]
            if id_col != "identifier":
                metadata = metadata.rename(columns={id_col: "identifier"})
            full_metadata = full_metadata.merge(
                metadata.drop_duplicates("identifier"),
                on="identifier",
                how="left",
            )
        metadata = full_metadata

        # DR: each embedding set × each method
        all_reductions = self._run_reductions(embedding_sets)

        # Create and save output
        output = self.base.create_output(metadata, all_reductions, all_headers)
        self.base.save_output(
            output, self.config.output_path, bundled=self.config.bundled
        )

        logger.info(
            f"Processed {len(all_headers)} proteins, "
            f"{len(embedding_sets)} embedding(s), "
            f"{len(all_reductions)} projection(s)"
        )
        logger.info(f"Output saved to: {self.config.output_path}")

        # Clean up intermediate dir if not keeping
        if (
            not self.config.keep_tmp
            and self.config.intermediate_dir
            and self.config.intermediate_dir.exists()
        ):
            shutil.rmtree(self.config.intermediate_dir)

        return self.config.output_path

    @staticmethod
    def _extract_sequences(embedding_sets: list[EmbeddingSet]) -> dict[str, str]:
        """Extract protein sequences from FASTA files referenced by embedding sets."""
        sequences = {}
        for emb_set in embedding_sets:
            if emb_set.fasta_path and Path(emb_set.fasta_path).exists():
                from protspace.data.io.fasta import parse_fasta
                from protspace.data.loaders.h5 import parse_identifier

                raw = parse_fasta(Path(emb_set.fasta_path))
                sequences.update({parse_identifier(h): s for h, s in raw.items()})
        return sequences

    def _validate_headers(self, embedding_sets: list[EmbeddingSet]) -> list[str]:
        """Ensure all embedding sets share the same identifiers.

        If they differ, compute intersection and warn.
        """
        if len(embedding_sets) == 1:
            return embedding_sets[0].headers

        sets = [set(es.headers) for es in embedding_sets]
        common = sets[0]
        for s in sets[1:]:
            common = common & s

        if not common:
            raise ValueError(
                "No common protein identifiers found across embedding sets."
            )

        # Check if any set lost identifiers
        for es in embedding_sets:
            diff = set(es.headers) - common
            if diff:
                logger.warning(
                    f"Embedding '{es.name}': dropping {len(diff)} proteins "
                    f"not present in all sets."
                )

        # Use the order from the first set, filtered to common
        common_headers = [h for h in embedding_sets[0].headers if h in common]

        # Re-order data in each set to match common_headers
        for es in embedding_sets:
            if es.headers != common_headers:
                idx_map = {h: i for i, h in enumerate(es.headers)}
                indices = [idx_map[h] for h in common_headers]
                es.data = es.data[indices]
                es.headers = common_headers

        return common_headers

    def _fetch_annotations(
        self, headers: list[str], embedding_sets: list[EmbeddingSet] = None
    ) -> pd.DataFrame:
        """Fetch annotations from APIs with incremental caching support."""
        from protspace.data.annotations.manager import ProteinAnnotationManager

        # Extract sequences from FASTA files (if available) to avoid re-fetching
        sequences = self._extract_sequences(embedding_sets) if embedding_sets else {}

        annotation_names, csv_path = self._resolve_annotation_names()

        # Load user CSV if provided
        csv_df = None
        if csv_path:
            logger.info(f"Loading custom annotations from: {csv_path}")
            csv_df = pd.read_csv(
                csv_path,
                sep="\t" if csv_path.endswith(".tsv") else ",",
            )
            id_col = csv_df.columns[0]
            if id_col != "identifier":
                csv_df = csv_df.rename(columns={id_col: "identifier"})

        if annotation_names:
            from protspace.data.annotations.configuration import (
                AnnotationConfiguration,
            )

            annotations_list = AnnotationConfiguration(
                annotation_names
            ).user_annotations
        else:
            annotations_list = None

        # CSV-only: no API annotations requested
        if annotations_list is None and csv_df is not None:
            return csv_df

        keep_tmp = self.config.keep_tmp
        intermediate_dir = self.config.intermediate_dir
        force_refetch = self.config.force_refetch

        if keep_tmp and intermediate_dir:
            intermediate_dir.mkdir(parents=True, exist_ok=True)
            cache_path = intermediate_dir / "all_annotations.parquet"

            if cache_path.exists():
                cached_df = pd.read_parquet(cache_path)
                cached_annotations = set(cached_df.columns) - {"identifier"}

                if annotations_list is None:
                    from protspace.data.annotations.configuration import (
                        ANNOTATION_GROUPS,
                    )

                    required = set(ANNOTATION_GROUPS["default"])
                else:
                    required = set(annotations_list)

                missing = required - cached_annotations

                if not missing and not force_refetch:
                    logger.info(f"All annotations found in cache: {cache_path}")
                    if annotations_list:
                        cols = ["identifier"] + [
                            f for f in annotations_list if f in cached_df.columns
                        ]
                        api_df = cached_df[cols]
                    else:
                        api_df = cached_df
                    return self._merge_csv(api_df, csv_df)

                from protspace.data.annotations.configuration import (
                    AnnotationConfiguration,
                )

                sources = AnnotationConfiguration.determine_sources_to_fetch(
                    cached_annotations, required
                )

                if force_refetch:
                    logger.info("--force-refetch: re-fetching all annotations")
                    sources = {"uniprot": True, "taxonomy": True, "interpro": True}
                    cached_df = None
                else:
                    logger.info(f"Missing annotations: {missing}")

                api_df = ProteinAnnotationManager(
                    headers=headers,
                    annotations=annotations_list,
                    output_path=cache_path,
                    sequences=sequences,
                    cached_data=cached_df,
                    sources_to_fetch=sources,
                ).to_pd()
                return self._merge_csv(api_df, csv_df)
            else:
                api_df = ProteinAnnotationManager(
                    headers=headers,
                    annotations=annotations_list,
                    output_path=cache_path,
                    sequences=sequences,
                ).to_pd()
                return self._merge_csv(api_df, csv_df)
        else:
            api_df = ProteinAnnotationManager(
                headers=headers,
                annotations=annotations_list,
                output_path=None,
                sequences=sequences,
            ).to_pd()
            return self._merge_csv(api_df, csv_df)

    def _resolve_annotation_names(self) -> tuple[list[str], str | None]:
        """Parse annotation arguments into annotation names and optional CSV path.

        Returns:
            Tuple of (annotation_names, csv_path_or_None)
        """
        if not self.config.annotations:
            return [], None

        names = []
        csv_path = None
        for item in self.config.annotations:
            item = item.strip()
            if not item:
                continue
            if item.endswith((".csv", ".tsv")):
                csv_path = item
            else:
                for part in item.split(","):
                    part = part.strip()
                    if part:
                        names.append(part)
        return names, csv_path

    @staticmethod
    def _merge_csv(api_df: pd.DataFrame, csv_df: pd.DataFrame | None) -> pd.DataFrame:
        """Merge user CSV annotations onto API annotations. CSV wins on collision."""
        if csv_df is None:
            return api_df

        merged = api_df.merge(
            csv_df.drop_duplicates("identifier"),
            on="identifier",
            how="left",
            suffixes=("_api", ""),
        )
        # Drop API-suffixed duplicates so CSV values win
        for col in list(merged.columns):
            if col.endswith("_api"):
                base = col.removesuffix("_api")
                if base in merged.columns:
                    merged = merged.drop(columns=[col])
                else:
                    merged = merged.rename(columns={col: base})
        return merged

    def _run_reductions(
        self, embedding_sets: list[EmbeddingSet]
    ) -> list[dict[str, Any]]:
        """Run dimensionality reduction on all embedding sets."""
        all_reductions = []

        for emb_set in embedding_sets:
            if emb_set.precomputed:
                # Precomputed similarity → always MDS 2, ignore user methods
                self.base.config["precomputed"] = True
                logger.info(f"Applying MDS 2 to '{emb_set.name}' (precomputed)")
                reduction = self.base.process_reduction(emb_set.data, MDS_NAME, 2)
                reduction["name"] = format_projection_name(emb_set.name, MDS_NAME, 2)
                all_reductions.append(reduction)
                self.base.config.pop("precomputed", None)
                continue

            for method_spec in self.config.methods:
                method, dims = parse_method_spec(method_spec)

                if method not in self.base.reducers:
                    logger.warning(f"Unknown method: {method}. Skipping.")
                    continue

                logger.info(f"Applying {method.upper()} {dims} to '{emb_set.name}'")
                reduction = self.base.process_reduction(emb_set.data, method, dims)

                reduction["name"] = format_projection_name(emb_set.name, method, dims)

                all_reductions.append(reduction)

        return all_reductions
