"""protspace embed — generate protein embeddings from FASTA via Biocentral API."""

import logging
from pathlib import Path
from typing import Annotated

import typer

from protspace.cli.app import PANEL_STAGES, app, setup_logging
from protspace.cli.common_options import (
    EMBEDDER_HELP_LICENSE,
    EMBEDDER_HELP_MODELS,
    Backend,
    Opt_Backend,
    Opt_BatchSize,
    Opt_MaxLength,
    Opt_Verbose,
    build_embed_config,
)

logger = logging.getLogger(__name__)


@app.command(rich_help_panel=PANEL_STAGES)
def embed(
    input: Annotated[
        Path,
        typer.Option(
            "-i",
            "--input",
            help="Input FASTA file.",
            exists=True,
        ),
    ],
    embedder: Annotated[
        list[str],
        typer.Option(
            "-e",
            "--embedder",
            help=(
                "Biocentral model shortcut (repeatable for multi-model).\n"
                f"{EMBEDDER_HELP_MODELS}\n{EMBEDDER_HELP_LICENSE}"
            ),
        ),
    ],
    output: Annotated[
        Path,
        typer.Option("-o", "--output", help="Output directory (one H5 per model)."),
    ],
    backend: Opt_Backend = Backend.biocentral,
    batch_size: Opt_BatchSize = None,
    max_length: Opt_MaxLength = None,
    verbose: Opt_Verbose = 0,
) -> None:
    """FASTA → per-model HDF5 embeddings.

    \b
    Creates one HDF5 file per model in the output directory, with model_name
    written to the H5 root attributes. Embeddings are computed via the remote
    Biocentral API (default) or on a local GPU/CPU with --backend local.
    """
    setup_logging(verbose)

    import h5py

    from protspace.data.io.fasta import parse_fasta

    sequences = parse_fasta(input)
    if not sequences:
        raise typer.BadParameter(f"No sequences found in {input}")

    output.mkdir(parents=True, exist_ok=True)

    embed_config = build_embed_config(backend, batch_size, max_length)

    if backend == Backend.local:
        from protspace.data.embedding.local import embed_sequences

        def resolve(name: str) -> str:
            return name  # local backend takes the short key directly
    else:
        from protspace.data.embedding.biocentral import (
            embed_sequences,
            resolve_embedder,
        )

        resolve = resolve_embedder

    failed_models: list[str] = []

    for model_name in embedder:
        h5_path = output / f"{model_name}.h5"

        logger.info(f"Embedding with {model_name} ({backend.value}) → {h5_path}")
        try:
            embed_sequences(
                sequences,
                resolve(model_name),
                h5_path,
                embed_config=embed_config,
            )
        except (FileNotFoundError, ValueError) as e:
            # Same stage-failure shape as cli/prepare.py. The models are independent
            # (one .h5 each), so carry on and report every failure at the end rather
            # than abandoning the models that have not been tried yet.
            logger.error(str(e))
            failed_models.append(model_name)
            continue

        # Write model_name attr. Skipped on failure, so a run that embedded nothing
        # no longer leaves a stamped .h5 and an affirmative "Saved:" line behind.
        with h5py.File(h5_path, "a") as f:
            f.attrs["model_name"] = model_name

        typer.echo(f"Saved: {h5_path} (model_name={model_name})")

    if failed_models:
        if len(embedder) > 1:
            logger.error(
                "Embedding failed for %d of %d model(s): %s",
                len(failed_models),
                len(embedder),
                ", ".join(failed_models),
            )
        raise typer.Exit(1)
