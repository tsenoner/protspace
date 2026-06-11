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
        reference_rule=Rule(
            where=[("protein_category", "")]
        ),  # matches all proteins; run_transfer keeps only those with a value
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


def test_cli_end_to_end_protein_id_bundle(tmp_path):
    """Real bundles key the id column 'protein_id'; the CLI must handle it and
    preserve that name on write while adding the overlay columns."""
    import io

    import h5py
    import pyarrow.parquet as pq
    from typer.testing import CliRunner

    from protspace.cli.app import app
    from protspace.data.io.bundle import read_bundle, write_bundle

    annotations = pa.table(
        {"protein_id": ["TRINITY_1", "P00001"], "protein_category": ["", "neurotoxin"]}
    )
    proj_meta = pa.table({"name": ["PCA 2"], "dims": [2]})
    proj_data = pa.table(
        {"id": ["TRINITY_1", "P00001"], "x": [0.0, 9.0], "y": [0.0, 0.0]}
    )
    bundle_path = tmp_path / "in.parquetbundle"
    write_bundle([annotations, proj_meta, proj_data], bundle_path)

    h5_path = tmp_path / "emb.h5"
    with h5py.File(h5_path, "w") as f:
        f.attrs["model_name"] = "test_model"
        f.create_dataset("TRINITY_1", data=np.array([0.0, 0.0], dtype=np.float32))
        f.create_dataset("P00001", data=np.array([0.1, 0.0], dtype=np.float32))

    out_path = tmp_path / "out.parquetbundle"
    result = CliRunner().invoke(
        app,
        [
            "transfer",
            "-b",
            str(bundle_path),
            "-e",
            str(h5_path),
            "-t",
            "protein_category",
            "-o",
            str(out_path),
            "--query-id-prefix",
            "TRINITY_",
            "--reference-id-prefix",
            "P0",
        ],
    )
    assert result.exit_code == 0, result.output
    parts, _ = read_bundle(out_path)
    table = pq.read_table(io.BytesIO(parts[0]))
    assert "protein_id" in table.column_names  # id column preserved for the web reader
    rows = {r["protein_id"]: r for r in table.to_pylist()}
    assert rows["TRINITY_1"]["protein_category__pred_value"] == "neurotoxin"
    assert rows["TRINITY_1"]["protein_category__pred_source"] == "P00001"
