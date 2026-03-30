"""protspace prepare — unified data preparation pipeline."""

from __future__ import annotations

import logging
import sys
import time
from dataclasses import asdict
from datetime import datetime, timezone
from pathlib import Path
from typing import TYPE_CHECKING, Annotated

if TYPE_CHECKING:
    from protspace.data.embedding.biocentral import EmbedConfig
    from protspace.data.processors.pipeline import PipelineConfig

import typer

from protspace.cli.app import app, setup_logging
from protspace.cli.common_options import (
    Metric,
    Opt_BatchSize,
    Opt_Eps,
    Opt_Fasta,
    Opt_FpRatio,
    Opt_LearningRate,
    Opt_MaxIter,
    Opt_Methods,
    Opt_Metric,
    Opt_MinDist,
    Opt_MnRatio,
    Opt_NInit,
    Opt_NNeighbors,
    Opt_Perplexity,
    Opt_RandomState,
    Opt_Similarity,
    Opt_Verbose,
)

logger = logging.getLogger(__name__)

ANNOTATIONS_URL = "https://github.com/tsenoner/protspace/blob/main/docs/annotations.md"
EMBEDDER_MODELS = {
    "prot_t5",
    "prost_t5",
    "esm2_8m",
    "esm2_35m",
    "esm2_150m",
    "esm2_650m",
    "esm2_3b",
    "ankh_base",
    "ankh_large",
    "ankh3_large",
    "esmc_300m",
    "esmc_600m",
}


# ---------------------------------------------------------------------------
# Prepare-specific option type aliases
# ---------------------------------------------------------------------------

# Input
Opt_Input = Annotated[
    list[str] | None,
    typer.Option(
        "-i",
        "--input",
        help="HDF5/FASTA file(s). Repeat for multi-embedding. Name override: -i f.h5:name",
        rich_help_panel="Input",
    ),
]
Opt_Query = Annotated[
    str | None,
    typer.Option(
        "-q",
        "--query",
        help="UniProt query (alternative to -i).",
        rich_help_panel="Input",
    ),
]

# Embedding
Opt_Embedder = Annotated[
    str | None,
    typer.Option(
        "-e",
        "--embedder",
        help=(
            "pLM model(s), comma-separated. "
            "Models: prot_t5, prost_t5, esm2_8m, esm2_35m, esm2_150m, "
            "esm2_650m, esm2_3b, ankh_base, ankh_large, ankh3_large, "
            "esmc_300m, esmc_600m. "
            "Note: ankh_*, ankh3_*, esmc_600m are non-commercial licenses."
        ),
        rich_help_panel="Embedding",
    ),
]

# Annotations
Opt_Annotations = Annotated[
    list[str] | None,
    typer.Option(
        "-a",
        "--annotations",
        help=f"Annotation groups (default,all,uniprot,interpro,taxonomy,ted,biocentral), individual names, or a CSV/TSV file path. Repeatable. See {ANNOTATIONS_URL}",
        rich_help_panel="Annotations",
    ),
]
Opt_Scores = Annotated[
    bool,
    typer.Option(
        "--scores/--no-scores",
        help="Include annotation confidence scores.",
        rich_help_panel="Annotations",
    ),
]
Opt_ForceRefetch = Annotated[
    bool,
    typer.Option(
        "--force-refetch",
        help="Re-download all annotations.",
        rich_help_panel="Annotations",
    ),
]

# Output
Opt_Output = Annotated[
    Path,
    typer.Option("-o", "--output", help="Output directory.", rich_help_panel="Output"),
]
Opt_KeepTmp = Annotated[
    bool,
    typer.Option(
        help="Cache intermediates in {output}/tmp/ for resumability.",
        rich_help_panel="Output",
    ),
]
Opt_Bundled = Annotated[
    bool,
    typer.Option(help="Bundle into single .parquetbundle.", rich_help_panel="Output"),
]
Opt_DumpCache = Annotated[
    bool,
    typer.Option(
        "--dump-cache",
        help="Print cached annotations and exit.",
        rich_help_panel="Output",
    ),
]
Opt_NoLog = Annotated[
    bool,
    typer.Option(
        "--no-log",
        help="Skip writing run.log to the output directory.",
        rich_help_panel="Output",
    ),
]


