"""protspace prepare — unified data preparation pipeline."""

import logging
import sys
import time
from datetime import datetime, timezone
from enum import Enum
from pathlib import Path
from typing import Annotated

import pandas as pd
import typer

from protspace.cli.app import app, setup_logging

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


class Metric(str, Enum):
    euclidean = "euclidean"
    cosine = "cosine"
    manhattan = "manhattan"


# ---------------------------------------------------------------------------
# Option type aliases
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
Opt_Fasta = Annotated[
    Path | None,
    typer.Option(
        "-f",
        "--fasta",
        help="FASTA for -s/--similarity when input is HDF5.",
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
Opt_BatchSize = Annotated[
    int,
    typer.Option(
        help="Sequences per Biocentral API call.", rich_help_panel="Embedding"
    ),
]

# Projection
Opt_Methods = Annotated[
    str,
    typer.Option(
        "-m",
        "--methods",
        help="DR methods, comma-separated: pca2,umap2,tsne2,pacmap2,mds2,localmap2.",
        rich_help_panel="Projection",
    ),
]
Opt_Similarity = Annotated[
    bool,
    typer.Option(
        "-s",
        "--similarity",
        help="Compute sequence similarity DR via MMseqs2.",
        rich_help_panel="Projection",
    ),
]
Opt_Metric = Annotated[
    Metric,
    typer.Option(help="Distance metric for UMAP/t-SNE.", rich_help_panel="Projection"),
]
Opt_RandomState = Annotated[
    int,
    typer.Option(help="Random seed.", rich_help_panel="Projection"),
]
Opt_NNeighbors = Annotated[
    int,
    typer.Option(
        help="UMAP/PaCMAP/LocalMAP neighbors. Larger=more global.",
        rich_help_panel="Projection",
        min=2,
    ),
]
Opt_MinDist = Annotated[
    float,
    typer.Option(
        help="UMAP min distance.", rich_help_panel="Projection", min=0.0, max=0.99
    ),
]
Opt_Perplexity = Annotated[
    float,
    typer.Option(
        help="t-SNE perplexity. Should be < n_samples/3.",
        rich_help_panel="Projection",
        min=5.0,
    ),
]
Opt_LearningRate = Annotated[
    float,
    typer.Option(help="t-SNE learning rate.", rich_help_panel="Projection", min=1.0),
]
Opt_MnRatio = Annotated[
    float,
    typer.Option(
        help="PaCMAP/LocalMAP mid-near ratio.",
        rich_help_panel="Projection",
        min=0.0,
        max=1.0,
    ),
]
Opt_FpRatio = Annotated[
    float,
    typer.Option(
        help="PaCMAP/LocalMAP further ratio.", rich_help_panel="Projection", min=0.0
    ),
]
Opt_NInit = Annotated[
    int,
    typer.Option(help="MDS initializations.", rich_help_panel="Projection", min=1),
]
Opt_MaxIter = Annotated[
    int,
    typer.Option(help="MDS max iterations.", rich_help_panel="Projection", min=1),
]
Opt_Eps = Annotated[
    float,
    typer.Option(help="MDS convergence tolerance.", rich_help_panel="Projection"),
]

# Annotations
Opt_Annotations = Annotated[
    str,
    typer.Option(
        "-a",
        "--annotations",
        help=f"Comma-separated: default,all,uniprot,interpro,taxonomy or names. See {ANNOTATIONS_URL}",
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

# General
Opt_Verbose = Annotated[
    int,
    typer.Option("-v", "--verbose", count=True, help="Verbosity: -v=INFO, -vv=DEBUG."),
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
    eps: Opt_Eps = 1e-6,
    # Annotations
    annotations: Opt_Annotations = "default",
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
            typer.echo(pd.read_parquet(cache_path).to_csv(index=False))
        else:
            logger.error(f"No cache at {cache_path}.")
        return

    # --- Build embedding sets ---
    from protspace.data.loaders import EmbeddingSet, embed_fasta, load_h5
    from protspace.data.loaders.h5 import EMBEDDING_EXTENSIONS
    from protspace.data.loaders.query import query_uniprot

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
                    batch_size=batch_size,
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
                            batch_size=batch_size,
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
                compute_similarity(fasta_for_similarity, embedding_sets[0].headers)
            )

        # --- Parse annotations (comma-separated string → list) ---
        annotation_list = [a.strip() for a in annotations.split(",") if a.strip()]

        # --- Run pipeline ---
        from protspace.data.processors.pipeline import (
            PipelineConfig,
            ReductionPipeline,
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
            reducer_params={
                "metric": metric.value,
                "random_state": random_state,
                "n_neighbors": n_neighbors,
                "min_dist": min_dist,
                "perplexity": perplexity,
                "learning_rate": learning_rate,
                "mn_ratio": mn_ratio,
                "fp_ratio": fp_ratio,
                "n_init": n_init,
                "max_iter": max_iter,
                "eps": eps,
            },
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
            methods=methods,
            similarity=similarity,
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
            annotations=annotations,
            scores=scores,
            batch_size=batch_size,
            output_path=output_path,
            bundled=bundled,
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
    methods: str,
    similarity: bool,
    metric: str,
    random_state: int,
    n_neighbors: int,
    min_dist: float,
    perplexity: float,
    learning_rate: float,
    mn_ratio: float,
    fp_ratio: float,
    n_init: int,
    max_iter: int,
    eps: float,
    annotations: str,
    scores: bool,
    batch_size: int,
    output_path: Path,
    bundled: bool,
    n_proteins: int,
    n_embedding_sets: int,
) -> None:
    """Write a reproducibility log to {output_dir}/run.log."""
    import protspace

    ts_end = datetime.now(timezone.utc)
    method_list = [m.strip() for m in methods.split(",") if m.strip()]
    n_projections = len(method_list) * n_embedding_sets

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

    lines += [
        "",
        "## Embedding",
        f"embedders: {', '.join(embedders) if embedders else '(from HDF5)'}",
        f"batch_size: {batch_size}",
        "",
        "## Projection",
        f"methods: {', '.join(method_list)}",
        f"similarity: {similarity}",
        f"metric: {metric}",
        f"random_state: {random_state}",
        f"n_neighbors: {n_neighbors}",
        f"min_dist: {min_dist}",
        f"perplexity: {perplexity}",
        f"learning_rate: {learning_rate}",
        f"mn_ratio: {mn_ratio}",
        f"fp_ratio: {fp_ratio}",
        f"n_init: {n_init}",
        f"max_iter: {max_iter}",
        f"eps: {eps}",
        "",
        "## Annotations",
        f"categories: {annotations}",
        f"scores: {scores}",
        "",
        "## Output",
        f"format: {'parquetbundle' if bundled else 'parquet'}",
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
