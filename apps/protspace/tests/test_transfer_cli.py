"""Tests for the transfer orchestration core and CLI registration."""

import logging

import numpy as np
import pyarrow as pa
import pytest

from protspace.analysis.classification import Rule
from protspace.cli.transfer import run_transfer
from protspace.data.annotations.encoding import stamp_format_version
from tests.cli_output import plain


def _three_protein_inputs(extra_columns=None):
    cols = {
        "identifier": ["TRINITY_1", "P00001", "P00002"],
        "protein_category": ["", "neurotoxin", "enzyme"],
    }
    if extra_columns:
        cols.update(extra_columns)
    annotations = pa.table(cols)
    # TRINITY_1 sits right on top of the neurotoxin reference P00001.
    embeddings = {
        "TRINITY_1": np.array([0.0, 0.0], dtype=np.float32),
        "P00001": np.array([0.05, 0.0], dtype=np.float32),
        "P00002": np.array([9.0, 0.0], dtype=np.float32),
    }
    return annotations, embeddings


def _projection_tables(identifiers, name="PCA 2"):
    """The long-format projection tables the pipeline writes, for ``identifiers``."""
    return (
        pa.table({"projection_name": [name], "dimensions": [2]}),
        pa.table(
            {
                "projection_name": [name] * len(identifiers),
                "identifier": list(identifiers),
                "x": [float(i) for i in range(len(identifiers))],
                "y": [0.0] * len(identifiers),
            }
        ),
    )


def _write_bundle_and_h5(tmp_path, *, id_col="protein_id", extra_columns=None):
    import h5py

    from protspace.data.io.bundle import write_bundle

    cols = {id_col: ["TRINITY_1", "P00001"], "protein_category": ["", "neurotoxin"]}
    if extra_columns:
        cols.update(extra_columns)
    annotations = stamp_format_version(pa.table(cols))
    proj_meta, proj_data = _projection_tables(["TRINITY_1", "P00001"])
    bundle_path = tmp_path / "in.parquetbundle"
    write_bundle([annotations, proj_meta, proj_data], bundle_path)

    h5_path = tmp_path / "emb.h5"
    with h5py.File(h5_path, "w") as f:
        f.attrs["model_name"] = "test_model"
        f.create_dataset("TRINITY_1", data=np.array([0.0, 0.0], dtype=np.float32))
        f.create_dataset("P00001", data=np.array([0.1, 0.0], dtype=np.float32))
    return bundle_path, h5_path


def test_run_transfer_predicts_for_query_with_missing_value():
    annotations, embeddings = _three_protein_inputs()
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
    # Provenance: the label came from the nearest neurotoxin reference, P00001.
    assert by_id["TRINITY_1"]["protein_category__pred_source"] == "P00001"


def test_run_transfer_treats_nan_as_missing():
    # A float-typed target column with a real NaN (not a parquet null) must be
    # treated as missing: the NaN query gets a prediction, and a NaN reference is
    # never enrolled as the literal label "nan".
    annotations = pa.table(
        {
            "identifier": ["TRINITY_1", "P00001", "P00002"],
            "score": [float("nan"), 1.0, float("nan")],
        }
    )
    embeddings = {
        "TRINITY_1": np.array([0.0, 0.0], dtype=np.float32),
        "P00001": np.array([0.05, 0.0], dtype=np.float32),
        "P00002": np.array([9.0, 0.0], dtype=np.float32),
    }
    out = run_transfer(
        annotations=annotations,
        embeddings=embeddings,
        transfer_columns=["score"],
        query_rule=Rule(id_prefixes=["TRINITY_"]),
        reference_rule=Rule(id_prefixes=["P0"]),
        k=1,
        metric="euclidean",
    )
    by_id = {r["identifier"]: r for r in out.to_pylist()}
    # TRINITY_1 (NaN) is a query missing a value -> transferred the only real
    # reference value (P00001's 1.0), never the P00002 NaN rendered as "nan".
    assert by_id["TRINITY_1"]["score__pred_value"] == "1.0"


