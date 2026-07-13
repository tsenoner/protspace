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
            help="Annotations parquet file.",
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
    """
    setup_logging(verbose)

    import json

    import pyarrow.parquet as pq

    from protspace.data.annotations.encoding import stamp_format_version
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

    # Rename identifier column to protein_id if needed (bundle format).
    # Note: pa.Table.rename_columns() drops schema metadata, so the
    # format-version stamp below must happen *after* this rename.
    col_names = annotations_table.column_names
    if "identifier" in col_names and "protein_id" not in col_names:
        annotations_table = annotations_table.rename_columns(
            [("protein_id" if c == "identifier" else c) for c in col_names]
        )

    # Trust boundary: the -a annotations input is ASSUMED to be produced by the
    # same-version annotate/prepare pipeline (i.e. already percent-encoded).
    # We don't inspect its contents, so it's unconditionally stamped as v2 --
    # there is currently no other producer of this parquet to distrust.
    annotations_table = stamp_format_version(annotations_table)

    statistics_table = (
        pq.read_table(str(statistics)) if statistics is not None else None
    )

    output_path = output.with_suffix(".parquetbundle")
    write_bundle(
        [annotations_table, metadata_table, data_table],
        output_path,
        settings=settings_obj,
        statistics=statistics_table,
    )

    typer.echo(f"Saved: {output_path}")
