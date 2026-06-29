"""Tests for the transfer orchestration core and CLI registration."""

import logging

import numpy as np
import pyarrow as pa
import pytest

from protspace.analysis.classification import Rule
from protspace.cli.transfer import run_transfer


def _three_protein_inputs(extra_columns=None):
    cols = {
        "identifier": ["TRINITY_1", "P00001", "P00002"],
        "protein_category": ["", "neurotoxin", "enzyme"],
    }
    if extra_columns:
        cols.update(extra_columns)
    annotations = pa.table(cols)
    embeddings = {
        "TRINITY_1": np.array([0.0, 0.0], dtype=np.float32),
        "P00001": np.array([0.05, 0.0], dtype=np.float32),
        "P00002": np.array([9.0, 0.0], dtype=np.float32),
    }
    return annotations, embeddings


def _write_bundle_and_h5(tmp_path, *, id_col="protein_id", extra_columns=None):
    import h5py

    from protspace.data.io.bundle import write_bundle

    cols = {id_col: ["TRINITY_1", "P00001"], "protein_category": ["", "neurotoxin"]}
    if extra_columns:
        cols.update(extra_columns)
    annotations = pa.table(cols)
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
    return bundle_path, h5_path


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
    assert by_id["TRINITY_1"]["protein_category__pred_confidence"] > 0.9
    assert "protein_category__pred_source" not in out.column_names


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


def test_run_transfer_multi_column_skips_column_without_references(caplog):
    # Two transfer columns; the second has no references with a value and must be
    # skipped while the first still produces its overlay.
    annotations, embeddings = _three_protein_inputs(
        extra_columns={"other_col": ["", "", ""]}
    )
    with caplog.at_level(logging.WARNING):
        out = run_transfer(
            annotations=annotations,
            embeddings=embeddings,
            transfer_columns=["protein_category", "other_col"],
            query_rule=Rule(id_prefixes=["TRINITY_"]),
            reference_rule=Rule(id_prefixes=["P0"]),
            k=1,
            metric="euclidean",
        )
    assert "protein_category__pred_value" in out.column_names
    assert "other_col__pred_value" not in out.column_names
    assert "other_col" in caplog.text


def test_run_transfer_k_greater_than_one():
    annotations, embeddings = _three_protein_inputs()
    out = run_transfer(
        annotations=annotations,
        embeddings=embeddings,
        transfer_columns=["protein_category"],
        query_rule=Rule(id_prefixes=["TRINITY_"]),
        reference_rule=Rule(id_prefixes=["P0"]),
        k=2,
        metric="euclidean",
    )
    by_id = {r["identifier"]: r for r in out.to_pylist()}
    assert by_id["TRINITY_1"]["protein_category__pred_value"] == "neurotoxin"


def test_run_transfer_cosine_metric():
    annotations, embeddings = _three_protein_inputs()
    # Cosine needs non-parallel-to-axis vectors to be meaningful.
    embeddings = {
        "TRINITY_1": np.array([1.0, 0.1], dtype=np.float32),
        "P00001": np.array([1.0, 0.0], dtype=np.float32),
        "P00002": np.array([0.0, 1.0], dtype=np.float32),
    }
    out = run_transfer(
        annotations=annotations,
        embeddings=embeddings,
        transfer_columns=["protein_category"],
        query_rule=Rule(id_prefixes=["TRINITY_"]),
        reference_rule=Rule(id_prefixes=["P0"]),
        k=1,
        metric="cosine",
    )
    by_id = {r["identifier"]: r for r in out.to_pylist()}
    assert by_id["TRINITY_1"]["protein_category__pred_value"] == "neurotoxin"
    assert "protein_category__pred_source" not in out.column_names


