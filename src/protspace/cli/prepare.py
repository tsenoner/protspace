"""protspace prepare — unified data preparation pipeline.

Performs dimensionality reduction on protein embeddings, fetches annotations,
and outputs a .parquetbundle for visualization at protspace.app.
"""

import logging
import shutil
from pathlib import Path
from typing import Annotated

import pandas as pd
import typer

from protspace.cli.app import (
    app,
    determine_output_paths,
    parse_custom_names,
    setup_logging,
)

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Option type aliases (spaCy pattern — keeps the command signature readable)
# ---------------------------------------------------------------------------

# Input
Opt_Input = Annotated[
    list[Path] | None,
    typer.Option(
        "-i",
        "--input",
        help="Input HDF5 or FASTA file(s). Repeat for multi-embedding.",
        rich_help_panel="Input",
    ),
]
Opt_Query = Annotated[
    str | None,
    typer.Option(
        "-q",
        "--query",
        help="UniProt search query (alternative to -i).",
        rich_help_panel="Input",
    ),
]
Opt_Fasta = Annotated[
    Path | None,
    typer.Option(
        "-f",
        "--fasta",
        help="FASTA for similarity computation (required with -s when input is HDF5).",
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
            "Biocentral model shortcut: prot_t5, prost_t5, esm2_8m, "
            "esm2_650m, esm2_3b, one_hot, blosum62, aa_ontology, random."
        ),
        rich_help_panel="Embedding",
    ),
]
Opt_BatchSize = Annotated[
    int,
    typer.Option(help="Sequences per API call.", rich_help_panel="Embedding"),
]
Opt_HalfPrecision = Annotated[
    bool,
    typer.Option("--half-precision", help="Request float16 embeddings.", rich_help_panel="Embedding"),
]
Opt_EmbeddingCache = Annotated[
    Path | None,
    typer.Option(help="Override HDF5 cache path.", rich_help_panel="Embedding"),
]
Opt_Probe = Annotated[
    bool,
    typer.Option("--probe", help="Test embedder with 2 sequences, then exit.", rich_help_panel="Embedding"),
]
Opt_DryRun = Annotated[
    bool,
    typer.Option("--dry-run", help="Parse input and print stats, then exit.", rich_help_panel="Embedding"),
]

# Projection
Opt_Methods = Annotated[
    str,
    typer.Option(
        "-m",
        "--methods",
        help="DR methods (comma-separated): pca2, umap2, tsne2, pacmap2, mds2, localmap2.",
        rich_help_panel="Projection",
    ),
]
Opt_Similarity = Annotated[
    bool,
    typer.Option("-s", "--similarity", help="Also compute sequence similarity DR.", rich_help_panel="Projection"),
]
Opt_Metric = Annotated[
    str,
    typer.Option(help="Distance metric: euclidean, cosine, manhattan, ...", rich_help_panel="Projection"),
]
Opt_RandomState = Annotated[
    int,
    typer.Option(help="Random seed for reproducibility.", rich_help_panel="Projection"),
]
Opt_NNeighbors = Annotated[
    int,
    typer.Option(help="Neighbors for UMAP/PaCMAP/LocalMAP (5-50).", rich_help_panel="Projection"),
]
Opt_MinDist = Annotated[
    float,
    typer.Option(help="UMAP min distance (0.0-0.99).", rich_help_panel="Projection"),
]
Opt_Perplexity = Annotated[
    int,
    typer.Option(help="t-SNE perplexity (5-50).", rich_help_panel="Projection"),
]
Opt_LearningRate = Annotated[
    int,
    typer.Option(help="t-SNE learning rate (10-1000).", rich_help_panel="Projection"),
]
Opt_MnRatio = Annotated[
    float,
    typer.Option(help="PaCMAP mid-near pairs ratio (0.1-1.0).", rich_help_panel="Projection"),
]
Opt_FpRatio = Annotated[
    float,
    typer.Option(help="PaCMAP further pairs ratio (1.0-3.0).", rich_help_panel="Projection"),
]
Opt_NInit = Annotated[
    int,
    typer.Option(help="MDS initialization count (1-10).", rich_help_panel="Projection"),
]
Opt_MaxIter = Annotated[
    int,
    typer.Option(help="MDS max iterations (100-1000).", rich_help_panel="Projection"),
]
Opt_Eps = Annotated[
    float,
    typer.Option(help="MDS convergence tolerance.", rich_help_panel="Projection"),
]

