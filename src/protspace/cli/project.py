"""protspace project — dimensionality reduction on HDF5 embeddings."""

import logging
from pathlib import Path
from typing import Annotated

import typer

from protspace.cli.app import app, setup_logging
from protspace.cli.common_options import (
    Metric,
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


@app.command()
def project(
    input: Annotated[
        list[str],
        typer.Option(
            "-i",
            "--input",
            help="HDF5 file(s). Repeat for multi-embedding. Colon syntax: -i file.h5:name",
        ),
    ],
    methods: Opt_Methods = "pca2",
    output: Annotated[
        Path,
        typer.Option(
            "-o", "--output", help="Output directory for projection parquet files."
        ),
    ] = Path("."),
    similarity: Opt_Similarity = False,
    fasta: Opt_Fasta = None,
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
    verbose: Opt_Verbose = 0,
) -> None:
    """Run dimensionality reduction on HDF5 embeddings.

    \b
    Outputs projections_metadata.parquet and projections_data.parquet
    to the output directory.
    """
    setup_logging(verbose)

    import pyarrow.parquet as pq

    from protspace.cli.prepare import _parse_input_specs
    from protspace.data.loaders import EmbeddingSet, compute_similarity, load_h5
    from protspace.data.processors.base_processor import BaseProcessor
    from protspace.data.processors.pipeline import parse_method_spec
    from protspace.utils import get_reducers
    from protspace.utils.constants import MDS_NAME

    input_specs = _parse_input_specs(input)
    embedding_sets: list[EmbeddingSet] = []

    for path, name_override in input_specs:
        embedding_sets.append(load_h5([path], name_override=name_override))

    if not embedding_sets:
        raise typer.BadParameter("No valid HDF5 files found.")

    if similarity:
        if fasta is None:
            raise typer.BadParameter("--similarity requires --fasta.")
        sim_set = compute_similarity(fasta, embedding_sets[0].headers)
        embedding_sets.append(sim_set)

    from dataclasses import asdict

    from protspace.data.processors.pipeline import ReducerParams

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
    reducers = get_reducers()
    base = BaseProcessor(asdict(reducer_params), reducers)

    all_reductions = []
    headers = embedding_sets[0].headers
    for emb_set in embedding_sets:
        for method_spec in methods.split(","):
            method, dims = parse_method_spec(method_spec)
            if emb_set.precomputed and method != MDS_NAME:
                logger.warning(
                    f"Skipping {method} for '{emb_set.name}' (only MDS for precomputed)"
                )
                continue
            if method not in reducers:
                logger.warning(f"Unknown method: {method}. Skipping.")
                continue
            if emb_set.precomputed:
                base.config["precomputed"] = True
            else:
                base.config.pop("precomputed", None)
            logger.info(f"Applying {method.upper()}{dims} to '{emb_set.name}'")
            reduction = base.process_reduction(emb_set.data, method, dims)
            reduction["name"] = f"{emb_set.name} — {reduction['name']}"
            all_reductions.append(reduction)

    output.mkdir(parents=True, exist_ok=True)

    metadata_table = base._create_projections_metadata_table(all_reductions)
    data_table = base._create_projections_data_table(all_reductions, headers)

    pq.write_table(metadata_table, str(output / "projections_metadata.parquet"))
    pq.write_table(data_table, str(output / "projections_data.parquet"))

    typer.echo(f"Saved {len(all_reductions)} projections to {output}")
