"""protspace annotate — fetch protein annotations for a set of identifiers."""

import logging
from pathlib import Path
from typing import Annotated

import pyarrow.parquet as pq
import typer

from protspace.cli.app import app, setup_logging

logger = logging.getLogger(__name__)


@app.command()
def annotate(
    input: Annotated[
        Path,
        typer.Option(
            "-i",
            "--input",
            help="HDF5 or FASTA file (to extract protein identifiers).",
            exists=True,
        ),
    ],
    annotations: Annotated[
        list[str] | None,
        typer.Option(
            "-a",
            "--annotations",
            help="Annotation sources (repeatable): default, all, uniprot, interpro, taxonomy, or individual names.",
        ),
    ] = None,
    output: Annotated[
        Path,
        typer.Option("-o", "--output", help="Output parquet file path."),
    ] = Path("annotations.parquet"),
    scores: Annotated[
        bool,
        typer.Option(
            "--scores/--no-scores", help="Include annotation confidence scores."
        ),
    ] = True,
    verbose: Annotated[
        int,
        typer.Option("-v", "--verbose", count=True, help="Increase verbosity."),
    ] = 0,
) -> None:
    """Fetch protein annotations from UniProt, InterPro, and taxonomy databases.

    \b
    Extracts protein identifiers from the input file and fetches
    annotations, saving them as a parquet file.
    """
    setup_logging(verbose)

    import h5py
    import pyarrow as pa

    from protspace.data.annotations.manager import ProteinAnnotationManager
    from protspace.data.io.fasta import is_fasta_file
    from protspace.data.loaders.h5 import EMBEDDING_EXTENSIONS

    # Extract identifiers from input
    if is_fasta_file(input):
        from protspace.data.loaders.query import extract_identifiers_from_fasta

        headers = extract_identifiers_from_fasta(input)
    elif input.suffix.lower() in EMBEDDING_EXTENSIONS:
        from protspace.data.loaders.h5 import _collect_datasets, parse_identifier

        with h5py.File(input, "r") as f:
            pairs = _collect_datasets(f)
            headers = [parse_identifier(name) for name, _ in pairs]
    else:
        raise typer.BadParameter(
            f"Unsupported input type: {input.suffix}. Use HDF5 or FASTA."
        )

    if not headers:
        raise typer.BadParameter(f"No protein identifiers found in {input}")

    logger.info(f"Found {len(headers)} protein identifiers")

    # Resolve annotation names
    annotations_list = None
    if annotations:
        from protspace.data.annotations.configuration import AnnotationConfiguration

        names = []
        for item in annotations:
            for part in item.split(","):
                part = part.strip()
                if part:
                    names.append(part)
        if names:
            annotations_list = AnnotationConfiguration(names).user_annotations

    # Fetch annotations
    df = ProteinAnnotationManager(
        headers=headers,
        annotations=annotations_list,
        output_path=None,
    ).to_pd()

    if not scores:
        from protspace.data.annotations.scores import strip_scores_from_df

        df = strip_scores_from_df(df)

    # Save as parquet
    output.parent.mkdir(parents=True, exist_ok=True)
    table = pa.Table.from_pandas(df)
    pq.write_table(table, str(output))

    typer.echo(f"Saved annotations for {len(headers)} proteins to {output}")
