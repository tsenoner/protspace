"""protspace serve — launch Dash web frontend for interactive visualization.

Deprecated, and removed in the release ``protspace.deprecations`` names for it.
"""

import logging
import warnings
from pathlib import Path
from typing import Annotated

import typer

from protspace.cli.app import PANEL_VISUALIZE, app, setup_logging
from protspace.deprecations import DEPRECATIONS, EXPLORE_URL, SERVE_COMMAND, warn

logger = logging.getLogger(__name__)

DEFAULT_PORT = 8050

# The help is built here, not in a docstring, so the version it names is the
# registered one.
_HELP = f"""Run the local Dash viewer (use protspace.app/explore instead).

\b
Deprecated: removed in protspace {DEPRECATIONS[SERVE_COMMAND].remove_in}.
Explore bundles in the hosted viewer at {EXPLORE_URL} instead:
drag & drop, nothing to install, and the file never leaves your browser.
"""


@app.command(rich_help_panel=PANEL_VISUALIZE, deprecated=True, help=_HELP)
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
    # Click's own `deprecated=True` line cannot say where to go instead.
    setup_logging(0)
    warn(SERVE_COMMAND, logger)

    warnings.filterwarnings("ignore", category=SyntaxWarning)

    from protspace.main import main

    pdb_zip_str = str(pdb_zip) if pdb_zip else None
    main(data=str(data), port=port, pdb_zip=pdb_zip_str)
