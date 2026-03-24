"""protspace embed — generate protein embeddings from FASTA via Biocentral API."""

import logging
from pathlib import Path
from typing import Annotated

import typer

from protspace.cli.app import app, setup_logging

logger = logging.getLogger(__name__)


@app.command()
def embed(
    input: Annotated[
        Path,
        typer.Option(
            "-i", "--input", help="Input FASTA file.", exists=True,
        ),
    ],
    embedder: Annotated[
        list[str],
        typer.Option(
            "-e",
            "--embedder",
            help=(
                "Biocentral model shortcut (repeatable for multi-model).\n"
                "Models: prot_t5, prost_t5, esm2_8m, esm2_650m, esm2_3b, "
                "one_hot, blosum62, aa_ontology, random."
            ),
        ),
    ],
    output: Annotated[
        Path,
        typer.Option("-o", "--output", help="Output directory (one H5 per model)."),
    ],
    batch_size: Annotated[
        int,
        typer.Option(help="Sequences per API call."),
    ] = 1000,
    half_precision: Annotated[
        bool,
        typer.Option("--half-precision", help="Request float16 embeddings."),
    ] = False,
    verbose: Annotated[
        int,
        typer.Option("-v", "--verbose", count=True, help="Increase verbosity (-v, -vv)."),
    ] = 0,
) -> None:
    """Generate protein embeddings from a FASTA file via Biocentral API.

    \b
    Creates one HDF5 file per model in the output directory, with
    model_name written to the H5 root attributes.
    """
    setup_logging(verbose)

    import h5py

    from protspace.data.embedding.biocentral import (
        embed_sequences,
        resolve_embedder,
    )
    from protspace.data.io.fasta import parse_fasta

    sequences = parse_fasta(input)
    if not sequences:
        raise typer.BadParameter(f"No sequences found in {input}")

    output.mkdir(parents=True, exist_ok=True)

    for model_name in embedder:
        resolved = resolve_embedder(model_name)
        h5_path = output / f"{model_name}.h5"

        logger.info(f"Embedding with {model_name} → {h5_path}")
        embed_sequences(
            sequences,
            resolved,
            h5_path,
            batch_size=batch_size,
            half_precision=half_precision,
        )

        # Write model_name attr
        with h5py.File(h5_path, "a") as f:
            f.attrs["model_name"] = model_name

        typer.echo(f"Saved: {h5_path} (model_name={model_name})")
