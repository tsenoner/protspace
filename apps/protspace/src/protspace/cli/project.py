"""protspace project — dimensionality reduction on HDF5 embeddings."""

import logging
from pathlib import Path
from typing import Annotated

import pyarrow.parquet as pq
import typer

from protspace.cli.app import app, setup_logging

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
    methods: Annotated[
        str,
        typer.Option("-m", "--methods", help="DR methods (comma-separated): pca2, umap2, tsne2, ..."),
    ] = "pca2",
    output: Annotated[
        Path,
        typer.Option("-o", "--output", help="Output directory for projection parquet files."),
    ] = Path("."),
    similarity: Annotated[
        bool,
        typer.Option("-s", "--similarity", help="Also compute sequence similarity DR."),
    ] = False,
    fasta: Annotated[
        Path | None,
        typer.Option("-f", "--fasta", help="FASTA for similarity computation."),
    ] = None,
    metric: Annotated[str, typer.Option(help="Distance metric.")] = "euclidean",
    random_state: Annotated[int, typer.Option(help="Random seed.")] = 42,
    n_neighbors: Annotated[int, typer.Option(help="Neighbors for UMAP/PaCMAP.")] = 15,
    min_dist: Annotated[float, typer.Option(help="UMAP min distance.")] = 0.1,
    perplexity: Annotated[int, typer.Option(help="t-SNE perplexity.")] = 30,
    learning_rate: Annotated[int, typer.Option(help="t-SNE learning rate.")] = 200,
    mn_ratio: Annotated[float, typer.Option(help="PaCMAP mn_ratio.")] = 0.5,
    fp_ratio: Annotated[float, typer.Option(help="PaCMAP fp_ratio.")] = 2.0,
    n_init: Annotated[int, typer.Option(help="MDS n_init.")] = 4,
    max_iter: Annotated[int, typer.Option(help="MDS max_iter.")] = 300,
    eps: Annotated[float, typer.Option(help="MDS eps.")] = 1e-3,
    verbose: Annotated[
        int,
        typer.Option("-v", "--verbose", count=True, help="Increase verbosity."),
    ] = 0,
) -> None:
    """Run dimensionality reduction on HDF5 embeddings.

    \b
    Outputs projections_metadata.parquet and projections_data.parquet
    to the output directory.
    """
    setup_logging(verbose)

    from protspace.cli.prepare import _parse_input_specs
    from protspace.data.loaders import EmbeddingSet, compute_similarity, load_h5
    from protspace.data.processors.base_processor import BaseProcessor
    from protspace.data.processors.pipeline import parse_method_spec
    from protspace.utils import REDUCERS
    from protspace.utils.reducers import MDS_NAME

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

    reducer_params = {
        "metric": metric,
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
    }
    base = BaseProcessor(reducer_params, REDUCERS)

    all_reductions = []
    headers = embedding_sets[0].headers
    for emb_set in embedding_sets:
        for method_spec in methods.split(","):
            method, dims = parse_method_spec(method_spec)
            if emb_set.precomputed and method != MDS_NAME:
                logger.warning(f"Skipping {method} for '{emb_set.name}' (only MDS for precomputed)")
                continue
            if method not in REDUCERS:
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