# ---------------------------------------------------------------------------
# Command
# ---------------------------------------------------------------------------


@app.command()
def prepare(
    # Input
    input: Opt_Input = None,
    query: Opt_Query = None,
    fasta: Opt_Fasta = None,
    # Embedding
    embedder: Opt_Embedder = None,
    batch_size: Opt_BatchSize = 1000,
    # Projection
    methods: Opt_Methods = "pca2",
    similarity: Opt_Similarity = False,
    metric: Opt_Metric = Metric.euclidean,
    random_state: Opt_RandomState = 42,
    n_neighbors: Opt_NNeighbors = 25,
    min_dist: Opt_MinDist = 0.1,
    perplexity: Opt_Perplexity = 30.0,
    learning_rate: Opt_LearningRate = 200.0,
    mn_ratio: Opt_MnRatio = 0.5,
    fp_ratio: Opt_FpRatio = 2.0,
    n_init: Opt_NInit = 4,
    max_iter: Opt_MaxIter = 300,
    eps: Opt_Eps = 1e-3,
    # Annotations
    annotations: Opt_Annotations = None,
    scores: Opt_Scores = True,
    force_refetch: Opt_ForceRefetch = False,
    # Output
    output: Opt_Output = Path("."),
    keep_tmp: Opt_KeepTmp = True,
    bundled: Opt_Bundled = True,
    dump_cache: Opt_DumpCache = False,
    no_log: Opt_NoLog = False,
    # General
    verbose: Opt_Verbose = 0,
) -> None:
    """Prepare protein data for visualization (full pipeline).

    \b
    Requires at least one of:  -i/--input  or  -q/--query
    Comma-separated args (-e, -m, -a) must not contain spaces.
    """
    t_start = time.monotonic()
    ts_start = datetime.now(timezone.utc)

    if not input and not query:
        raise typer.BadParameter(
            "At least one of -i/--input or -q/--query is required."
        )

    setup_logging(verbose)

    input_specs = _parse_input_specs(input) if input else []

    from protspace.data.io.fasta import is_fasta_file

    has_fasta = any(
        is_fasta_file(spec[0]) for spec in input_specs if not spec[0].is_dir()
    )

    embedders = _parse_embedders(embedder)

    if embedders and not has_fasta and not query:
        raise typer.BadParameter("-e/--embedder requires FASTA input or -q/--query.")

    if has_fasta and not embedders:
        from protspace.data.embedding.biocentral import DEFAULT_EMBEDDER

        embedders = [DEFAULT_EMBEDDER]
        logger.info(f"FASTA detected, defaulting to '{embedders[0]}'")

    # --- Output and cache paths ---
    output_dir = output if output.suffix == "" else output.parent
    output_dir.mkdir(parents=True, exist_ok=True)

    cache_dir = output_dir / "tmp" if keep_tmp else None
    if cache_dir:
        cache_dir.mkdir(parents=True, exist_ok=True)

    if bundled:
        output_path = (
            output
            if output.suffix == ".parquetbundle"
            else output_dir / "data.parquetbundle"
        )
    else:
        output_path = output_dir

    # --- Dump cache ---
    if dump_cache:
        if not cache_dir:
            logger.error("No cache. Use --keep-tmp.")
            raise typer.Exit(1)
        cache_path = cache_dir / "all_annotations.parquet"
        if cache_path.exists():
            import pandas as pd

            typer.echo(pd.read_parquet(cache_path).to_csv(index=False))
        else:
            logger.error(f"No cache at {cache_path}.")
        return

    # --- Build embedding sets ---
    from protspace.data.embedding.biocentral import EmbedConfig
    from protspace.data.loaders import EmbeddingSet, embed_fasta, load_h5
    from protspace.data.loaders.h5 import EMBEDDING_EXTENSIONS
    from protspace.data.loaders.query import query_uniprot

    embed_config = EmbedConfig(batch_size=batch_size)
    embedding_sets: list[EmbeddingSet] = []
    fasta_for_similarity: Path | None = fasta

    try:
        if query:
            fasta_save = cache_dir / "sequences.fasta" if cache_dir else None
            headers, fasta_path = query_uniprot(query, save_to=fasta_save)
            if not headers:
                raise typer.BadParameter(f"No sequences for query: '{query}'")

            if not embedders:
                from protspace.data.embedding.biocentral import DEFAULT_EMBEDDER

                embedders = [DEFAULT_EMBEDDER]

            for emb_name in embedders:
                emb_cache = cache_dir / f"{emb_name}.h5" if cache_dir else None
                emb_set = embed_fasta(
                    fasta_path,
                    emb_name,
                    embed_config=embed_config,
                    embedding_cache=emb_cache,
                )
                emb_set.fasta_path = fasta_path
                embedding_sets.append(emb_set)
            fasta_for_similarity = fasta_path

        elif input_specs:
            for path, name_override in input_specs:
                if path.is_dir():
                    h5s = sorted(
                        f for ext in EMBEDDING_EXTENSIONS for f in path.glob(f"*{ext}")
                    )
                    if not h5s:
                        logger.warning(f"No embedding files in: {path}")
                        continue
                    embedding_sets.append(load_h5(h5s, name_override=name_override))
                elif path.suffix.lower() in EMBEDDING_EXTENSIONS:
                    embedding_sets.append(load_h5([path], name_override=name_override))
                elif path.suffix.lower() in {".fasta", ".fa", ".faa"}:
                    for emb_name in embedders:
                        emb_cache = cache_dir / f"{emb_name}.h5" if cache_dir else None
                        emb_set = embed_fasta(
                            path,
                            emb_name,
                            embed_config=embed_config,
                            embedding_cache=emb_cache,
                        )
                        emb_set.fasta_path = path
                        embedding_sets.append(emb_set)
                    fasta_for_similarity = path
                else:
                    raise typer.BadParameter(f"Unsupported file: {path}")

        if not embedding_sets:
            raise typer.BadParameter("No valid input data found.")

        # --- Similarity ---
        if similarity:
            if fasta_for_similarity is None:
                raise typer.BadParameter(
                    "-s requires FASTA. Use -f when input is HDF5."
                )
            from protspace.data.loaders import compute_similarity

            embedding_sets.append(
                compute_similarity(
                    fasta_for_similarity,
                    embedding_sets[0].headers,
                    cache_dir=cache_dir,
                )
            )

        # --- Parse annotations (repeatable option → flat list) ---
        raw = annotations if annotations else ["default"]
        annotation_list = []
        for item in raw:
            for part in item.split(","):
                part = part.strip()
                if part:
                    annotation_list.append(part)

        # --- Run pipeline ---
        from protspace.data.processors.pipeline import (
            PipelineConfig,
            ReducerParams,
            ReductionPipeline,
        )

        reducer_params = ReducerParams(
            metric=metric.value,
            random_state=random_state,
            n_neighbors=n_neighbors,
            min_dist=min_dist,
            perplexity=perplexity,
            learning_rate=learning_rate,
            mn_ratio=mn_ratio,
            fp_ratio=fp_ratio,
            n_init=n_init,
            max_iter=max_iter,
            eps=eps,
        )
        config = PipelineConfig(
            methods=methods.split(","),
            output_path=output_path,
            bundled=bundled,
            keep_tmp=keep_tmp,
            no_scores=not scores,
            force_refetch=force_refetch,
            annotations=annotation_list,
            intermediate_dir=cache_dir,
            reducer_params=reducer_params,
        )

        ReductionPipeline(config).run(embedding_sets)

    except (FileNotFoundError, ValueError) as e:
        logger.error(str(e))
        raise typer.Exit(1) from e

    # --- Run log ---
    if not no_log:
        _write_run_log(
            output_dir=output_dir,
            ts_start=ts_start,
            duration=time.monotonic() - t_start,
            query=query,
            input_specs=input_specs,
            embedders=embedders,
            embed_config=embed_config,
            pipeline_config=config,
            similarity=similarity,
            scores=scores,
            output_path=output_path,
            n_proteins=len(embedding_sets[0].headers) if embedding_sets else 0,
            n_embedding_sets=len(embedding_sets),
        )


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _parse_input_specs(raw_inputs: list[str]) -> list[tuple[Path, str | None]]:
    """Parse inputs with optional colon name override: file.h5:model_name."""
    specs: list[tuple[Path, str | None]] = []
    for raw in raw_inputs:
        if ":" in raw:
            last_colon = raw.rfind(":")
            path_part, name_part = raw[:last_colon], raw[last_colon + 1 :]
            if (
                name_part
                and not name_part.startswith(("/", "\\"))
                and Path(path_part).suffix
            ):
                specs.append((Path(path_part), name_part))
            else:
                specs.append((Path(raw), None))
        else:
            specs.append((Path(raw), None))
    return specs


