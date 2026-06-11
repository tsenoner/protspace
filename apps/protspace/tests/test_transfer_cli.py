"""Tests for the transfer orchestration core and CLI registration."""

import numpy as np
import pyarrow as pa
import pytest

from protspace.analysis.classification import Rule
from protspace.cli.transfer import run_transfer


def _inputs():
    annotations = pa.table(
        {
            "identifier": ["TRINITY_1", "P00001", "P00002"],
            "protein_category": ["", "neurotoxin", "enzyme"],
        }
    )
    # TRINITY_1 sits right on top of the neurotoxin reference P00001.
    embeddings = {
        "TRINITY_1": np.array([0.0, 0.0], dtype=np.float32),
        "P00001": np.array([0.05, 0.0], dtype=np.float32),
        "P00002": np.array([9.0, 0.0], dtype=np.float32),
    }
    return annotations, embeddings


def test_run_transfer_predicts_for_query_with_missing_value():
    annotations, embeddings = _inputs()
    out = run_transfer(
        annotations=annotations,
        embeddings=embeddings,
        transfer_columns=["protein_category"],
        query_rule=Rule(id_prefixes=["TRINITY_"]),
        reference_rule=Rule(where=[("protein_category", "")]),  # any non-empty ref
        k=1,
        metric="euclidean",
    )
    by_id = {r["identifier"]: r for r in out.to_pylist()}
    assert by_id["TRINITY_1"]["protein_category__pred_value"] == "neurotoxin"
    assert by_id["TRINITY_1"]["protein_category__pred_source"] == "P00001"
    assert by_id["TRINITY_1"]["protein_category__pred_confidence"] > 0.9


def test_run_transfer_skips_proteins_without_embeddings():
    annotations, embeddings = _inputs()
    embeddings.pop("TRINITY_1")  # no embedding -> cannot be a query
    with pytest.raises(ValueError, match="no query"):
        run_transfer(
            annotations=annotations,
            embeddings=embeddings,
            transfer_columns=["protein_category"],
            query_rule=Rule(id_prefixes=["TRINITY_"]),
            reference_rule=Rule(id_prefixes=["P0"]),
            k=1,
            metric="euclidean",
        )


def test_transfer_command_is_registered():
    from typer.testing import CliRunner

    from protspace.cli.app import app

    result = CliRunner().invoke(app, ["transfer", "--help"])
    assert result.exit_code == 0
    assert "transfer" in result.output.lower()