def test_run_transfer_skips_proteins_without_embeddings():
    annotations, embeddings = _three_protein_inputs()
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
    # The nearest neighbour wins for any k here; only the confidence sees the
    # second vote (k=1 would give ~0.909).
    assert by_id["TRINITY_1"]["protein_category__pred_confidence"] == pytest.approx(
        0.4545, abs=1e-3
    )


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
    # Cosine-nearest neurotoxin reference is P00001 ([1,0] vs query [1,0.1]).
    assert by_id["TRINITY_1"]["protein_category__pred_source"] == "P00001"


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
    assert "nonexistent" in plain(result.output)


def test_cli_no_matching_embeddings_is_clean_error(tmp_path):
    import click
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
    assert result.exit_code == click.UsageError.exit_code, result.output
    assert isinstance(result.exception, SystemExit)
    assert "matching embedding" in plain(result.output)


def test_cli_no_query_match_is_clean_error(tmp_path):
    import click
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
    assert result.exit_code == click.UsageError.exit_code, result.output
    assert isinstance(result.exception, SystemExit)
    assert "matched no query proteins" in plain(result.output)


def test_cli_both_id_columns_present_is_clean_error(tmp_path):
    import click
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
    assert result.exit_code == click.UsageError.exit_code, result.output
    assert isinstance(result.exception, SystemExit)
    assert "both 'protein_id'" in plain(result.output)


def test_transfer_help_renders():
    """The only `--help` render test in the suite: the usage line alone always
    names the command, so check that a real option made it into the help."""
    from typer.testing import CliRunner

    from protspace.cli.app import app

    # Wide enough that Rich does not truncate the option names.
    result = CliRunner().invoke(app, ["transfer", "--help"], env={"COLUMNS": "200"})
    assert result.exit_code == 0, result.output
    assert "--query-id-prefix" in plain(result.output)


def test_cli_end_to_end_protein_id_bundle(tmp_path):
    """Real bundles key the id column 'protein_id'; the CLI must handle it and
    preserve that name on write while adding the overlay columns."""
    import io

    import h5py
    import pyarrow.parquet as pq
    from typer.testing import CliRunner

    from protspace.cli.app import app
    from protspace.data.io.bundle import read_bundle, write_bundle

    annotations = stamp_format_version(
        pa.table(
            {
                "protein_id": ["TRINITY_1", "P00001"],
                "protein_category": ["", "neurotoxin"],
            }
        )
    )
    proj_meta, proj_data = _projection_tables(["TRINITY_1", "P00001"])
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
    # Provenance column round-trips through the bundle for the web frontend.
    assert rows["TRINITY_1"]["protein_category__pred_source"] == "P00001"


def test_cli_migrates_legacy_cells_and_encodes_reserved_source_id(tmp_path):
    """A v1 transfer result becomes unambiguous v2 without changing parsed structure."""
    import io

    import h5py
    import pyarrow.parquet as pq
    from typer.testing import CliRunner

    from protspace.cli.app import app
    from protspace.data.io.bundle import PARQUET_BUNDLE_DELIMITER, read_bundle

    source_id = "P0|ref;literal%3B"
    # A genuine v1 container, assembled here rather than via write_bundle: every
    # write now emits v3, whose annotations part comes back stamped v2, so a
    # bundle built that way could not stand in for a legacy one.
    annotations = pa.table(
        {
            "protein_id": ["TRINITY_1", source_id],
            "protein_category": ["", "ACC (Name; part)|EXP"],
            "literal_percent": ["name%3Bpart", "plain"],
        }
    )
    proj_meta, proj_data = _projection_tables(["TRINITY_1", source_id])

    def _part(table):
        buf = io.BytesIO()
        pq.write_table(table, buf)
        return buf.getvalue()

    bundle_path = tmp_path / "legacy.parquetbundle"
    bundle_path.write_bytes(
        PARQUET_BUNDLE_DELIMITER.join(
            [_part(annotations), _part(proj_meta), _part(proj_data)]
        )
    )

    h5_path = tmp_path / "legacy.h5"
    with h5py.File(h5_path, "w") as handle:
        handle.attrs["model_name"] = "test_model"
        handle.create_dataset("TRINITY_1", data=np.array([1.0, 0.05], dtype=np.float32))
        handle.create_dataset(source_id, data=np.array([1.0, 0.0], dtype=np.float32))

    output_path = tmp_path / "out.parquetbundle"
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
            str(output_path),
            "--query-id-prefix",
            "TRINITY_",
            "--reference-id-prefix",
            "P0",
        ],
    )

    assert result.exit_code == 0, result.output
    output_parts, _ = read_bundle(output_path)
    output = pq.read_table(io.BytesIO(output_parts[0]))
    assert output.schema.metadata[b"protspace_format_version"] == b"2"
    rows = {row["protein_id"]: row for row in output.to_pylist()}
    assert rows[source_id]["protein_category"] == "ACC (Name%3B part)|EXP"
    assert rows["TRINITY_1"]["literal_percent"] == "name%253Bpart"
    assert rows["TRINITY_1"]["protein_category__pred_value"] == "ACC (Name%3B part)|EXP"
    assert (
        rows["TRINITY_1"]["protein_category__pred_source"] == "P0%7Cref%3Bliteral%253B"
    )


