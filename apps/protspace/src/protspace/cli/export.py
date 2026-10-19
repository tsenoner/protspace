"""protspace export — write a bundle as a tab-separated table."""

from pathlib import Path
from typing import Annotated

import typer

from protspace.cli.app import PANEL_REFINE, app, setup_logging
from protspace.cli.common_options import Opt_Verbose


@app.command(rich_help_panel=PANEL_REFINE)
def export(
    input_file: Annotated[
        Path,
        typer.Argument(
            metavar="INPUT",
            help="The .parquetbundle to export.",
            exists=True,
            dir_okay=False,
        ),
    ],
    output_file: Annotated[
        Path,
        typer.Argument(metavar="OUTPUT", help="Where to write the .tsv table."),
    ],
    projections: Annotated[
        list[str] | None,
        typer.Option(
            "-p",
            "--projection",
            help="Also write this projection's coordinates as <name>_x/_y (repeat).",
        ),
    ] = None,
    verbose: Opt_Verbose = 0,
) -> None:
    """Write a bundle as a TSV table: one row per protein.

    Columns are protein_id, the coordinates of each --projection, then every
    annotation (cluster_* and EAT columns included), as the web app shows them.
    """
    setup_logging(verbose)

    from protspace.data.io.atomic import staged_write
    from protspace.data.io.bundle import read_bundle_table

    try:
        table = read_bundle_table(input_file, projections or ())
    except ValueError as exc:
        raise typer.BadParameter(f"cannot export {input_file}: {exc}") from exc

    # A float cell as the web app's table export writes it: a whole number without
    # its ".0" (JavaScript's `String`), a float32 one at float32 precision, a
    # missing one empty.
    for name in table.columns:
        if table[name].dtype.kind == "f":
            text = table[name].astype(str).str.replace(r"\.0$", "", regex=True)
            table[name] = text.where(table[name].notna(), "")
    with staged_write(output_file) as staged:
        table.to_csv(staged, sep="\t", index=False, lineterminator="\n")
    typer.echo(f"Saved {len(table)} proteins to {output_file}")
