import pandas as pd
from typer.testing import CliRunner

from protspace.cli.app import app
from protspace.data.annotations.retrievers.uniprot_retriever import (
    ProteinAnnotations,
    UniProtRetriever,
)


def test_annotate_fasta_derives_missing_length_from_normalized_sequence(
    tmp_path, monkeypatch
):
    """The FASTA-backed CLI path must supply sequences to the annotation manager."""
    fasta = tmp_path / "input.fasta"
    fasta.write_text(">custom|custom_protein|description\nMPEPTIDE\n")
    output = tmp_path / "annotations.parquet"

    monkeypatch.setattr(
        UniProtRetriever,
        "fetch_annotations",
        lambda self: [
            ProteinAnnotations(
                identifier="custom_protein",
                annotations={"length": ""},
            )
        ],
    )

    result = CliRunner().invoke(
        app,
        [
            "annotate",
            "-i",
            str(fasta),
            "-a",
            "length",
            "-o",
            str(output),
        ],
    )

    assert result.exit_code == 0, result.output
    assert pd.read_parquet(output).loc[0, "length"] == "8"
