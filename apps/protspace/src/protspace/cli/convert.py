"""protspace convert — rewrite a v1/v2 .parquetbundle in the current v3 format."""

from pathlib import Path
from typing import Annotated

import typer

from protspace.cli.app import PANEL_REFINE, app, setup_logging
from protspace.cli.common_options import Opt_Verbose


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
    verbose: Opt_Verbose = 0,
) -> None:
    """Upgrade a v1/v2 bundle to the v3 format.

    Reading v1/v2 bundles is deprecated and ends in protspace 5.0.0. Settings
    and statistics are kept; a bundle that is already v3 is left untouched.
    """
    setup_logging(verbose)

    from protspace.data.io.bundle import convert_bundle
    from protspace.data.io.bundle_v3 import CONTAINER_VERSION

    if output_file is None and not in_place:
        raise typer.BadParameter(
            "give an OUTPUT path, or pass --in-place to overwrite INPUT."
        )
    if output_file is not None and in_place:
        raise typer.BadParameter("pass either OUTPUT or --in-place, not both.")

    destination = input_file if in_place else output_file
    try:
        version = convert_bundle(input_file, destination)
    except ValueError as exc:
        raise typer.BadParameter(f"cannot convert {input_file}: {exc}") from exc

    if version == CONTAINER_VERSION:
        typer.echo(f"{input_file} is already a v3 parquetbundle; nothing to do.")
    else:
        typer.echo(f"Converted {input_file} (v{version}) to v3: {destination}")