# ── Self-transfer: no query/reference rules (#393) ──────────────────────────
#
# "Apply EAT to all NA values in the current dataset": with no rules, every
# protein missing a value in the target column is a query and every protein
# holding one is a reference — no marker column, no second dataset.


def _transfer_rows(query_rule=None):
    """Transfer ``protein_category`` over the 3-protein fixture, keyed by id."""
    annotations, embeddings = _three_protein_inputs()
    out = run_transfer(
        annotations=annotations,
        embeddings=embeddings,
        transfer_columns=["protein_category"],
        query_rule=query_rule or Rule(),
        reference_rule=Rule(),
        k=1,
        metric="euclidean",
    )
    return {r["identifier"]: r for r in out.to_pylist()}


def test_run_transfer_without_rules_fills_missing_values():
    by_id = _transfer_rows()
    # TRINITY_1 is the only protein with a missing value; it sits on top of the
    # neurotoxin reference P00001.
    assert by_id["TRINITY_1"]["protein_category__pred_value"] == "neurotoxin"
    assert by_id["TRINITY_1"]["protein_category__pred_source"] == "P00001"


def test_run_transfer_without_rules_never_predicts_over_a_curated_value():
    by_id = _transfer_rows()
    for annotated in ("P00001", "P00002"):
        assert by_id[annotated]["protein_category__pred_value"] is None
        assert by_id[annotated]["protein_category"] != ""


def test_run_transfer_without_rules_never_uses_a_protein_as_its_own_source():
    for identifier, row in _transfer_rows().items():
        source = row["protein_category__pred_source"]
        if source is not None:
            assert source != identifier


def test_run_transfer_with_only_a_query_rule_still_finds_references():
    # Regression: an absent reference rule used to yield an empty reference set,
    # so the column was skipped and the bundle written back unchanged.
    by_id = _transfer_rows(query_rule=Rule(id_prefixes=["TRINITY_"]))
    assert by_id["TRINITY_1"]["protein_category__pred_value"] == "neurotoxin"


def test_cli_transfer_without_rules_fills_missing_values(tmp_path):
    import io

    import pyarrow.parquet as pq
    from typer.testing import CliRunner

    from protspace.cli.app import app
    from protspace.data.io.bundle import read_bundle

    bundle, h5 = _write_bundle_and_h5(tmp_path)
    out_path = tmp_path / "out.parquetbundle"
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
            str(out_path),
        ],
    )
    assert result.exit_code == 0, result.output
    parts, _ = read_bundle(out_path)
    rows = {r["protein_id"]: r for r in pq.read_table(io.BytesIO(parts[0])).to_pylist()}
    assert rows["TRINITY_1"]["protein_category__pred_value"] == "neurotoxin"
    # A reference protein gets no prediction. The overlay writes null; a v3
    # container stores "absent" as a -1 dictionary code and spells it back as ""
    # (a documented decode_v3 non-identity). The browser cannot tell the two
    # apart (readCategoricalStorageValue folds both into missing) but Dash can:
    # ArrowReader hands the raw cell out, so an "" is a value where a null was
    # not. get_unique_annotation_values skips "" for exactly that reason -- see
    # test_unique_annotation_values_skip_empty_strings.
    assert rows["P00001"]["protein_category__pred_value"] == ""


