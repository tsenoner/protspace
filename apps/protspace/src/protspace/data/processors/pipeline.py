"""Unified reduction pipeline — replaces LocalProcessor and UniProtQueryProcessor.

Composes: loaders → annotation fetch → dimensionality reduction → output.
"""

import hashlib
import json
import logging
import shutil
from collections import Counter
from dataclasses import asdict, dataclass, field, fields
from pathlib import Path
from typing import Any

import numpy as np
import pandas as pd

from protspace.data.io.atomic import staged_write
from protspace.data.loaders import EmbeddingSet
from protspace.data.loaders.embedding_set import (
    format_param_suffix,
    format_projection_name,
)
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


@dataclass(frozen=True)
class MethodSpec:
    """A single DR method with its dimension count and parameter overrides."""

    method: str  # e.g. "umap"
    dims: int  # e.g. 2
    overrides: tuple[tuple[str, int | float | str], ...] = ()

    def __str__(self) -> str:
        base = f"{self.method}{self.dims}"
        if self.overrides:
            params = ";".join(f"{k}={v}" for k, v in self.overrides)
            return f"{base}:{params}"
        return base

    @property
    def overrides_dict(self) -> dict[str, int | float | str]:
        return dict(self.overrides)


@dataclass
class PipelineConfig:
    """Configuration for a ReductionPipeline run."""

    methods: list[MethodSpec]
    output_path: Path
    bundled: bool = True
    keep_tmp: bool = False
    no_scores: bool = False
    stats: bool = False
    cluster_selection: str = "elbow"  # elbow | silhouette | both (for --stats)
    stats_annotation: str = "auto"  # which annotation(s) to score (for --stats)
    refetch_stages: frozenset[str] = field(default_factory=frozenset)
    annotations: list[str] | None = None
    intermediate_dir: Path | None = None
    reducer_params: ReducerParams = field(default_factory=ReducerParams)


def _embedding_fingerprint(emb_set: EmbeddingSet) -> str:
    """Digest exactly what the reducer will be handed: identifiers and matrix.

    The embedding name says where numbers came from, not which numbers they are:
    a resumed embedding cache, a re-embedded input, a narrower intersection and a
    reordered input all keep the name. Coordinates are stored as bare rows and
    paired positionally with the current identifiers on load, so the identifier
    order belongs in the digest too -- reusing a projection across a reorder
    relabels every point.
    """
    data = np.ascontiguousarray(emb_set.data)
    digest = hashlib.sha256()
    digest.update("\0".join(emb_set.headers).encode())
    digest.update(f"{data.dtype}{data.shape}".encode())
    digest.update(memoryview(data).cast("B"))
    return digest.hexdigest()[:16]


# Valid override parameter names (from ReducerParams fields)
_VALID_OVERRIDE_KEYS = {f.name for f in fields(ReducerParams)}
# Field types for coercion
_FIELD_TYPES = {f.name: f.type for f in fields(ReducerParams)}


def _coerce_value(key: str, raw: str) -> int | float | str:
    """Coerce a string value to the appropriate type for the given parameter."""
    expected = _FIELD_TYPES.get(key)
    if expected is int:
        return int(raw)
    if expected is float:
        return float(raw)
    return raw


def parse_method_spec(method_spec: str) -> MethodSpec:
    """Parse a method spec string into a MethodSpec.

    Examples:
        'pca2'                              → MethodSpec('pca', 2)
        'umap2:n_neighbors=50;min_dist=0.1' → MethodSpec('umap', 2, overrides=...)
    """
    # Split on first ':' to separate method from overrides
    if ":" in method_spec:
        base, params_str = method_spec.split(":", 1)
    else:
        base, params_str = method_spec, ""

    method = "".join(filter(str.isalpha, base))
    dims = int("".join(filter(str.isdigit, base)))

    overrides = {}
    if params_str:
        for pair in params_str.split(";"):
            pair = pair.strip()
            if not pair:
                continue
            if "=" not in pair:
                raise ValueError(
                    f"Invalid parameter format '{pair}' in '{method_spec}'. "
                    f"Expected key=value."
                )
            key, val = pair.split("=", 1)
            key = key.strip()
            if key not in _VALID_OVERRIDE_KEYS:
                raise ValueError(
                    f"Unknown parameter '{key}' in '{method_spec}'. "
                    f"Valid parameters: {', '.join(sorted(_VALID_OVERRIDE_KEYS))}"
                )
            overrides[key] = _coerce_value(key, val.strip())

    return MethodSpec(
        method=method,
        dims=dims,
        overrides=tuple(sorted(overrides.items())),
    )


