"""protspace style — add annotation colors/styles to ProtSpace data files."""

import json
from typing import Annotated

import typer

from protspace.cli.app import app


@app.command()
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
            help="Styles as inline JSON string or path to JSON file. See docs/styling.md for format.",
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
    """Add or update annotation styles (colors, shapes, legend ordering) in ProtSpace files."""
    from protspace.utils.add_annotation_style import (
        add_annotation_styles,
        load_annotation_styles,
    )
    from protspace.utils.add_annotation_style import dump_settings as _dump_settings
    from protspace.utils.add_annotation_style import (
        generate_template as _generate_template,
    )

    if dump_settings:
        _dump_settings(input_file)
        return

    if generate_template:
        template = _generate_template(input_file)
        print(json.dumps(template, indent=2))
        return

    if not annotation_styles:
        raise typer.BadParameter(
            "--annotation-styles is required when not using --dump-settings or --generate-template"
        )
    if not output_file:
        raise typer.BadParameter(
            "output_file is required when not using --dump-settings or --generate-template"
        )

    styles = load_annotation_styles(annotation_styles)
    add_annotation_styles(input_file, styles, output_file)