# Annotations
Opt_Annotations = Annotated[
    list[str] | None,
    typer.Option(
        "-a",
        "--annotations",
        help="Annotation sources (repeatable): default, all, uniprot, interpro, taxonomy, or individual names.",
        rich_help_panel="Annotations",
    ),
]
Opt_NoScores = Annotated[
    bool,
    typer.Option("--no-scores", help="Strip annotation confidence scores.", rich_help_panel="Annotations"),
]
Opt_ForceRefetch = Annotated[
    bool,
    typer.Option("--force-refetch", help="Force re-download even if cached.", rich_help_panel="Annotations"),
]

# Output
Opt_Output = Annotated[
    Path | None,
    typer.Option("-o", "--output", help="Output file or directory path.", rich_help_panel="Output"),
]
Opt_Bundled = Annotated[
    bool,
    typer.Option(help="Bundle into single .parquetbundle.", rich_help_panel="Output"),
]
Opt_KeepTmp = Annotated[
    bool,
    typer.Option("--keep-tmp", help="Cache intermediate files for reuse.", rich_help_panel="Output"),
]
Opt_NonBinary = Annotated[
    bool,
    typer.Option("--non-binary", help="Output JSON+CSV instead of Parquet.", rich_help_panel="Output"),
]
Opt_CustomNames = Annotated[
    str | None,
    typer.Option(help='Rename projections: "pca2=My PCA,umap2=My UMAP".', rich_help_panel="Output"),
]
Opt_DumpCache = Annotated[
    bool,
    typer.Option("--dump-cache", help="Print cached annotations and exit.", rich_help_panel="Output"),
]