def parse_methods_arg(raw: list[str]) -> list[MethodSpec]:
    """Parse repeatable -m arguments into a deduplicated MethodSpec list.

    Each element may be comma-separated: "pca2,umap2:n_neighbors=50"
    Semicolons separate parameters within a method override.
    """
    specs: list[MethodSpec] = []
    seen: set[MethodSpec] = set()
    for item in raw:
        for part in item.split(","):
            part = part.strip()
            if not part:
                continue
            spec = parse_method_spec(part)
            if spec not in seen:
                seen.add(spec)
                specs.append(spec)
    return specs


def disambiguation_suffix(spec: MethodSpec, method_counts: Counter) -> str:
    """Return a parameter suffix for projection name disambiguation.

    When the same (method, dims) pair appears multiple times in a run AND the
    given spec carries parameter overrides, return the abbreviated parameter
    string (e.g. "n=50, d=0.1"). Otherwise return "".

    A plain spec sitting alongside an override spec returns "" — the override
    spec alone carries the disambiguating suffix, and the plain spec keeps the
    default name (e.g. "ProtT5 — UMAP 2").
    """
    if method_counts[(spec.method, spec.dims)] > 1 and spec.overrides:
        return format_param_suffix(spec.overrides_dict)
    return ""


def _run_with_overridden_config(
    base: BaseProcessor,
    effective_params: dict[str, Any],
    method: str,
    dims: int,
    data: Any,
) -> dict[str, Any]:
    """Run base.process_reduction with effective_params, restoring the prior
    base.config afterwards.

    Centralizes the save/restore pattern so a leaked `precomputed` flag (or
    any other temporary key) cannot survive across reduction calls.
    """
    saved = base.config
    base.config = effective_params
    try:
        return base.process_reduction(data, method, dims)
    finally:
        base.config = saved