def test_run_transfer_warns_when_nothing_transferred(caplog):
    # Query proteins all already have a value -> nothing to transfer -> warning.
    annotations = pa.table(
        {
            "identifier": ["TRINITY_1", "P00001"],
            "protein_category": ["already_set", "neurotoxin"],
        }
    )
    embeddings = {
        "TRINITY_1": np.array([0.0, 0.0], dtype=np.float32),
        "P00001": np.array([0.1, 0.0], dtype=np.float32),
    }
    with caplog.at_level(logging.WARNING):
        out = run_transfer(
            annotations=annotations,
            embeddings=embeddings,
            transfer_columns=["protein_category"],
            query_rule=Rule(id_prefixes=["TRINITY_"]),
            reference_rule=Rule(id_prefixes=["P0"]),
            k=1,
            metric="euclidean",
        )
    assert "protein_category__pred_value" not in out.column_names
    assert "No annotations were transferred" in caplog.text


def test_cli_bad_where_column_is_clean_error(tmp_path):
    from typer.testing import CliRunner

    from protspace.cli.app import app

    bundle, h5 = _write_bundle_and_h5(tmp_path)
    out = tmp_path / "out.parquetbundle"
    result = CliRunner().invoke(
        app,
        [
            "transfer",
            "-b",
            str(bundle),
            "-e",
            str(h5),
            "-t",
            "protein_category",
            "-o",
            str(out),
            "--query-where",
            "nonexistent~x",
            "--reference-id-prefix",
            "P0",
        ],
    )
    assert result.exit_code != 0
    assert not isinstance(result.exception, KeyError)
    assert "nonexistent" in result.output


def test_cli_no_matching_embeddings_is_clean_error(tmp_path):
    import h5py
    from typer.testing import CliRunner

    from protspace.cli.app import app

    bundle, _ = _write_bundle_and_h5(tmp_path)
    bad_h5 = tmp_path / "bad.h5"
    with h5py.File(bad_h5, "w") as f:
        f.attrs["model_name"] = "m"
        f.create_dataset("ZZZ", data=np.array([0.0, 0.0], dtype=np.float32))
    out = tmp_path / "out.parquetbundle"
    result = CliRunner().invoke(
        app,
        [
            "transfer",
            "-b",
            str(bundle),
            "-e",
            str(bad_h5),
            "-t",
            "protein_category",
            "-o",
            str(out),
            "--query-id-prefix",
            "TRINITY_",
            "--reference-id-prefix",
            "P0",
        ],
    )
    assert result.exit_code != 0
    assert not isinstance(result.exception, ValueError)


def test_cli_no_query_match_is_clean_error(tmp_path):
    from typer.testing import CliRunner

    from protspace.cli.app import app

    bundle, h5 = _write_bundle_and_h5(tmp_path)
    out = tmp_path / "out.parquetbundle"
    result = CliRunner().invoke(
        app,
        [
            "transfer",
            "-b",
            str(bundle),
            "-e",
            str(h5),
            "-t",
            "protein_category",
            "-o",
            str(out),
            "--query-id-prefix",
            "NOPE_",
            "--reference-id-prefix",
            "P0",
        ],
    )
    assert result.exit_code != 0
    assert not isinstance(result.exception, ValueError)


def test_cli_both_id_columns_present_is_clean_error(tmp_path):
    from typer.testing import CliRunner

    from protspace.cli.app import app

    bundle, h5 = _write_bundle_and_h5(
        tmp_path, extra_columns={"identifier": ["TRINITY_1", "P00001"]}
    )
    out = tmp_path / "out.parquetbundle"
    result = CliRunner().invoke(
        app,
        [
            "transfer",
            "-b",
            str(bundle),
            "-e",
            str(h5),
            "-t",
            "protein_category",
            "-o",
            str(out),
            "--query-id-prefix",
            "TRINITY_",
            "--reference-id-prefix",
            "P0",
        ],
    )
    assert result.exit_code != 0
    assert not isinstance(result.exception, KeyError)


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
    # Non-zero, near-parallel vectors so the default (cosine) metric is meaningful
    # (a zero query vector has no direction and yields a degenerate cosine distance).
    with h5py.File(h5_path, "w") as f:
        f.attrs["model_name"] = "test_model"
        f.create_dataset("TRINITY_1", data=np.array([1.0, 0.05], dtype=np.float32))
        f.create_dataset("P00001", data=np.array([1.0, 0.0], dtype=np.float32))

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
    assert "protein_category__pred_source" not in table.column_names