# General
Opt_Verbose = Annotated[
    int,
    typer.Option("-v", "--verbose", count=True, help="Increase verbosity (-v, -vv)."),
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
    half_precision: Opt_HalfPrecision = False,
    embedding_cache: Opt_EmbeddingCache = None,
    probe: Opt_Probe = False,
    dry_run: Opt_DryRun = False,
    # Projection
    methods: Opt_Methods = "pca2",
    similarity: Opt_Similarity = False,
    metric: Opt_Metric = "euclidean",
    random_state: Opt_RandomState = 42,
    n_neighbors: Opt_NNeighbors = 15,
    min_dist: Opt_MinDist = 0.1,
    perplexity: Opt_Perplexity = 30,
    learning_rate: Opt_LearningRate = 200,
    mn_ratio: Opt_MnRatio = 0.5,
    fp_ratio: Opt_FpRatio = 2.0,
    n_init: Opt_NInit = 4,
    max_iter: Opt_MaxIter = 300,
    eps: Opt_Eps = 1e-3,
    # Annotations
    annotations: Opt_Annotations = None,
    no_scores: Opt_NoScores = False,
    force_refetch: Opt_ForceRefetch = False,
    # Output
    output: Opt_Output = None,
    bundled: Opt_Bundled = True,
    keep_tmp: Opt_KeepTmp = False,
    non_binary: Opt_NonBinary = False,
    custom_names: Opt_CustomNames = None,
    dump_cache: Opt_DumpCache = False,
    # General
    verbose: Opt_Verbose = 0,
) -> None:
    """Prepare protein data for visualization (full pipeline).

    \b
    Requires at least one of:  -i/--input  or  -q/--query
    """
    if not input and not query:
        raise typer.BadParameter(
            "At least one of -i/--input or -q/--query is required."
        )

    setup_logging(verbose)

    if similarity:
        logger.warning("--similarity is not yet implemented, ignoring.")
    if fasta:
        logger.warning("--fasta is not yet implemented, ignoring.")

    # Delegate to existing processors (replaced by ReductionPipeline later)
    if query:
        _run_query_pipeline(
            query=query,
            methods=methods,
            annotations=annotations,
            output=output,
            non_binary=non_binary,
            bundled=bundled,
            keep_tmp=keep_tmp,
            no_scores=no_scores,
            force_refetch=force_refetch,
            custom_names_str=custom_names,
            metric=metric,
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
    else:
        _run_local_pipeline(
            input_paths=input,
            methods=methods,
            annotations=annotations,
            output=output,
            non_binary=non_binary,
            bundled=bundled,
            keep_tmp=keep_tmp,
            no_scores=no_scores,
            force_refetch=force_refetch,
            custom_names_str=custom_names,
            dump_cache=dump_cache,
            embedder=embedder,
            batch_size=batch_size,
            half_precision=half_precision,
            embedding_cache=embedding_cache,
            probe=probe,
            dry_run=dry_run,
            metric=metric,
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


# ---------------------------------------------------------------------------
# Internal: bridge to existing processor code (replaced by pipeline later)
# ---------------------------------------------------------------------------


def _run_local_pipeline(
    *,
    input_paths: list[Path],
    methods: str,
    annotations: list[str] | None,
    output: Path | None,
    non_binary: bool,
    bundled: bool,
    keep_tmp: bool,
    no_scores: bool,
    force_refetch: bool,
    custom_names_str: str | None,
    dump_cache: bool,
    embedder: str | None,
    batch_size: int,
    half_precision: bool,
    embedding_cache: Path | None,
    probe: bool,
    dry_run: bool,
    **reducer_params,
) -> None:
    """Bridge to existing LocalProcessor."""
    from protspace.data.annotations.scores import strip_scores_from_df
    from protspace.data.io.fasta import is_fasta_file
    from protspace.data.processors.local_processor import LocalProcessor

    has_fasta = any(is_fasta_file(p) for p in input_paths if not p.is_dir())

    if (embedder or probe or dry_run) and not has_fasta:
        raise typer.BadParameter(
            "--embedder, --probe, and --dry-run require a FASTA input file."
        )

    if has_fasta and embedder is None:
        from protspace.data.embedding.biocentral import DEFAULT_EMBEDDER

        embedder = DEFAULT_EMBEDDER
        logger.info(f"FASTA detected, defaulting embedder to '{embedder}'")

    if dry_run:
        from protspace.data.embedding.biocentral import resolve_embedder
        from protspace.data.io.fasta import parse_fasta

        fasta_path = next(p for p in input_paths if is_fasta_file(p))
        sequences = parse_fasta(fasta_path)
        if not sequences:
            typer.echo(f"No sequences found in {fasta_path}")
            return
        lengths = [len(s) for s in sequences.values()]
        resolved = resolve_embedder(embedder)
        typer.echo(f"FASTA:      {fasta_path}")
        typer.echo(f"Sequences:  {len(sequences):,}")
        typer.echo(
            f"Lengths:    min={min(lengths)}, "
            f"median={sorted(lengths)[len(lengths) // 2]}, "
            f"max={max(lengths)}"
        )
        typer.echo(f"Embedder:   {resolved}")
        typer.echo(f"Batches:    {(len(sequences) + batch_size - 1) // batch_size}")
        return

    if probe:
        from protspace.data.embedding.biocentral import probe_embedder, resolve_embedder
        from protspace.data.io.fasta import parse_fasta

        fasta_path = next(p for p in input_paths if is_fasta_file(p))
        sequences = parse_fasta(fasta_path)
        if not sequences:
            typer.echo(f"No sequences found in {fasta_path}")
            return
        resolved = resolve_embedder(embedder)
        probe_embedder(sequences, resolved, half_precision=half_precision)
        return

    custom_names = parse_custom_names(custom_names_str)

    config = {
        "custom_names": custom_names,
        "embedder": embedder,
        "batch_size": batch_size,
        "half_precision": half_precision,
        "embedding_cache": embedding_cache,
        **reducer_params,
    }

    intermediate_dir = None
    try:
        processor = LocalProcessor(config)
        data, headers = processor.load_input_files(input_paths)

        output_path, intermediate_dir = determine_output_paths(
            output_arg=output,
            input_path=input_paths[0],
            non_binary=non_binary,
            bundled=bundled,
            keep_tmp=keep_tmp,
            identifiers=headers if keep_tmp else None,
        )

        logger.info(f"Output will be saved to: {output_path}")

        if dump_cache:
            if not intermediate_dir:
                logger.error("No cache directory. Run with --keep-tmp first.")
                raise typer.Exit(1)
            cache_path = intermediate_dir / "all_annotations.parquet"
            if cache_path.exists():
                df = pd.read_parquet(cache_path)
                typer.echo(df.to_csv(index=False))
            else:
                logger.error(f"No cache found at {cache_path}.")
            return

        metadata = processor.load_or_generate_metadata(
            headers=headers,
            annotations=annotations,
            intermediate_dir=intermediate_dir,
            delimiter=",",
            non_binary=non_binary,
            keep_tmp=keep_tmp,
            force_refetch=force_refetch,
        )

        if no_scores:
            metadata = strip_scores_from_df(metadata)

        full_metadata = pd.DataFrame({"identifier": headers})
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

        methods_list = methods.split(",")
        reductions = []
        for method_spec in methods_list:
            method = "".join(filter(str.isalpha, method_spec))
            dims = int("".join(filter(str.isdigit, method_spec)))
            if method not in processor.reducers:
                logger.warning(f"Unknown method: {method}. Skipping.")
                continue
            logger.info(f"Applying {method.upper()}{dims} reduction")
            reductions.append(processor.process_reduction(data, method, dims))

        if non_binary:
            out = processor.create_output_legacy(metadata, reductions, headers)
            processor.save_output_legacy(out, output_path)
        else:
            out = processor.create_output(metadata, reductions, headers)
            processor.save_output(out, output_path, bundled=bundled)

        logger.info(f"Processed {len(headers)} items with {len(methods_list)} methods")
        logger.info(f"Output saved to: {output_path}")

        if not keep_tmp and intermediate_dir and intermediate_dir.exists():
            shutil.rmtree(intermediate_dir)

    except (FileNotFoundError, ValueError) as e:
        if not keep_tmp and intermediate_dir and intermediate_dir.exists():
            shutil.rmtree(intermediate_dir)
        logger.error(str(e))
        raise typer.Exit(1) from e
    except Exception as e:
        if not keep_tmp and intermediate_dir and intermediate_dir.exists():
            shutil.rmtree(intermediate_dir)
        logger.error(str(e))
        raise typer.Exit(1) from e


def _run_query_pipeline(
    *,
    query: str,
    methods: str,
    annotations: list[str] | None,
    output: Path | None,
    non_binary: bool,
    bundled: bool,
    keep_tmp: bool,
    no_scores: bool,
    force_refetch: bool,
    custom_names_str: str | None,
    **reducer_params,
) -> None:
    """Bridge to existing UniProtQueryProcessor."""
    from protspace.data.annotations.scores import strip_scores_from_df
    from protspace.data.processors.uniprot_query_processor import (
        UniProtQueryProcessor,
    )

    custom_names = parse_custom_names(custom_names_str)

    config = {
        "custom_names": custom_names,
        **reducer_params,
    }

    output_path, intermediate_dir = determine_output_paths(
        output_arg=output,
        input_path=None,
        non_binary=non_binary,
        bundled=bundled,
        keep_tmp=keep_tmp,
    )

    processor = UniProtQueryProcessor(config)
    metadata, similarity_matrix, headers, _ = processor.process_query(
        query=query,
        output_path=output_path,
        intermediate_dir=intermediate_dir,
        annotations=annotations,
        non_binary=non_binary,
        keep_tmp=keep_tmp,
        force_refetch=force_refetch,
    )

    if no_scores:
        metadata = strip_scores_from_df(metadata)

    methods_list = methods.split(",")
    reductions = []
    for method_spec in methods_list:
        method = "".join(filter(str.isalpha, method_spec))
        dims = int("".join(filter(str.isdigit, method_spec)))
        if method not in processor.reducers:
            logger.warning(f"Unknown method: {method}. Skipping.")
            continue
        logger.info(f"Applying {method.upper()}{dims} reduction")
        reductions.append(
            processor.process_reduction(similarity_matrix, method, dims)
        )

    if non_binary:
        out = processor.create_output_legacy(metadata, reductions, headers)
        processor.save_output_legacy(out, output_path)
    else:
        out = processor.create_output(metadata, reductions, headers)
        processor.save_output(out, output_path, bundled=bundled)

    logger.info(f"Processed {len(headers)} items with {len(methods_list)} methods")
    logger.info(f"Output saved to: {output_path}")
