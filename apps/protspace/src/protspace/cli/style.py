"""protspace style — add annotation colors/styles to ProtSpace data files."""

import json
from typing import Annotated

import typer

from protspace.cli.app import PANEL_REFINE, app


@app.command(rich_help_panel=PANEL_REFINE)
def style(
    input_file: Annotated[
        str,
        typer.Argument(
            help="Path to .parquetbundle, .json file, or parquet directory."
        ),
    ],
    output_file: Annotated[
        str | None,
        typer.Argument(
            help="Output path. Not required for --dump-settings or --generate-template."
        ),
    ] = None,
    annotation_styles: Annotated[
        str | None,
        typer.Option(
            "--annotation-styles",
            help=(
                "Styles as inline JSON string or path to JSON file. "
                "See https://protspace.app/docs/guide/styling for format."
            ),
        ),
    ] = None,
    dump_settings: Annotated[
        bool,
        typer.Option("--dump-settings", help="Print stored settings and exit."),
    ] = False,
    generate_template: Annotated[
        bool,
        typer.Option(
            "--generate-template",
            help="Print a pre-filled styles template (values in frequency order) and exit.",
        ),
    ] = False,
) -> None:
    """Set colors, shapes & legend order on a bundle."""
    from protspace.utils.add_annotation_style import (
        add_annotation_styles,
        load_annotation_styles,
    )
    from protspace.utils.add_annotation_style import dump_settings as _dump_settings
    from protspace.utils.add_annotation_style import (
        generate_template as _generate_template,
    )

    if not (dump_settings or generate_template):
        if not annotation_styles:
            raise typer.BadParameter(
                "--annotation-styles is required when not using --dump-settings or --generate-template"
            )
        if not output_file:
            raise typer.BadParameter(
                "output_file is required when not using --dump-settings or --generate-template"
            )

    # A bundle the reader or the v3 encoder refuses (a corrupt part, a legacy
    # input v3 cannot represent) is a usage error, as in `protspace convert`,
    # not a traceback.
    try:
        if dump_settings:
            _dump_settings(input_file)
        elif generate_template:
            print(json.dumps(_generate_template(input_file), indent=2))
        else:
            styles = load_annotation_styles(annotation_styles)
            add_annotation_styles(input_file, styles, output_file)
    except ValueError as exc:
        raise typer.BadParameter(f"cannot style {input_file}: {exc}") from exc
