"""protspace convert — rewrite a v1/v2 .parquetbundle in the current v3 format.

The upgrade path that outlives protspace 5.0.0: it keeps reading v1/v2 bundles and
3-D projections after the general readers drop them (not a deprecation entry).
"""

import logging
from pathlib import Path
from typing import Annotated

import typer

from protspace.cli.app import PANEL_REFINE, app, setup_logging
from protspace.cli.common_options import Opt_Verbose
from protspace.deprecations import (
    DEPRECATIONS,
    THREE_D_PROJECTION_READ,
    THREE_D_XY_VIEW,
)

logger = logging.getLogger(__name__)


@app.command(rich_help_panel=PANEL_REFINE)
def convert(
    input_file: Annotated[
        Path,
        typer.Argument(
            metavar="INPUT",
            help="The v1/v2 .parquetbundle to convert.",
            exists=True,
            dir_okay=False,
        ),
    ],
    output_file: Annotated[
        Path | None,
        typer.Argument(
            metavar="[OUTPUT]",
            help="Where to write the v3 bundle. Required unless --in-place.",
        ),
    ] = None,
    in_place: Annotated[
        bool,
        typer.Option("--in-place", help="Overwrite INPUT with its v3 conversion."),
    ] = False,
    flatten_3d: Annotated[
        bool,
        typer.Option(
            "--flatten-3d",
            help=(
                "Write each 3-D projection as 2-D, keeping its X/Y view (named "
                "'<name> (X/Y)'; its 3-D quality figures are dropped). Works on v3 "
                f"bundles too. {THREE_D_XY_VIEW} For those, recomputing with the "
                "2-D method (e.g. umap2) is better when you have the embeddings. "
                "Reading 3-D projections ends in protspace "
                f"{DEPRECATIONS[THREE_D_PROJECTION_READ].remove_in}."
            ),
        ),
    ] = False,
    verbose: Opt_Verbose = 0,
) -> None:
    """Upgrade a v1/v2 bundle to the v3 format.

    Reading v1/v2 bundles is deprecated and ends in protspace 5.0.0 everywhere
    but here: convert stays the upgrade path. Settings and statistics are kept;
    a bundle that is already v3 is left untouched unless --flatten-3d has 3-D
    projections to flatten.
    """
    setup_logging(verbose)

    from protspace.data.io.bundle import FLATTENED_SUFFIX, convert_bundle
    from protspace.data.io.bundle_v3 import CONTAINER_VERSION

    if output_file is None and not in_place:
        raise typer.BadParameter(
            "give an OUTPUT path, or pass --in-place to overwrite INPUT."
        )
    if output_file is not None and in_place:
        raise typer.BadParameter("pass either OUTPUT or --in-place, not both.")

    destination = input_file if in_place else output_file
    try:
        result = convert_bundle(input_file, destination, flatten_3d=flatten_3d)
    except ValueError as exc:
        raise typer.BadParameter(f"cannot convert {input_file}: {exc}") from exc

    if not result.written:
        typer.echo(f"{input_file} is already a v3 parquetbundle; nothing to do.")
    elif result.version == CONTAINER_VERSION:
        typer.echo(f"Rewrote {input_file} (v3) with 2-D projections: {destination}")
    else:
        typer.echo(f"Converted {input_file} (v{result.version}) to v3: {destination}")

    if result.flattened:
        typer.echo(
            "Flattened to their X/Y view: "
            + ", ".join(f"{n} -> {n}{FLATTENED_SUFFIX}" for n in result.flattened)
        )
        typer.echo(
            f"{THREE_D_XY_VIEW} Recompute those with the 2-D method (e.g. umap2) "
            "when you have the embeddings."
        )
    elif result.three_d:
        logger.warning(
            "%s holds 3-D projections (%s), kept as 3-D. Reading 3-D projections "
            "ends in protspace %s. Recompute them with the 2-D method (e.g. umap2) "
            "when you have the embeddings, or rerun with --flatten-3d to write "
            "their X/Y view as 2-D (protspace %s does this automatically). %s",
            input_file,
            ", ".join(result.three_d),
            DEPRECATIONS[THREE_D_PROJECTION_READ].remove_in,
            DEPRECATIONS[THREE_D_PROJECTION_READ].remove_in,
            THREE_D_XY_VIEW,
        )