class ReductionPipeline:
    """Unified pipeline: load → annotate → reduce → output.

    This class orchestrates the full data preparation workflow, replacing
    both LocalProcessor and UniProtQueryProcessor with a single composable
    pipeline that works with any input source via EmbeddingSet.
    """

    def __init__(self, config: PipelineConfig):
        self.config = config
        # UniProtKB release(s) behind the annotations of the last
        # `_fetch_annotations` call; empty when no UniProt data was used.
        self.uniprot_releases: set[str] = set()
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

        # Merge same-name embedding sets (union their proteins)
        from protspace.data.loaders.embedding_set import merge_same_name_sets

        embedding_sets = merge_same_name_sets(embedding_sets)

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

        # Projection statistics (best-effort; never fail the run for a secondary
        # artifact). Computed here where embeddings and projections coexist.
        statistics_table = None
        stats_settings: dict = {}
        if self.config.stats:
            statistics_table, stats_settings = self._compute_statistics(
                embedding_sets, all_reductions, all_headers, metadata
            )

        # Create and save output
        output = self.base.create_output(metadata, all_reductions, all_headers)
        self.base.save_output(
            output,
            self.config.output_path,
            bundled=self.config.bundled,
            statistics=statistics_table,
            settings=stats_settings or None,
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
        from protspace.data.loaders.fasta import parse_fasta_normalized

        # One FASTA typically backs every embedder's set, so parse each file once.
        fasta_paths = dict.fromkeys(
            Path(emb_set.fasta_path) for emb_set in embedding_sets if emb_set.fasta_path
        )
        sequences = {}
        for fasta_path in fasta_paths:
            if fasta_path.exists():
                sequences.update(parse_fasta_normalized(fasta_path))
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
        from protspace.data.annotations.cache import CACHE_FILENAME, fetch_annotations
        from protspace.data.annotations.configuration import AnnotationConfiguration

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
            annotations_list = AnnotationConfiguration(
                annotation_names
            ).user_annotations
        else:
            annotations_list = None

        # CSV-only: no API annotations requested
        self.uniprot_releases = set()
        if annotations_list is None and csv_df is not None:
            return csv_df

        cache_path = None
        intermediate_dir = self.config.intermediate_dir
        if self.config.keep_tmp and intermediate_dir:
            intermediate_dir.mkdir(parents=True, exist_ok=True)
            cache_path = intermediate_dir / CACHE_FILENAME

        fetched = fetch_annotations(
            headers,
            annotations_list,
            sequences=sequences,
            cache_path=cache_path,
            refetch=self.config.refetch_stages,
        )
        self.uniprot_releases = set(fetched.uniprot_releases)
        return self._merge_csv(fetched.frame, csv_df)

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

    # --- Projection caching helpers ---

    def _projection_cache_path(
        self,
        embedding_name: str,
        method: str,
        dims: int,
        effective_params: dict[str, Any] | None = None,
        *,
        fingerprint: str,
    ) -> Path | None:
        cache_dir = self.config.intermediate_dir
        if not cache_dir or not self.config.keep_tmp:
            return None
        key_dict = {
            "embedding": embedding_name,
            "method": method,
            "dims": dims,
            "params": effective_params or asdict(self.config.reducer_params),
            "fingerprint": fingerprint,
        }
        key_json = json.dumps(key_dict, sort_keys=True, default=str)
        h = hashlib.sha256(key_json.encode()).hexdigest()[:12]
        return cache_dir / f"proj_{embedding_name}_{method}{dims}_{h}.npz"

    def _load_cached_projection(
        self,
        embedding_name: str,
        method: str,
        dims: int,
        effective_params: dict[str, Any] | None = None,
        param_suffix: str = "",
        *,
        fingerprint: str,
    ) -> dict[str, Any] | None:
        path = self._projection_cache_path(
            embedding_name, method, dims, effective_params, fingerprint=fingerprint
        )
        if (
            path is None
            or not path.exists()
            or "projections" in self.config.refetch_stages
        ):
            return None
        logger.info(
            "Using cached %s %d projection for '%s'",
            method.upper(),
            dims,
            embedding_name,
        )
        cached = np.load(path, allow_pickle=False)
        info = json.loads(str(cached["info"]))
        return {
            "name": format_projection_name(embedding_name, method, dims, param_suffix),
            "dimensions": dims,
            "info": info,
            "data": cached["data"],
        }

    def _save_projection_cache(
        self,
        embedding_name: str,
        method: str,
        dims: int,
        reduction: dict,
        effective_params: dict[str, Any] | None = None,
        *,
        fingerprint: str,
    ) -> None:
        path = self._projection_cache_path(
            embedding_name, method, dims, effective_params, fingerprint=fingerprint
        )
        if path is None:
            return
        # Staged: `_load_cached_projection` trusts this entry on `exists()` alone,
        # so a half-written zip would make every later run fail to load it.
        # Written through a handle because `np.savez` appends `.npz` to a path.
        with staged_write(path) as staged, open(staged, "wb") as fh:
            np.savez(
                fh, data=reduction["data"], info=np.array(json.dumps(reduction["info"]))
            )

    # --- Dimensionality reduction ---

    def _run_reductions(
        self, embedding_sets: list[EmbeddingSet]
    ) -> list[dict[str, Any]]:
        """Run dimensionality reduction on all embedding sets."""
        all_reductions = []
        cached_projections: list[str] = []  # e.g. "PCA 2 (prot_t5)"
        computed_count = 0

        # Pre-compute which (method, dims) pairs appear multiple times
        method_counts = Counter(
            (spec.method, spec.dims) for spec in self.config.methods
        )

        global_params = asdict(self.config.reducer_params)

        def add(reduction: dict[str, Any]) -> None:
            """Stamp the current source embedding-set name, then record it — so
            'every recorded projection carries a source' is a single fact. Called
            only within an ``emb_set`` iteration, so late-bound ``emb_set`` is current.
            """
            reduction["source"] = emb_set.name
            all_reductions.append(reduction)

        for emb_set in embedding_sets:
            # Once per set, not per method: the digest is a full pass over the
            # matrix (~0.9 s for Swiss-Prot) and every method sees the same one.
            # Not at all when nothing will be cached -- `_projection_cache_path`
            # returns None then, so the digest would be a full scan of a 2 GB
            # matrix computed for a key nobody looks up.
            fingerprint = (
                _embedding_fingerprint(emb_set)
                if self.config.keep_tmp and self.config.intermediate_dir
                else ""
            )

            if emb_set.precomputed:
                cached = self._load_cached_projection(
                    emb_set.name, MDS_NAME, 2, global_params, fingerprint=fingerprint
                )
                if cached:
                    add(cached)
                    cached_projections.append(f"MDS 2 ({emb_set.name})")
                    continue
                logger.info(f"Applying MDS 2 to '{emb_set.name}' (precomputed)")
                effective_params = {**global_params, "precomputed": True}
                reduction = _run_with_overridden_config(
                    self.base, effective_params, MDS_NAME, 2, emb_set.data
                )
                reduction["name"] = format_projection_name(emb_set.name, MDS_NAME, 2)
                add(reduction)
                self._save_projection_cache(
                    emb_set.name,
                    MDS_NAME,
                    2,
                    reduction,
                    global_params,
                    fingerprint=fingerprint,
                )
                computed_count += 1
                continue

            for spec in self.config.methods:
                method, dims = spec.method, spec.dims

                if method not in self.base.reducers:
                    logger.warning(f"Unknown method: {method}. Skipping.")
                    continue

                # Merge global defaults with per-method overrides
                effective_params = {**global_params, **spec.overrides_dict}

                # Build param suffix for disambiguation
                param_suffix = disambiguation_suffix(spec, method_counts)

                cached = self._load_cached_projection(
                    emb_set.name,
                    method,
                    dims,
                    effective_params,
                    param_suffix,
                    fingerprint=fingerprint,
                )
                if cached:
                    add(cached)
                    cached_projections.append(
                        f"{method.upper()} {dims} ({emb_set.name})"
                    )
                    continue

                logger.info(f"Applying {method.upper()} {dims} to '{emb_set.name}'")
                reduction = _run_with_overridden_config(
                    self.base, effective_params, method, dims, emb_set.data
                )

                reduction["name"] = format_projection_name(
                    emb_set.name, method, dims, param_suffix
                )
                add(reduction)
                self._save_projection_cache(
                    emb_set.name,
                    method,
                    dims,
                    reduction,
                    effective_params,
                    fingerprint=fingerprint,
                )
                computed_count += 1

        if cached_projections:
            logger.warning(
                "Using %d cached projection%s",
                len(cached_projections),
                "s" if len(cached_projections) != 1 else "",
            )

        return all_reductions

    def _compute_statistics(
        self, embedding_sets, all_reductions, all_headers, metadata=None
    ):
        """Compute projection statistics, returning ``(table_or_None, settings)``.

        Best-effort: any failure is logged and yields ``(None, {})`` so the bundle
        still ships. Each reduction's coordinate rows correspond to
        ``all_headers`` (the common header order), which is also the embedding
        row order after header validation — so faithfulness aligns cleanly.

        Routes outputs to their parts in place: faithfulness → each projection's
        ``info_json.quality``; per-protein cluster membership / silhouette →
        columns on ``metadata`` (joined by identifier). Returns the aggregate-
        validity-only fifth-part table plus the auto-generated cluster-legend
        settings (empty when no membership columns were produced).
        """
        settings: dict = {}
        try:
            from protspace.stats import compute_statistics
            from protspace.stats.carriage import (
                build_cluster_legend_settings,
                merge_annotation_columns,
                route_faithfulness_to_metadata,
            )

            for red in all_reductions:
                red.setdefault("ids", all_headers)

            from protspace.stats.annotation_select import build_annotation_labels

            annotation_labels = None
            if metadata is not None:
                annotation_labels = build_annotation_labels(
                    metadata, self.config.stats_annotation, id_col="identifier"
                )

            report = compute_statistics(
                embedding_sets,
                all_reductions,
                rng_seed=self.config.reducer_params.random_state,
                params={"cluster_selection": self.config.cluster_selection},
                # Faithfulness high-dim metric: reducers like PCA/MDS/PaCMAP omit
                # 'metric' from their params, so fall back to the run's metric
                # rather than silently assuming euclidean.
                default_metric=self.config.reducer_params.metric,
                annotations=annotation_labels,
            )
            table = report.to_arrow()

            # Commit: fold the results into the shared reductions + metadata frame.
            route_faithfulness_to_metadata(report, all_reductions)
            if metadata is not None and report.annotation_columns:
                # Merge first so we know which columns actually landed values (an id
                # namespace mismatch drops empties in merge), then auto-style only
                # those so clusters are colored when selected without a phantom
                # legend for a column that matched nothing.
                added = merge_annotation_columns(report, metadata)
                if added:
                    settings = build_cluster_legend_settings(report, columns=added)
                logger.info(
                    "Routed %d computed annotation column(s); styled %d",
                    len(added),
                    len(settings),
                )
            logger.info("Computed %d projection-statistic row(s)", table.num_rows)
            return (table if table.num_rows else None), settings
        except Exception as exc:  # noqa: BLE001 - statistics are secondary
            logger.warning("Statistics computation failed: %s", exc)
            return None, {}