# ── Transfer on a legacy bundle the v2 browser keyed loosely ────────────────
#
# A v1/v2 bundle can hold rows v3 refuses: a repeated or null id, or an id
# column named other than protein_id/identifier.  `convert` and `style` key such
# rows as the v2 browser did; `transfer` reads the same dataset, so it neither
# crashes at the write nor transfers from rows the browser never showed.


def _write_legacy_bundle_and_h5(tmp_path, annotations, projected, names=("p", "p")):
    import io

    import h5py
    import pyarrow.parquet as pq

    from protspace.data.io.bundle import PARQUET_BUNDLE_DELIMITER

    def _part(table):
        buf = io.BytesIO()
        pq.write_table(table, buf)
        return buf.getvalue()

    meta = pa.table({"projection_name": [names[0]], "dimensions": [2]})
    data = pa.table(
        {
            "projection_name": [names[1]] * len(projected),
            "identifier": list(projected),
            "x": [float(i) for i in range(len(projected))],
            "y": [0.0] * len(projected),
        }
    )
    bundle_path = tmp_path / "legacy.parquetbundle"
    bundle_path.write_bytes(
        PARQUET_BUNDLE_DELIMITER.join(
            [_part(stamp_format_version(annotations)), _part(meta), _part(data)]
        )
    )
    h5_path = tmp_path / "legacy.h5"
    with h5py.File(h5_path, "w") as handle:
        handle.attrs["model_name"] = "test_model"
        handle.create_dataset("TRINITY_1", data=np.array([1.0, 0.05], dtype=np.float32))
        handle.create_dataset("P00001", data=np.array([1.0, 0.0], dtype=np.float32))
        handle.create_dataset("P00002", data=np.array([0.0, 1.0], dtype=np.float32))
    return bundle_path, h5_path


def _transfer_cli(bundle_path, h5_path, out_path):
    from typer.testing import CliRunner

    from protspace.cli.app import app

    return CliRunner().invoke(
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
        ],
    )


def test_cli_transfer_keys_a_legacy_bundle_as_the_v2_browser_did(tmp_path):
    from protspace.data.io.bundle import read_tables

    # P00001 twice: the earlier row's label is one the v2 browser never showed
    # (the later row replaced it), and a row with a null id it skipped.
    annotations = pa.table(
        {
            "protein_id": ["TRINITY_1", "P00001", "P00002", "P00001", None],
            "protein_category": ["", "hidden", "enzyme", "neurotoxin", "orphan"],
        }
    )
    bundle_path, h5_path = _write_legacy_bundle_and_h5(
        tmp_path, annotations, ["TRINITY_1", "P00001", "P00002"]
    )
    out_path = tmp_path / "out.parquetbundle"

    result = _transfer_cli(bundle_path, h5_path, out_path)

    assert result.exit_code == 0, result.output
    rows = read_tables(out_path)[0].to_pylist()
    assert sorted(row["protein_id"] for row in rows) == [
        "P00001",
        "P00002",
        "TRINITY_1",
    ]
    by_id = {row["protein_id"]: row for row in rows}
    assert by_id["P00001"]["protein_category"] == "neurotoxin"
    assert by_id["TRINITY_1"]["protein_category__pred_value"] == "neurotoxin"


def test_cli_transfer_reads_a_legacy_id_column_as_the_v2_browser_did(tmp_path):
    from protspace.data.io.bundle import read_tables

    annotations = pa.table(
        {
            "Entry": ["TRINITY_1", "P00001", "P00002"],
            "protein_category": ["", "neurotoxin", "enzyme"],
        }
    )
    bundle_path, h5_path = _write_legacy_bundle_and_h5(
        tmp_path, annotations, ["TRINITY_1", "P00001", "P00002"]
    )
    out_path = tmp_path / "out.parquetbundle"

    result = _transfer_cli(bundle_path, h5_path, out_path)

    assert result.exit_code == 0, result.output
    by_id = {row["protein_id"]: row for row in read_tables(out_path)[0].to_pylist()}
    assert by_id["TRINITY_1"]["protein_category__pred_value"] == "neurotoxin"


