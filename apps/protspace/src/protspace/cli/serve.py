"""protspace serve — launch Dash web frontend for interactive visualization."""

import warnings
from pathlib import Path
from typing import Annotated

import typer

from protspace.cli.app import PANEL_VISUALIZE, app

DEFAULT_PORT = 8050


@app.command(rich_help_panel=PANEL_VISUALIZE)
def serve(
    data: Annotated[
        Path,
        typer.Argument(
            help="Path to .parquetbundle file, .json file, or directory containing parquet files.",
            exists=True,
        ),
    ],
    port: Annotated[
        int,
        typer.Option(help="Port to run the server on."),
    ] = DEFAULT_PORT,
    pdb_zip: Annotated[
        Path | None,
        typer.Option(
            "--pdb-zip",
            help="Path to ZIP file containing PDB structures.",
            exists=True,
        ),
    ] = None,
) -> None:
    """Run a local viewer (web app preferred: protspace.app/explore).

    \b
    Most users should explore bundles in the hosted 2D viewer at
    https://protspace.app/explore — drag & drop, nothing to install.
    Use this command for offline/local viewing; it also renders 3D projections.
    """
    warnings.filterwarnings("ignore", category=SyntaxWarning)

    from protspace.main import main

    pdb_zip_str = str(pdb_zip) if pdb_zip else None
    main(data=str(data), port=port, pdb_zip=pdb_zip_str)
