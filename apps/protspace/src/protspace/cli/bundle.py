"""protspace bundle — combine projections + annotations into a .parquetbundle."""

import logging
from pathlib import Path
from typing import Annotated

import pyarrow.parquet as pq
import typer

from protspace.cli.app import app, setup_logging

logger = logging.getLogger(__name__)


@app.command()
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
    verbose: Annotated[
        int,
        typer.Option("-v", "--verbose", count=True, help="Increase verbosity."),
    ] = 0,
) -> None:
    """Combine projection and annotation parquet files into a .parquetbundle.

    \b
    Reads projections_metadata.parquet, projections_data.parquet from the
    projections directory and an annotations parquet file, then writes a
    single .parquetbundle file.
    """
    setup_logging(verbose)

    from protspace.data.io.bundle import write_bundle

    metadata_path = projections / "projections_metadata.parquet"
    data_path = projections / "projections_data.parquet"

    if not metadata_path.exists():
        raise typer.BadParameter(f"Missing: {metadata_path}")
    if not data_path.exists():
        raise typer.BadParameter(f"Missing: {data_path}")

    annotations_table = pq.read_table(str(annotations))
    metadata_table = pq.read_table(str(metadata_path))
    data_table = pq.read_table(str(data_path))

    # Rename identifier column to protein_id if needed (bundle format)
    col_names = annotations_table.column_names
    if "identifier" in col_names and "protein_id" not in col_names:
        annotations_table = annotations_table.rename_columns(
            [("protein_id" if c == "identifier" else c) for c in col_names]
        )

    output_path = output.with_suffix(".parquetbundle")
    write_bundle(
        [annotations_table, metadata_table, data_table],
        output_path,
    )

    typer.echo(f"Saved: {output_path}")