def test_cli_transfer_reports_a_legacy_bundle_v3_cannot_hold_as_a_usage_error(
    tmp_path,
):
    import click

    # Projection metadata and data that name different projections: the v2
    # reader tolerated it, the v3 encoder refuses it at the write.
    annotations = pa.table(
        {
            "protein_id": ["TRINITY_1", "P00001", "P00002"],
            "protein_category": ["", "neurotoxin", "enzyme"],
        }
    )
    bundle_path, h5_path = _write_legacy_bundle_and_h5(
        tmp_path,
        annotations,
        ["TRINITY_1", "P00001", "P00002"],
        names=("p", "q"),
    )
    out_path = tmp_path / "out.parquetbundle"

    result = _transfer_cli(bundle_path, h5_path, out_path)

    assert result.exit_code == click.UsageError.exit_code, result.output
    assert isinstance(result.exception, SystemExit)
    assert "cannot write" in plain(result.output)
    assert not out_path.exists()


# ── --report: every query's neighbours, beside the bundle ────────────────────


def _four_protein_inputs():
    """Two queries and three references on a line, so neighbour ranks are known."""
    annotations = pa.table(
        {
            "identifier": ["Q_near", "Q_far", "R_a", "R_b", "R_c"],
            "fam": ["", "", "alpha", "beta", "alpha"],
        }
    )
    embeddings = {
        "Q_near": np.array([0.1, 0.0], dtype=np.float32),
        "Q_far": np.array([30.0, 0.0], dtype=np.float32),
        "R_a": np.array([0.0, 0.0], dtype=np.float32),
        "R_b": np.array([1.0, 0.0], dtype=np.float32),
        "R_c": np.array([3.0, 0.0], dtype=np.float32),
    }
    return annotations, embeddings


def _run(annotations, embeddings, **kwargs):
    return run_transfer(
        annotations=annotations,
        embeddings=embeddings,
        transfer_columns=["fam"],
        query_rule=Rule(),
        reference_rule=Rule(),
        metric="euclidean",
        **kwargs,
    )


def test_run_transfer_report_has_one_row_per_query_at_k1():
    annotations, embeddings = _four_protein_inputs()
    report = []
    _run(annotations, embeddings, k=1, report=report)
    assert [(r["query_id"], r["rank"], r["reference_id"]) for r in report] == [
        ("Q_near", 1, "R_a"),
        ("Q_far", 1, "R_c"),
    ]
    near, far = report
    assert near["column"] == "fam"
    assert near["source_id"] == near["reference_id"]
    # The raw distance, not the reliability index derived from it.
    assert near["distance"] == pytest.approx(0.1, abs=1e-6)
    assert far["distance"] == pytest.approx(27.0, abs=1e-4)
    assert far["reliability"] == pytest.approx(0.5 / 27.5, abs=1e-6)


def test_run_transfer_report_ranks_k_neighbours():
    annotations, embeddings = _four_protein_inputs()
    report = []
    _run(annotations, embeddings, k=3, report=report)
    near = [r for r in report if r["query_id"] == "Q_near"]
    assert [r["rank"] for r in near] == [1, 2, 3]
    assert [r["reference_id"] for r in near] == ["R_a", "R_b", "R_c"]
    assert [r["reference_label"] for r in near] == ["alpha", "beta", "alpha"]
    assert [r["reference_distance"] for r in near] == pytest.approx(
        [0.1, 0.9, 2.9], abs=1e-5
    )
    # Every row of a query repeats its prediction.
    assert {(r["label"], r["source_id"]) for r in near} == {("alpha", "R_a")}


def test_run_transfer_report_shows_labels_decoded():
    annotations = pa.table(
        {"identifier": ["Q", "R"], "fam": ["", "Kunitz%3B BPTI|0.9"]}
    )
    embeddings = {
        "Q": np.array([0.0, 0.0], dtype=np.float32),
        "R": np.array([1.0, 0.0], dtype=np.float32),
    }
    report = []
    _run(annotations, embeddings, k=1, report=report)
    assert report[0]["label"] == "Kunitz; BPTI"
    assert report[0]["reference_label"] == "Kunitz; BPTI"


def test_run_transfer_report_leaves_the_table_unchanged():
    annotations, embeddings = _four_protein_inputs()
    assert _run(annotations, embeddings, k=3, report=[]).equals(
        _run(annotations, embeddings, k=3)
    )


