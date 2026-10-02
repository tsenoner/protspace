"""protspace bundle — combine projections + annotations into a .parquetbundle."""

import logging
from pathlib import Path
from typing import Annotated

import typer

from protspace.cli.app import PANEL_STAGES, app, setup_logging
from protspace.cli.common_options import Opt_Verbose

logger = logging.getLogger(__name__)


@app.command(rich_help_panel=PANEL_STAGES)
def bundle(
    projections: Annotated[
        Path,
        typer.Option(
            "-p",
            "--projections",
            help="Directory containing projections_metadata.parquet and projections_data.parquet.",
            exists=True,
        ),
    ],
    annotations: Annotated[
        Path,
        typer.Option(
            "-a",
            "--annotations",
            help=(
                "Annotations parquet file. Output of `protspace annotate` and "
                "the prepare cache (tmp/all_annotations.parquet) is used as is; "
                "any other table without a protspace_format_version stamp is "
                "read as plain text (legacy v1 cells) and encoded."
            ),
            exists=True,
        ),
    ],
    output: Annotated[
        Path,
        typer.Option("-o", "--output", help="Output .parquetbundle file path."),
    ],
    statistics: Annotated[
        Path | None,
        typer.Option(
            "-s",
            "--statistics",
            help="Optional projection-statistics parquet file → 5th bundle part.",
            exists=True,
        ),
    ] = None,
    settings: Annotated[
        Path | None,
        typer.Option(
            "--settings",
            help="Optional settings JSON (e.g. auto-generated cluster styles) → 4th bundle part.",
            exists=True,
        ),
    ] = None,
    verbose: Opt_Verbose = 0,
) -> None:
    """Merge projections + annotations → .parquetbundle.

    \b
    Reads projections_metadata.parquet, projections_data.parquet from the
    projections directory and an annotations parquet file, then writes a
    single .parquetbundle file.

    The annotations' cell grammar comes from their protspace_format_version
    stamp. `protspace annotate` and the prepare annotation cache
    (tmp/all_annotations.parquet) hold v2 (percent-encoded) cells, so they pass
    through; any other unstamped table, such as one written by hand, is read as
    legacy v1 plain text and encoded for the bundle.
    """
    setup_logging(verbose)

    import json

    import pyarrow.parquet as pq

    from protspace.data.annotations.encoding import (
        BUNDLE_FORMAT_VERSION,
        has_format_version,
        is_annotation_cache,
        read_format_version,
        upgrade_cell_grammar,
    )
    from protspace.data.io.bundle import write_bundle

    settings_obj = json.loads(settings.read_text()) if settings is not None else None

    metadata_path = projections / "projections_metadata.parquet"
    data_path = projections / "projections_data.parquet"

    if not metadata_path.exists():
        raise typer.BadParameter(f"Missing: {metadata_path}")
    if not data_path.exists():
        raise typer.BadParameter(f"Missing: {data_path}")

    annotations_table = pq.read_table(str(annotations))
    metadata_table = pq.read_table(str(metadata_path))
    data_table = pq.read_table(str(data_path))

    # Trust boundary: the grammar is decided here, from the input's own stamp, and
    # before the rename below drops it. `annotate` and the pipeline's annotation
    # cache stamp v2, and a cache written before it carried the stamp is still
    # recognised as the pipeline's own v2 output; any other unstamped table is
    # user input in plain text, i.e. legacy v1, and is migrated explicitly.
    if has_format_version(annotations_table):
        grammar = read_format_version(annotations_table)
    elif is_annotation_cache(annotations_table):
        grammar = BUNDLE_FORMAT_VERSION
        logger.info(
            "%s is a protspace annotation cache without a protspace_format_version "
            "stamp; reading its cells as v2 (percent-encoded)",
            annotations,
        )
    else:
        grammar = 1
        logger.info(
            "%s has no protspace_format_version stamp; reading its cells as plain "
            "(v1) text",
            annotations,
        )

    # Rename identifier column to protein_id if needed (bundle format).
    col_names = annotations_table.column_names
    if "identifier" in col_names and "protein_id" not in col_names:
        annotations_table = annotations_table.rename_columns(
            [("protein_id" if c == "identifier" else c) for c in col_names]
        )

    try:
        annotations_table = upgrade_cell_grammar(annotations_table, grammar)
    except ValueError as exc:
        raise typer.BadParameter(f"{annotations}: {exc}") from exc

    statistics_table = (
        pq.read_table(str(statistics)) if statistics is not None else None
    )

    output_path = output.with_suffix(".parquetbundle")
    try:
        write_bundle(
            [annotations_table, metadata_table, data_table],
            output_path,
            settings=settings_obj,
            statistics=statistics_table,
        )
    except ValueError as exc:
        # The encoder validates the inputs (ids, projections, column types) and
        # says what is wrong with them; that is a usage error, not a crash.
        raise typer.BadParameter(str(exc)) from exc

    typer.echo(f"Saved: {output_path}")