def _parse_embedders(embedder_arg: str | None) -> list[str]:
    """Parse comma-separated embedder string into validated list."""
    if not embedder_arg:
        return []
    embedders = [e.strip() for e in embedder_arg.split(",") if e.strip()]
    for name in embedders:
        if name not in EMBEDDER_MODELS:
            raise typer.BadParameter(
                f"Unknown embedder: '{name}'. Available: {','.join(sorted(EMBEDDER_MODELS))}"
            )
    return embedders


def _format_duration(seconds: float) -> str:
    """Format seconds into a human-readable duration string."""
    m, s = divmod(int(seconds), 60)
    h, m = divmod(m, 60)
    if h:
        return f"{h}h {m}m {s}s"
    if m:
        return f"{m}m {s}s"
    return f"{s}s"


def _write_run_log(
    *,
    output_dir: Path,
    ts_start: datetime,
    duration: float,
    query: str | None,
    input_specs: list[tuple[Path, str | None]],
    embedders: list[str],
    embed_config: EmbedConfig,
    pipeline_config: PipelineConfig,
    similarity: bool,
    scores: bool,
    output_path: Path,
    n_proteins: int,
    n_embedding_sets: int,
) -> None:
    """Write a reproducibility log to {output_dir}/run.log.

    Config objects are serialized automatically via ``dataclasses.asdict()``,
    so adding new fields to ``EmbedConfig`` or ``ReducerParams`` requires
    no changes here.
    """
    import protspace

    ts_end = datetime.now(timezone.utc)
    n_projections = len(pipeline_config.methods) * n_embedding_sets
    rp = asdict(pipeline_config.reducer_params)
    ec = asdict(embed_config)

    lines = [
        "# protspace run log",
        f"# Generated: {ts_end.strftime('%Y-%m-%dT%H:%M:%S%z')}",
        f"# Version: {protspace.__version__}",
        "",
        "## Command",
        " ".join(sys.argv),
        "",
        "## Input",
    ]

    if query:
        lines.append(f"query: {query}")
    if input_specs:
        for path, override in input_specs:
            label = f"{path}:{override}" if override else str(path)
            lines.append(f"input: {label}")
    lines.append(f"proteins: {n_proteins}")

    lines += ["", "## Embedding"]
    lines.append(f"embedders: {', '.join(embedders) if embedders else '(from HDF5)'}")
    for key, val in ec.items():
        lines.append(f"{key}: {val}")

    lines += ["", "## Projection"]
    lines.append(f"methods: {', '.join(pipeline_config.methods)}")
    lines.append(f"similarity: {similarity}")
    for key, val in rp.items():
        lines.append(f"{key}: {val}")

    lines += [
        "",
        "## Annotations",
        f"categories: {', '.join(pipeline_config.annotations or ['default'])}",
        f"scores: {scores}",
        "",
        "## Output",
        f"format: {'parquetbundle' if pipeline_config.bundled else 'parquet'}",
        f"path: {output_path}",
        f"embedding_sets: {n_embedding_sets}",
        f"projections: {n_projections}",
        "",
        "## Timing",
        f"started: {ts_start.strftime('%Y-%m-%dT%H:%M:%S%z')}",
        f"finished: {ts_end.strftime('%Y-%m-%dT%H:%M:%S%z')}",
        f"duration: {_format_duration(duration)}",
    ]

    log_path = output_dir / "run.log"
    try:
        text = "\n".join(lines) + "\n"
        if log_path.exists():
            text = "\n---\n\n" + text
        with open(log_path, "a") as f:
            f.write(text)
        logger.info(f"Run log written to {log_path}")
    except OSError:
        logger.warning(f"Could not write run log to {log_path}")