def test_cli_transfer_writes_the_report(tmp_path):
    import csv

    from typer.testing import CliRunner

    from protspace.cli.app import app
    from protspace.data.io.bundle import read_tables
    from protspace.data.io.predictions import REPORT_COLUMNS

    bundle, h5 = _write_bundle_and_h5(tmp_path)
    args = ["transfer", "-b", str(bundle), "-e", str(h5), "-t", "protein_category"]
    with_report, without = (
        tmp_path / "with.parquetbundle",
        tmp_path / "without.parquetbundle",
    )
    report_path = tmp_path / "predictions.tsv"
    result = CliRunner().invoke(
        app, [*args, "-o", str(with_report), "--report", str(report_path)]
    )
    assert result.exit_code == 0, result.output
    assert CliRunner().invoke(app, [*args, "-o", str(without)]).exit_code == 0

    with open(report_path, newline="") as f:
        rows = list(csv.reader(f, delimiter="\t"))
    assert tuple(rows[0]) == REPORT_COLUMNS
    (row,) = (dict(zip(rows[0], r, strict=True)) for r in rows[1:])
    assert row["query_id"] == "TRINITY_1"
    assert row["label"] == "neurotoxin"
    assert row["reference_id"] == row["source_id"] == "P00001"
    # Cosine, k=1: the reliability index is 1 - distance, both written out.
    assert float(row["reliability"]) == pytest.approx(1 - float(row["distance"]))
    assert read_tables(with_report)[0].equals(read_tables(without)[0])


# ── --max-distance: near/distant by the nearest reference ────────────────────


def _rows(table):
    return {r["identifier"]: r for r in table.to_pylist()}


def test_run_transfer_max_distance_classes_queries_and_leaves_references_null():
    annotations, embeddings = _four_protein_inputs()
    rows = _rows(_run(annotations, embeddings, k=1, max_distance=0.5))
    assert rows["Q_near"]["fam__neighbor"] == "near"  # R_a at 0.1
    assert rows["Q_far"]["fam__neighbor"] == "distant"  # R_c at 27
    assert all(rows[r]["fam__neighbor"] is None for r in ("R_a", "R_b", "R_c"))
    # Without --skip-distant the distant query is still labelled.
    assert rows["Q_far"]["fam__pred_value"] == "alpha"


def test_run_transfer_max_distance_reads_the_nearest_reference_of_any_label():
    # At 0.6, k=3 votes alpha (R_a at 0.6, R_c at 2.4) over beta (R_b at 0.4), so
    # the source lies beyond the cutoff while the nearest reference is inside it.
    annotations, embeddings = _four_protein_inputs()
    embeddings["Q_near"] = np.array([0.6, 0.0], dtype=np.float32)
    rows = _rows(_run(annotations, embeddings, k=3, max_distance=0.5))
    assert rows["Q_near"]["fam__pred_source"] == "R_a"
    assert rows["Q_near"]["fam__neighbor"] == "near"


def test_run_transfer_skip_distant_leaves_distant_queries_unpredicted():
    annotations, embeddings = _four_protein_inputs()
    rows = _rows(
        _run(annotations, embeddings, k=1, max_distance=0.5, skip_distant=True)
    )
    assert rows["Q_far"]["fam__neighbor"] == "distant"
    assert rows["Q_far"]["fam__pred_value"] is None
    assert rows["Q_far"]["fam__pred_confidence"] is None
    assert rows["Q_near"]["fam__pred_value"] == "alpha"


def test_run_transfer_warns_when_skip_distant_leaves_every_query_unpredicted(caplog):
    annotations, embeddings = _four_protein_inputs()
    with caplog.at_level(logging.WARNING):
        rows = _rows(
            _run(annotations, embeddings, k=1, max_distance=0.01, skip_distant=True)
        )
    assert rows["Q_near"]["fam__pred_value"] is None
    assert rows["Q_far"]["fam__pred_value"] is None
    assert "Every query of 'fam' is beyond --max-distance 0.01" in caplog.text
    # The cause is the cutoff, not a column with nothing to fill.
    assert "No annotations were transferred" not in caplog.text


def test_run_transfer_auto_max_distance_is_the_reference_spacing_percentile():
    # Each reference's nearest other reference: R_a 1 (R_b), R_b 1 (R_a), R_c 2 (R_b).
    annotations, embeddings = _four_protein_inputs()
    report = []
    rows = _rows(_run(annotations, embeddings, k=1, max_distance="auto", report=report))
    expected = float(np.percentile([1.0, 1.0, 2.0], 95))
    assert [r["max_distance"] for r in report] == pytest.approx([expected] * 2)
    assert {r["query_id"]: r["neighbor"] for r in report} == {
        "Q_near": "near",
        "Q_far": "distant",
    }
    assert rows["Q_near"]["fam__neighbor"] == "near"
    assert rows["Q_far"]["fam__neighbor"] == "distant"


def test_run_transfer_auto_max_distance_excludes_self_by_index():
    # Two references on the same point: each one's nearest other is at 0, and it
    # is the duplicate, not itself, whichever order the search returns them in.
    annotations = pa.table({"identifier": ["Q", "R1", "R2"], "fam": ["", "a", "a"]})
    vec = np.array([1.0, 0.0], dtype=np.float32)
    embeddings = {"Q": np.array([1.0, 1.0], dtype=np.float32), "R1": vec, "R2": vec}
    report = []
    _run(annotations, embeddings, k=1, max_distance="auto", report=report)
    assert report[0]["max_distance"] == pytest.approx(0.0, abs=1e-6)
    assert report[0]["neighbor"] == "distant"


def test_run_transfer_auto_max_distance_needs_two_references():
    annotations = pa.table({"identifier": ["Q", "R"], "fam": ["", "a"]})
    embeddings = {
        "Q": np.array([0.0, 0.0], dtype=np.float32),
        "R": np.array([1.0, 0.0], dtype=np.float32),
    }
    with pytest.raises(ValueError, match="at least two references.*'fam'"):
        _run(annotations, embeddings, k=1, max_distance="auto")


def test_run_transfer_without_cutoff_drops_a_stale_neighbor_column():
    annotations, embeddings = _four_protein_inputs()
    first = _run(annotations, embeddings, k=1, max_distance=0.5)
    # Re-transfer the overlaid table: the curated column is unchanged, so the
    # same proteins are queries again, now without a cutoff.
    again = _run(first, embeddings, k=1)
    assert "fam__neighbor" not in again.column_names
    assert again.column_names.count("fam__pred_value") == 1


def test_cli_transfer_max_distance_writes_the_column_and_the_report(tmp_path):
    import csv

    from typer.testing import CliRunner

    from protspace.cli.app import app
    from protspace.data.io.bundle import read_tables

    bundle, h5 = _write_bundle_and_h5(tmp_path)
    out_path, report_path = tmp_path / "out.parquetbundle", tmp_path / "r.tsv"
    result = CliRunner().invoke(
        app,
        [
            "transfer",
            *("-b", str(bundle), "-e", str(h5), "-t", "protein_category"),
            *("-o", str(out_path), "--report", str(report_path)),
            *("--max-distance", "2", "--skip-distant"),
        ],
    )
    assert result.exit_code == 0, result.output
    rows = {r["protein_id"]: r for r in read_tables(out_path)[0].to_pylist()}
    assert rows["TRINITY_1"]["protein_category__neighbor"] == "near"
    with open(report_path, newline="") as f:
        (row,) = csv.DictReader(f, delimiter="\t")
    assert (row["neighbor"], float(row["max_distance"])) == ("near", 2.0)


@pytest.mark.parametrize(
    ("flags", "message"),
    [
        (["--max-distance", "-1"], "non-negative number or 'auto'"),
        (["--max-distance", "near"], "non-negative number or 'auto'"),
        (["--skip-distant"], "--skip-distant needs --max-distance"),
    ],
)
def test_cli_transfer_bad_cutoff_is_a_usage_error(tmp_path, flags, message):
    from typer.testing import CliRunner

    from protspace.cli.app import app

    bundle, h5 = _write_bundle_and_h5(tmp_path)
    out_path = tmp_path / "out.parquetbundle"
    result = CliRunner().invoke(
        app,
        [
            "transfer",
            *("-b", str(bundle), "-e", str(h5), "-t", "protein_category"),
            *("-o", str(out_path), *flags),
        ],
        env={"COLUMNS": "200"},
    )
    assert result.exit_code == 2
    assert message in plain(result.output)
    assert not out_path.exists()
