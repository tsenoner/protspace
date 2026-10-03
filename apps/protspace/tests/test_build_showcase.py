"""Tests for scripts/generate_examples/build_showcase.py (the showcase bundle build).

Offline: the pure helpers run on synthetic tables, and the two ``slow`` end-to-end
tests replace the network (UniProt, annotate) with fakes while running the real
``protspace bundle`` / ``style`` / ``stats``.
"""

from __future__ import annotations

import copy
import hashlib
import importlib.util
import json
import re
import sys
from collections import Counter
from pathlib import Path

import h5py
import numpy as np
import pandas as pd
import pyarrow as pa
import pyarrow.parquet as pq
import pytest
import requests

from protspace.data.annotations.encoding import has_format_version
from protspace.data.annotations.manager import UNIPROT_RELEASE_ATTR
from protspace.data.embedding.store import SEQUENCE_DIGEST_ATTR, sequence_digest
from protspace.data.io.bundle import (
    convert_bundle,
    create_settings_parquet,
    read_tables,
    write_bundle,
)

SCRIPT_DIR = Path(__file__).parent.parent / "scripts" / "generate_examples"
SCRIPT_PATH = SCRIPT_DIR / "build_showcase.py"
spec = importlib.util.spec_from_file_location("build_showcase", SCRIPT_PATH)
bs = importlib.util.module_from_spec(spec)
sys.modules["build_showcase"] = bs
spec.loader.exec_module(bs)

REPO_ROOT = Path(__file__).resolve().parents[3]

# ---------------------------------------------------------------------------
# Synthetic bundles
# ---------------------------------------------------------------------------


def _annotations(**columns) -> pa.Table:
    return pa.table({"protein_id": ["P1", "P2", "P3"], **columns})


def _projections(names=("PCA_2", "UMAP_2"), ids=("P1", "P2", "P3")):
    metadata = pa.table(
        {
            "projection_name": list(names),
            "dimensions": [2] * len(names),
            "info_json": [
                json.dumps(
                    {"metric": "euclidean", "quality": {"knn_overlap": {"value": 0.5}}}
                )
                for _ in names
            ],
        }
    )
    rows = [(n, i, float(k), float(k) + 0.5) for n in names for k, i in enumerate(ids)]
    data = pa.table(
        {
            "projection_name": [r[0] for r in rows],
            "identifier": [r[1] for r in rows],
            "x": [r[2] for r in rows],
            "y": [r[3] for r in rows],
            "z": pa.nulls(len(rows), pa.float64()),
        }
    )
    return metadata, data


def _legacy_blob(annotations, metadata, data, settings=None, statistics=None):
    """A legacy (v1/v2) container, laid out as protspace wrote one before v3:
    ``core(3) + settings? + statistics?``, with a zero-byte settings slot when
    there are statistics but no settings. What a paper source bundle, or a CLI
    from before format v3, hands the build."""
    parts = [bs.parquet_bytes(t) for t in (annotations, metadata, data)]
    if settings is not None or statistics is not None:
        parts.append(create_settings_parquet(settings) if settings is not None else b"")
    if statistics is not None:
        parts.append(bs.parquet_bytes(statistics))
    return bs.DELIMITER.join(parts)


def _parts(path: Path) -> list[bytes]:
    """A bundle file's parts as stored."""
    return path.read_bytes().split(bs.DELIMITER)


def _write_bundle(
    path: Path,
    annotations,
    *,
    settings=None,
    statistics=None,
    names=("PCA_2", "UMAP_2"),
    v3=False,
):
    """A legacy bundle, or (``v3=True``) a v3 one written by protspace's writer."""
    metadata, data = _projections(names, bs.row_ids(annotations))
    if v3:
        if not has_format_version(annotations):
            annotations = bs.stamp_format_version(annotations)
        write_bundle([annotations, metadata, data], path, settings, statistics)
    else:
        path.write_bytes(
            _legacy_blob(annotations, metadata, data, settings, statistics)
        )
    return path


# ---------------------------------------------------------------------------
# Encoding and display values
# ---------------------------------------------------------------------------


def test_the_cell_grammar_is_protspaces_own():
    """No vendored copy of the grammar or the container: one source of truth."""
    from protspace.data.annotations import encoding
    from protspace.data.io import bundle, bundle_v3

    assert bs.decode_field is encoding.decode_field
    assert (
        bs.migrate_legacy_annotation_table is encoding.migrate_legacy_annotation_table
    )
    assert bs.stamp_format_version is encoding.stamp_format_version
    assert bs.DELIMITER == bundle.PARQUET_BUNDLE_DELIMITER
    assert bs.CONTAINER_VERSION == bundle_v3.CONTAINER_VERSION == 3


def test_cell_labels():
    assert bs.cell_labels(" A |x; ;__NA__") == ["A"]
    # N/A is tested on the hit with its suffix, as the web does: "None|0.9" is
    # the category "None" in the legend, and an empty label is no category.
    assert bs.cell_labels("None|0.9;none;|0.9;NA|EXP") == ["None", "NA"]
    assert bs.cell_labels(None) == []
    assert bs.cell_labels(42) == ["42"]
    assert bs.first_label("B|x;A") == "B"
    assert bs.is_missing("") and not bs.is_missing("x")


def test_format_version_defaults_to_v1():
    table = pa.table({"a": [1]})
    assert bs.format_version(table) == 1
    assert bs.format_version(bs.stamp_format_version(table)) == 2


# ---------------------------------------------------------------------------
# Bundle helpers: extract_ann
# ---------------------------------------------------------------------------


def test_statistics_without_settings_keep_a_zero_byte_slot(tmp_path):
    stats = pa.table({"space_kind": ["projection"]})
    bundle = _write_bundle(
        tmp_path / "b.parquetbundle", _annotations(), statistics=stats
    )
    parts = bundle.read_bytes().split(bs.DELIMITER)
    assert len(parts) == 5 and parts[3] == b""
    read = bs.read_bundle(bundle)
    assert read.settings is None and read.statistics.num_rows == 1
    assert read.container_version is None  # legacy


def test_extract_ann_drops_internal_columns_and_names_the_id(tmp_path):
    table = pa.table(
        {
            "identifier": ["P1", "P2", "P3"],
            "sequence": ["M"] * 3,
            "organism_id": ["9606"] * 3,
            "ec": ["a", "b", "c"],
        }
    )
    bundle = _write_bundle(tmp_path / "b.parquetbundle", table)
    extracted = bs.extract_ann(bundle)
    assert extracted.column_names == ["protein_id", "ec"]


# ---------------------------------------------------------------------------
# Container versions: legacy inputs are read, the shipped file is written as v3
# ---------------------------------------------------------------------------

STATS = pa.table({"space_kind": ["projection"], "space_name": ["UMAP_2"]})
EC_CELLS = ["1.1.1.1 (a%3B b)|0.5", "2.7.11.1;3.1.1.4|IDA", "3.4.21.4"]


def _legacy_and_converted(tmp_path, annotations=None, settings=None):
    legacy = _write_bundle(
        tmp_path / "legacy.parquetbundle",
        annotations if annotations is not None else _annotations(ec=EC_CELLS),
        settings=settings if settings is not None else {"ec": {"categories": {}}},
        statistics=STATS,
    )
    converted = tmp_path / "converted.parquetbundle"
    convert_bundle(legacy, converted)
    return legacy, converted


def test_read_bundle_reads_a_legacy_and_a_v3_container_alike(tmp_path):
    legacy, converted = _legacy_and_converted(
        tmp_path, bs.stamp_format_version(_annotations(ec=EC_CELLS))
    )
    old, new = bs.read_bundle(legacy), bs.read_bundle(converted)

    assert old.container_version is None and len(_parts(legacy)) == 5
    assert new.container_version == 3 and len(_parts(converted)) == 6
    assert bs.format_version(new.annotations) == 2
    assert new.annotations.to_pylist() == old.annotations.to_pylist()
    assert new.settings == old.settings == {"ec": {"categories": {}}}
    assert new.statistics.equals(old.statistics)
    assert (
        new.metadata.column("projection_name").to_pylist()
        == old.metadata.column("projection_name").to_pylist()
    )
    assert bs.same_coordinates(new.projections, old.projections)
    assert bs.projection_ids(new.projections) == bs.projection_ids(old.projections)


def test_read_bundle_refuses_a_container_protspace_refuses(tmp_path):
    legacy = _write_bundle(tmp_path / "b.parquetbundle", _annotations(ec=EC_CELLS))
    six = tmp_path / "six.parquetbundle"
    six.write_bytes(bs.DELIMITER.join([legacy.read_bytes(), b"", b"", b""]))
    with pytest.raises(bs.BuildError, match="not a readable parquetbundle"):
        bs.read_bundle(six)


def test_rebuilding_a_legacy_bundle_writes_what_protspace_convert_writes(tmp_path):
    """finalize over a CLI's v2 output: the same bytes as converting the v2
    file it used to write, statistics carried byte for byte."""
    legacy, converted = _legacy_and_converted(
        tmp_path, bs.stamp_format_version(_annotations(ec=EC_CELLS))
    )
    source = bs.read_bundle(legacy)
    out = tmp_path / "out.parquetbundle"
    bs.rebuild_bundle(legacy, source.annotations, source.settings, out)

    assert out.read_bytes() == converted.read_bytes()
    assert _parts(out)[4] == _parts(legacy)[4]


def test_rebuilding_a_v3_bundle_keeps_its_projection_and_statistics_parts(tmp_path):
    """finalize over a v3 CLI's output: new annotations and settings, the
    projections and statistics as stored."""
    _, converted = _legacy_and_converted(tmp_path)
    source = bs.read_bundle(converted)
    table = bs.set_provenance(
        bs.drop_columns(source.annotations, []),
        {"example_id": "demo", "built_at": "2026-10-02T00:00:00+00:00"},
    )
    out = tmp_path / "out.parquetbundle"
    bs.rebuild_bundle(converted, table, {"ec": {"categories": {"a": {}}}}, out)

    built = bs.read_bundle(out)
    assert built.container_version == 3
    for index in (1, 2, 4):  # projection metadata, wide coordinates, statistics
        assert _parts(out)[index] == _parts(converted)[index]
    assert built.settings == {"ec": {"categories": {"a": {}}}}
    assert bs.read_provenance(built.annotations)["example_id"] == "demo"
    assert built.annotations.to_pylist() == source.annotations.to_pylist()

    # No settings given: the input's are kept.
    kept = tmp_path / "kept.parquetbundle"
    bs.rebuild_bundle(out, built.annotations, None, kept)
    assert bs.read_bundle(kept).settings == built.settings


def test_rebuild_bundle_refuses_a_table_without_its_grammar_stamp(tmp_path):
    legacy, _ = _legacy_and_converted(tmp_path)
    unstamped = _annotations(ec=EC_CELLS)
    with pytest.raises(bs.BuildError, match="protspace_format_version"):
        bs.rebuild_bundle(legacy, unstamped, None, tmp_path / "out.parquetbundle")
    assert not (tmp_path / "out.parquetbundle").exists()


def test_extract_ann_decodes_a_v3_output(tmp_path):
    table = pa.table(
        {"identifier": ["P1", "P2", "P3"], "ec": ["a", "b", "c"], "sequence": ["M"] * 3}
    )
    legacy = _write_bundle(tmp_path / "legacy.parquetbundle", table)
    v3 = _write_bundle(tmp_path / "v3.parquetbundle", table, v3=True)
    assert bs.extract_ann(v3).column_names == ["protein_id", "ec"]
    assert bs.extract_ann(v3).to_pylist() == bs.extract_ann(legacy).to_pylist()


def test_coordinates_compare_at_the_float32_a_v3_file_stores():
    long = pa.table(
        {
            "projection_name": ["U", "U"],
            "identifier": ["P2", "P1"],
            "x": pa.array([0.1, 2.0], pa.float64()),
            "y": pa.array([1 / 3, 4.0], pa.float64()),
        }
    )
    wide = pa.table(
        {
            "projection_name": ["U", "U"],
            "identifier": ["P1", "P2"],  # another row order
            "x": pa.array([2.0, 0.1], pa.float32()),
            "y": pa.array([4.0, 1 / 3], pa.float32()),
            "z": pa.nulls(2, pa.float32()),
        }
    )
    assert bs.same_coordinates(long, wide)
    assert bs.coordinates(long).column("z").null_count == 2  # no z axis
    moved = long.set_column(2, "x", pa.array([0.1001, 2.0], pa.float64()))
    assert not bs.same_coordinates(moved, wide)
    assert not bs.same_coordinates(long.slice(0, 1), wide)


def test_parse_projection_spec():
    assert bs.parse_projection_spec("UMAP_2=ProtT5 — UMAP 2, PCA_2") == [
        ("UMAP_2", "ProtT5 — UMAP 2"),
        ("PCA_2", "PCA_2"),
    ]
    assert bs.parse_projection_spec(["A=B"]) == [("A", "B")]
    with pytest.raises(bs.BuildError):
        bs.parse_projection_spec("A=X,B=X")


def test_select_projections_renames_reorders_and_keeps_coordinates():
    metadata, data = _projections()
    meta, out = bs.select_projections(
        metadata,
        data,
        [("UMAP_2", "ProtT5 — UMAP 2"), ("PCA_2", "ProtT5 — PCA 2")],
        drop_quality=True,
    )
    assert meta.column("projection_name").to_pylist() == [
        "ProtT5 — UMAP 2",
        "ProtT5 — PCA 2",
    ]
    assert all(
        "quality" not in json.loads(i) for i in meta.column("info_json").to_pylist()
    )
    assert out.column("projection_name").to_pylist()[:3] == ["ProtT5 — UMAP 2"] * 3
    renamed = {"UMAP_2": "ProtT5 — UMAP 2", "PCA_2": "ProtT5 — PCA 2"}
    names = [renamed[n] for n in data.column("projection_name").to_pylist()]
    assert bs.same_coordinates(out, data.set_column(0, "projection_name", [names]))


def test_select_projections_can_drop_one_and_rejects_unknown_names():
    metadata, data = _projections()
    meta, out = bs.select_projections(metadata, data, [("UMAP_2", "U")])
    assert meta.num_rows == 1 and set(out.column("projection_name").to_pylist()) == {
        "U"
    }
    assert "quality" in meta.column("info_json")[0].as_py()
    with pytest.raises(bs.BuildError, match="not found"):
        bs.select_projections(metadata, data, [("TSNE_2", "T")])


def test_projection_ids_reads_the_first_projection():
    _, data = _projections(ids=("B", "A", "C"))
    assert bs.projection_ids(data) == ["B", "A", "C"]


# ---------------------------------------------------------------------------
# Annotation tables
# ---------------------------------------------------------------------------


def test_order_columns_puts_the_insight_annotation_first():
    table = _annotations(a=[1, 2, 3], ec=["x"] * 3, species=["s"] * 3)
    assert bs.order_columns(table, ["species", "missing"]).column_names == [
        "protein_id",
        "species",
        "a",
        "ec",
    ]


def test_align_rows_follows_ids_and_adds_null_rows():
    table = _annotations(ec=["a", "b", "c"])
    aligned, absent = bs.align_rows(table, ["P3", "P9", "P1"])
    assert aligned.column("protein_id").to_pylist() == ["P3", "P9", "P1"]
    assert aligned.column("ec").to_pylist() == ["c", None, "a"]
    assert absent == ["P9"]


def test_concat_aligned_unions_columns_and_casts_mismatched_types():
    a = pa.table({"protein_id": ["P1"], "length": [10], "ec": ["x"]})
    b = pa.table({"identifier": ["P2"], "length": ["20"], "pfam": ["PF1"]})
    table = bs.concat_aligned([a, b])
    assert table.column_names == ["protein_id", "length", "ec", "pfam"]
    assert table.column("length").to_pylist() == ["10", "20"]
    assert table.column("pfam").to_pylist() == [None, "PF1"]


def _eat_paper():
    return pa.table(
        {
            "protein_id": ["Q1", "Q2", "R1"],
            "ec": ["", "", "1.1.1.1 (a)"],
            "protein_families": ["", "", "fam A"],
            "eat_split": ["query", "query", "reference"],
            "ec__pred_value": ["1.1.1.1 (a)", "2.2.2.2 (b)", None],
            "ec__pred_confidence": [0.9, 0.3, None],
            "species": ["old", "old", "old"],
            "sequence": ["M", "M", "M"],
        }
    )


def test_no_refill_guard_detects_a_leaked_query_value():
    table = _eat_paper().set_column(1, "ec", pa.array(["1.1.1.1 (a)", "", "x"]))
    assert bs.refill_violations(
        table, "eat_split", "query", ["ec", "protein_families"]
    ) == {"ec": ["Q1"]}
    with pytest.raises(bs.BuildError, match="hold-out leak"):
        bs.assert_no_refill(table, "eat_split", "query", ["ec"])
    # Several query values (hold-out and TrEMBL rows) guard together.
    assert bs.refill_violations(
        table, "eat_split", ["reference", "absent"], ["ec"]
    ) == {"ec": ["R1"]}
    bs.assert_no_refill(table, "eat_split", ["absent"], ["ec"])


# ---------------------------------------------------------------------------
# Provenance
# ---------------------------------------------------------------------------


def test_provenance_round_trip_keeps_the_format_stamp():
    table = bs.stamp_format_version(_annotations())
    table = table.replace_schema_metadata({**table.schema.metadata, b"pandas": b"{}"})
    stamped = bs.set_provenance(
        table,
        {
            "example_id": "three-finger-toxins",
            "protspace_version": "4.14.0",
            "uniprot_release": {
                "refreshed": {"release": "2026_03", "columns": ["pfam"]}
            },
            "pipeline": ["protspace annotate …"],
            "zenodo_doi": None,
        },
    )
    metadata = stamped.schema.metadata
    assert metadata[b"protspace_format_version"] == b"2"
    assert b"pandas" not in metadata and b"zenodo_doi" not in metadata
    found = bs.read_provenance(stamped)
    assert found["example_id"] == "three-finger-toxins"
    assert found["protspace_version"] == "4.14.0"
    assert found["uniprot_release"]["refreshed"]["release"] == "2026_03"
    assert found["pipeline"] == ["protspace annotate …"]
    with pytest.raises(bs.BuildError):
        bs.set_provenance(table, {"surprise": "x"})


def test_release_groups_label_every_column():
    groups = bs.release_groups(
        {"length": "source", "pfam": "refreshed", "ec_withheld": "withheld-truth"},
        [
            "protein_id",
            "length",
            "pfam",
            "ec_withheld",
            "cluster_elbow_U",
            "ec__pred_value",
            "species",
        ],
        {"refreshed": "2026_03", "source": "2026_01", "withheld-truth": "2026_03"},
    )
    assert groups["source"] == {"release": "2026_01", "columns": ["length"]}
    assert groups["refreshed"]["columns"] == ["pfam", "species"]
    # Cluster and transfer columns are computed by the build, not fetched.
    assert groups["computed"] == {
        "release": None,
        "columns": ["cluster_elbow_U", "ec__pred_value"],
    }
    assert groups["withheld-truth"]["columns"] == ["ec_withheld"]


# ---------------------------------------------------------------------------
# EAT gates
# ---------------------------------------------------------------------------


def _benchmark():
    return pa.table(
        {
            "protein_id": ["Q1", "Q2", "Q3", "Q4", "R1"],
            "eat_split": ["query", "query", "query", "query", "reference"],
            "ec_withheld": [
                "1.1.1.1 (a)|EXP",
                "2.2.2.2 (b)",
                "3.3.3.3 (c);4.4.4.4 (d)",
                "",
                None,
            ],
            "ec__pred_value": [
                "1.1.1.1 (a)",
                "2.2.2.9 (z)",
                "4.4.4.4 (d);3.3.3.3 (c)",
                "5.5.5.5",
                None,
            ],
            "ec__pred_confidence": [0.9, 0.8, 0.4, 0.99, None],
        }
    )


def test_eat_accuracy_scores_queries_with_truth():
    result = bs.eat_accuracy(
        _benchmark(),
        column="ec",
        truth_column="ec_withheld",
        split_column="eat_split",
        query_value="query",
        threshold=0.5,
    )
    # Q4 has no truth; Q1 and Q3 are exact (order-free label sets), Q2 is wrong.
    assert result == {
        "n": 3,
        "accuracy": 66.7,
        "threshold": 0.5,
        "n_at_threshold": 2,
        "accuracy_at_threshold": 50.0,
    }


def test_eat_gates():
    table = _benchmark()
    ok = bs.gate_eat_accuracy(
        table,
        {
            "column": "ec",
            "truth_column": "ec_withheld",
            "split_column": "eat_split",
            "query_value": "query",
            "min_n": 3,
            "min_accuracy": 66.7,
            "min_accuracy_at_threshold": 50.0,
        },
    )
    assert ok.status == "pass"
    transfers = bs.gate_eat_transfers(
        table,
        {
            "column": "ec",
            "expected_predicted": 4,
            "threshold": 0.5,
            "expected_at_threshold": 3,
        },
    )
    assert transfers.status == "pass"


def _eat_example():
    """Six rows of an EAT example: two held out, three TrEMBL, one reference."""
    return pa.table(
        {
            "protein_id": ["H1", "H2", "T1", "T2", "T3", "R1"],
            "eat_split": [
                "holdout",
                "holdout",
                "trembl",
                "trembl",
                "trembl",
                "reference",
            ],
            "protein_name": [
                "Short neurotoxin 1",
                "x",
                "Long neurotoxin 2",
                "Cytotoxin 3",
                "Three-finger toxin",
                "Short neurotoxin",
            ],
            "toxin_class": [None, None, None, None, None, "Type I"],
            "toxin_class_withheld": ["Type I", "Type II", None, None, None, None],
            "toxin_class__pred_value": [
                "Type I",
                "Type I",
                "Type II",
                "Type I",
                "Cyto",
                None,
            ],
            "toxin_class__pred_confidence": [0.8, 0.4, 0.6, 0.55, 0.3, None],
            "toxin_class__pred_source": ["R1", "R1", "R2", "R1", "R3", None],
        }
    )


def test_eat_accuracy_floors_for_a_split_the_build_draws():
    params = {
        "column": "toxin_class",
        "truth_column": "toxin_class_withheld",
        "split_column": "eat_split",
        "query_value": "holdout",
        "threshold": 0.5,
    }
    table = _eat_example()
    gate = bs.gate_eat_accuracy(table, {**params, "min_accuracy": 50.0})
    assert gate.status == "pass" and gate.data["accuracy"] == 50.0
    assert (
        gate.data["n_at_threshold"] == 1 and gate.data["accuracy_at_threshold"] == 100
    )
    assert (
        bs.gate_eat_accuracy(table, {**params, "min_accuracy": 51.0}).status == "fail"
    )
    assert bs.gate_eat_accuracy(table, {**params, "min_n": 3}).status == "fail"
    floors = {**params, "min_accuracy": 50.0, "min_accuracy_at_threshold": 100.0}
    assert bs.gate_eat_accuracy(table, floors).status == "pass"
    assert bs.gate_eat_accuracy(table, params).status == "fail"  # nothing checked


def test_eat_transfers_on_one_split_with_a_band_or_pending():
    params = {
        "column": "toxin_class",
        "split_column": "eat_split",
        "query_value": "trembl",
        "threshold": 0.5,
        "expected_predicted": 3,
    }
    table = _eat_example()
    pending = bs.gate_eat_transfers(table, params)
    assert pending.status == "pending" and pending.data == {
        "predicted": 3,
        "at_threshold": 2,
    }
    band = {**params, "expected_at_threshold": 2, "rel_tol": 0.05}
    assert bs.gate_eat_transfers(table, band).status == "pass"
    off = {**params, "expected_at_threshold": 3, "rel_tol": 0.05}
    assert bs.gate_eat_transfers(table, off).status == "fail"
    # The band is for the rings only: every query must still get a transfer.
    wide = {**band, "expected_predicted": 4, "rel_tol": 0.5}
    gate = bs.gate_eat_transfers(table, wide)
    assert gate.status == "fail" and "3 transfers, expected 4" in gate.detail


def test_eat_fanout_and_name_agreement():
    table = _eat_example()
    fanout = bs.gate_eat_fanout(table, {"column": "toxin_class", "max_fanout": 3})
    assert fanout.status == "pass" and fanout.data["largest"] == "R1"
    assert fanout.data["fanout"] == 3
    assert (
        bs.gate_eat_fanout(table, {"column": "toxin_class", "max_fanout": 2}).status
        == "fail"
    )
    params = {
        "column": "toxin_class",
        "split_column": "eat_split",
        "query_value": "trembl",
        "min_fraction": 0.5,
        "rules": [
            ["cytotoxin", "Cyto"],
            ["short neurotoxin", "Type I"],
            ["long neurotoxin", "Type II"],
        ],
    }
    agreement = bs.gate_name_agreement(table, params)
    # T1 long → Type II (agrees), T2 cytotoxin → Type I (disagrees), T3 states none.
    assert agreement.status == "pass"
    assert agreement.data["stated"] == 2 and agreement.data["agree"] == 1
    assert agreement.data["confusions"] == {"Cyto → Type I": 1}
    strict = bs.gate_name_agreement(table, {**params, "min_fraction": 0.85})
    assert strict.status == "fail"


# ---------------------------------------------------------------------------
# embed-build: mature chains, derived labels and the hold-out
# ---------------------------------------------------------------------------


def _entry(**fields):
    base = dict.fromkeys(bs.ENTRY_FIELDS, "")
    base.update(accession="A1", reviewed="reviewed", sequence="M" * 20 + "K" * 60)
    base.update(fields)
    return base


@pytest.mark.parametrize(
    ("fields", "start", "end", "derivation"),
    [
        (
            {
                "ft_signal": 'SIGNAL 1..21; /evidence="ECO:0000256|SAM:SignalP"',
                "ft_chain": 'CHAIN 22..80; /id="PRO_1"',
            },
            22,
            80,
            "chain",
        ),
        (  # the precursor with a propeptide: the Chain feature decides
            {
                "ft_signal": "SIGNAL 1..19",
                "ft_propep": "PROPEP 20..34",
                "ft_chain": 'CHAIN 35..80; /note="Irditoxin subunit A"',
            },
            35,
            80,
            "chain",
        ),
        (  # a mature chain sequenced as protein, a fuzzy end on a fragment
            {
                "ft_chain": 'CHAIN 1..>25; /note="Alpha-elapitoxin"',
                "fragment": "fragment",
            },
            1,
            25,
            "chain",
        ),
        ({"ft_peptide": 'PEPTIDE 1..60; /note="Toxin"'}, 1, 60, "peptide"),
        ({"ft_chain": "CHAIN 1..20; CHAIN 22..80"}, 22, 80, "chain"),  # the longest
        ({"ft_signal": "SIGNAL 1..21"}, 22, 80, "signal peptide removed"),
        (
            {"ft_signal": "SIGNAL 1..19", "ft_propep": "PROPEP 20..30"},
            31,
            80,
            "signal peptide and propeptide removed",
        ),
        ({"ft_chain": "CHAIN ?..80"}, 1, 80, "as deposited"),  # unknown start
        ({}, 1, 80, "as deposited"),
    ],
)
def test_mature_chain(fields, start, end, derivation):
    entry = _entry(**fields)
    chain = bs.mature_chain(entry)
    assert (chain.start, chain.end, chain.derivation) == (start, end, derivation)
    assert chain.sequence == entry["sequence"][start - 1 : end]
    assert chain.fragment == bool(fields.get("fragment"))


MOTIF = re.compile(r"G[YSHN]T(?=[A-Z]{2}C)|CLGSA(?=[DN][QE])")
ELAPID_SIGNAL = "MKTLLLTLVVVTIMCLDFGYT"
PROPEPTIDE = "DQLGLGRQQIDWGQG"


@pytest.mark.parametrize(
    ("sequence", "fields", "start", "derivation"),
    [
        # A precursor UniProt gives no feature: cut after the conserved end.
        (ELAPID_SIGNAL + "LICLTHKSAVFET", {}, 22, "signal motif"),
        # A fragment starting inside its signal peptide.
        ("VVTIVCLDLGSTLKCNKLIPLAY", {"fragment": "fragment"}, 13, "signal motif"),
        # The colubrid signal peptide ends before the propeptide.
        ("MKTLLLAVAVVAFVCLGSA" + PROPEPTIDE + "QAIGPPFGLC", {}, 20, "signal motif"),
        # A mature chain with no signal evidence stays as deposited.
        ("LKCNKLVPLAYKTCPAGKNLCY", {}, 1, "as deposited"),
        # Features win over the motif.
        (
            ELAPID_SIGNAL + "LICLTHKSAVFET",
            {"ft_chain": "CHAIN 1..34"},
            1,
            "chain",
        ),
    ],
)
def test_the_signal_motif_cuts_entries_without_features(
    sequence, fields, start, derivation
):
    entry = _entry(sequence=sequence, **fields)
    chain = bs.mature_chain(entry, MOTIF, 40)
    assert (chain.start, chain.derivation) == (start, derivation)
    assert chain.sequence == sequence[start - 1 :]
    assert bs.mature_chain(entry).derivation != "signal motif"  # opt-in


def test_queries_lose_the_propeptide_their_curated_homologue_lost():
    """The G1 mismatch in the colubrid group: SignalP's Chain keeps the
    propeptide the reviewed references were embedded without."""
    signal = "MKTLLLAVAVVAFVCLGSA"
    mature = "QAIGPPFGLCFQCNQKTSSD"
    entries = {
        "A0S864": _entry(
            accession="A0S864",
            sequence=signal + PROPEPTIDE + mature,
            ft_signal="SIGNAL 1..19",
            ft_propep="PROPEP 20..34",
            ft_chain="CHAIN 35..54",
        ),
        "C0HJD3": _entry(accession="C0HJD3", sequence=mature, ft_chain="CHAIN 1..20"),
        # Two mismatches, SignalP's chain after the signal peptide.
        "A0A193CHL1": _entry(
            accession="A0A193CHL1",
            reviewed="unreviewed",
            sequence=signal + "DQLGLGRQRIDWQQG" + mature,
            ft_signal='SIGNAL 1..19; /evidence="ECO:0000256|SAM:SignalP"',
            ft_chain='CHAIN 20..54; /evidence="ECO:0000256|SAM:SignalP"',
        ),
        # Too far from any curated propeptide: kept.
        "A0A2Z4N9R4": _entry(
            accession="A0A2Z4N9R4",
            reviewed="unreviewed",
            sequence=signal + "DQLGLRRPLISHSQYCFQCTTESLW",
            ft_signal="SIGNAL 1..19",
            ft_chain="CHAIN 20..44",
        ),
        # A reviewed entry keeps what its curators annotated.
        "P99999": _entry(
            accession="P99999",
            sequence=signal + PROPEPTIDE + mature,
            ft_signal="SIGNAL 1..19",
            ft_chain="CHAIN 20..54",
        ),
    }
    ids = list(entries)
    assert bs.curated_propeptides(entries) == [("A0S864", PROPEPTIDE)]
    options = {"signal_motif": MOTIF.pattern, "propeptide_max_mismatches": 5}
    chains = {c.accession: c for c in bs.mature_chains(entries, ids, options)}
    assert chains["A0A193CHL1"].sequence == mature
    assert chains["A0A193CHL1"].start == 35
    assert chains["A0A193CHL1"].derivation == "chain + homologous propeptide"
    assert chains["A0A193CHL1"].propeptide_from == "A0S864"
    assert chains["A0S864"].sequence == chains["C0HJD3"].sequence == mature
    assert chains["A0A2Z4N9R4"].derivation == "chain"
    assert chains["P99999"].start == 20
    # Without the option nothing is cut beyond UniProt's features.
    plain = {c.accession: c for c in bs.mature_chains(entries, ids)}
    assert plain["A0A193CHL1"].start == 20
    strict = bs.mature_chains(entries, ids, {"propeptide_max_mismatches": 1})
    assert {c.accession: c.start for c in strict}["A0A193CHL1"] == 20


def test_the_holdout_split_gate_pins_which_rows_are_held_out():
    table = pa.table(
        {
            "protein_id": ["P3", "P1", "P2", "T1"],
            "eat_split": ["holdout", "holdout", "reference", "trembl"],
        }
    )
    digest = bs.holdout_ids_sha256(["P1", "P3"])
    assert digest == hashlib.sha256(b"P1\nP3\n").hexdigest()
    pending = bs.gate_holdout_split(table, {})
    assert pending.status == "pending" and digest in pending.detail
    assert pending.data == {"held_out": 2, "split_sha256": digest}
    assert bs.gate_holdout_split(table, {"split_sha256": digest}).status == "pass"
    # Same counts, other rows: what a new NumPy stream would draw.
    swapped = table.set_column(
        1, "eat_split", pa.array(["holdout", "reference", "holdout", "trembl"])
    )
    gate = bs.gate_holdout_split(swapped, {"split_sha256": digest})
    assert gate.status == "fail" and gate.data["held_out"] == 2


def test_similarity_path_and_derived_labels():
    text = (
        "SIMILARITY: Belongs to the three-finger toxin family. Short-chain subfamily. "
        "Type I alpha-neurotoxin sub-subfamily. {ECO:0000305}."
    )
    path = bs.similarity_path(text, "three-finger toxin family")
    assert path == (
        "three-finger toxin family. Short-chain subfamily. "
        "Type I alpha-neurotoxin sub-subfamily"
    )
    assert (
        bs.similarity_path(
            "SIMILARITY: Belongs to the PLA2 family.", "three-finger toxin family"
        )
        is None
    )
    assert bs.similarity_path("", "x") is None
    rules = [
        ["type i alpha", "Type I"],
        ["type ii alpha", "Type II"],
        ["short-chain", "Short"],
    ]
    assert bs.derive_label(path, rules) == "Type I"
    assert bs.derive_label(path.replace("Type I ", "Type II "), rules) == "Type II"
    assert (
        bs.derive_label("three-finger toxin family. Short-chain subfamily", rules)
        == "Short"
    )
    assert bs.derive_label(None, rules) == ""


def test_the_holdout_split_depends_on_the_seed_alone():
    ids = [f"P{i:02d}" for i in range(30)]
    reviewed = {pid: i < 20 for i, pid in enumerate(ids)}
    strata = {
        pid: ("a" if i < 10 else "b" if i < 18 else "") for i, pid in enumerate(ids)
    }
    split = bs.holdout_split(ids, reviewed, strata, fraction=0.2, seed=7)
    counts = Counter(split.values())
    # round(0.2 · 10) of a, round(0.2 · 8) of b; P18-P19 are reviewed, unlabelled.
    assert counts == {"reference": 16, "holdout": 4, "trembl": 10}
    held = [pid for pid, s in split.items() if s == "holdout"]
    assert sum(strata[p] == "a" for p in held) == 2
    assert not {p for p in held if not strata[p]}  # unlabelled rows stay references
    # Row order and dict order do not matter (G4: a set's order did).
    shuffled = list(reversed(ids))
    again = bs.holdout_split(
        shuffled,
        dict(reversed(reviewed.items())),
        dict(reversed(strata.items())),
        fraction=0.2,
        seed=7,
    )
    assert again == split
    other = bs.holdout_split(ids, reviewed, strata, fraction=0.2, seed=8)
    assert other != split


def test_label_table_blanks_queries_and_keeps_the_truth():
    ids = ["P1", "P2", "P3", "T1", "T2"]
    boiga = (
        "SIMILARITY: Belongs to the three-finger toxin family. Ancestral subfamily. "
        "Boigatoxin sub-subfamily. {ECO:0000256|RuleBase:RU000001}."
    )
    short = (
        "SIMILARITY: Belongs to the three-finger toxin family. Short-chain subfamily."
    )
    entries = {
        "P1": _entry(accession="P1", cc_similarity=short),
        "P2": _entry(accession="P2", cc_similarity=short),
        "P3": _entry(accession="P3", cc_similarity=boiga),
        "T1": _entry(accession="T1", reviewed="unreviewed", cc_similarity=boiga),
        "T2": _entry(accession="T2", reviewed="unreviewed"),
    }
    labels = {
        "family": "three-finger toxin family",
        "keep_rule_labels": ["toxin_class"],
        "columns": [
            {
                "name": "toxin_class",
                "rules": [["ancestral", "Ancestral"], ["short-chain", "Short"]],
            },
        ],
    }
    holdout = {
        "split_column": "eat_split",
        "stratify": "toxin_class",
        "fraction": 0.5,
        "seed": 1,
        "columns": ["toxin_class"],
    }
    columns, summary = bs.label_table(ids, entries, labels, holdout)
    split = dict(zip(ids, columns["eat_split"], strict=True))
    assert split["T1"] == split["T2"] == "trembl"
    # round(0.5 · 2) of the two short-chain toxins, round(0.5 · 1) = 0 ancestral.
    assert Counter(split.values()) == {"trembl": 2, "holdout": 1, "reference": 2}
    for pid, cls, truth in zip(
        ids, columns["toxin_class"], columns["toxin_class_withheld"], strict=True
    ):
        if split[pid] == "holdout":
            assert cls is None and truth in ("Short", "Ancestral")
        elif split[pid] == "reference":
            assert cls in ("Short", "Ancestral") and truth is None
        else:
            assert cls is None and truth is None
    # TrEMBL's automatic rule label is kept aside, never shown as the class.
    assert columns["toxin_class_uniprot_rule"] == [None, None, None, "Ancestral", None]
    assert summary["holdout"]["seed"] == 1 and summary["split"]["holdout"] == 1
    assert summary["holdout"]["per_label"] == {"Short": 1}
    assert summary["uniprot_rule_labels"] == {"toxin_class": {"Ancestral": 1}}


def test_membership_files_and_their_pin(config, tmp_path):
    path = tmp_path / "m.txt"
    path.write_text("# query: x\nB2\nA1  # a comment\n\n")
    assert bs.read_membership(path) == ["B2", "A1"]
    path.write_text("A1\nA1\n")
    with pytest.raises(bs.BuildError, match="twice"):
        bs.read_membership(path)
    ctx = _context(config, "three-finger-toxins", tmp_path)
    ctx.dataset = {**ctx.dataset, "membership_file": str(path)}
    path.write_text("A1\n")
    with pytest.raises(bs.BuildError, match="sha256 differs"):
        bs.membership_ids(ctx)
    ctx.dataset["membership_sha256"] = bs.sha256_file(path)
    assert bs.membership_ids(ctx) == ["A1"]


def _h5(path, vectors):
    with h5py.File(path, "w") as handle:
        for key, vector in vectors.items():
            handle.create_dataset(key, data=np.asarray(vector, dtype=np.float32))
    return path


def test_the_embeddings_pin_gate(config, tmp_path):
    ctx = _context(config, "three-finger-toxins", tmp_path, dry_run=False)
    assert config.datasets["three-finger-toxins"]["embed"]["vectors_sha256"]  # pinned
    ctx.dataset = {**ctx.dataset, "embed": {"model": "prot_t5", "backend": "local"}}
    assert bs.embeddings_pin_gate(ctx).status == "fail"  # not built
    ctx.work.joinpath("embed").mkdir(parents=True)
    _h5(bs.embed_h5(ctx), {"B": [1, 2], "A": [3, 4]})
    vectors, count = bs.h5_vectors_sha256(bs.embed_h5(ctx))
    assert count == 2
    # The vectors' digest ignores the file layout and the insertion order.
    other = _h5(tmp_path / "other.h5", {"A": [3, 4], "B": [1, 2]})
    assert bs.h5_vectors_sha256(other)[0] == vectors
    pending = bs.embeddings_pin_gate(ctx)
    assert pending.status == "pending" and vectors in pending.detail
    embed = dict(ctx.dataset["embed"])
    ctx.dataset = {**ctx.dataset, "embed": {**embed, "vectors_sha256": vectors}}
    assert bs.embeddings_pin_gate(ctx).status == "pass"
    ctx.dataset["embed"]["sha256"] = "0" * 64
    assert bs.embeddings_pin_gate(ctx).status == "warn"
    ctx.dataset["embed"]["vectors_sha256"] = "1" * 64
    assert bs.embeddings_pin_gate(ctx).status == "fail"


# ---------------------------------------------------------------------------
# Missing values as the web reads them, and columns worth a legend (W10, G2, G13)
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("text", "missing"),
    [
        ("", True),
        ("  ", True),
        ("None", True),
        (" NONE ", True),
        ("N/A", True),
        ("NaN", True),
        ("__NA__", True),
        ("null", True),
        ("<N/A>", False),  # the web shows it as a category, so the gates count it
        ("none of these", False),
        ("Homo sapiens", False),
    ],
)
def test_missing_labels_follow_the_web(text, missing):
    assert bs.is_missing_label(text) is missing
    assert bs.cell_labels(text) == ([] if missing else [text.strip()])


def test_uninformative_columns_fail_unless_kept():
    table = pa.table(
        {
            "protein_id": ["P1", "P2", "P3"],
            "species": ["a", "b", "a"],
            "domain": ["Eukaryota"] * 3,
            "ec": ["", None, "none"],
            "fragment": ["yes", "", ""],  # a presence flag
            "always": ["yes", "yes", "yes"],
            "ec__pred_value": [None, None, None],  # overlay, not an annotation
        }
    )
    assert bs.uninformative_columns(table) == {
        "domain": "one value 'Eukaryota'",
        "ec": "all N/A",
        "always": "one value 'yes'",
    }
    view = {"annotation": "species", "tooltip": ["always"]}
    gate = bs.informative_gate(table, {"keep_uninformative": ["domain"]}, view)
    assert gate.status == "fail" and list(gate.data["blocking"]) == ["ec"]
    assert set(gate.data["kept"]) == {"domain", "always"}
    kept = bs.informative_gate(table, {"keep_uninformative": ["domain", "ec"]}, view)
    assert kept.status == "pass"


def test_root_and_literal_none_gates():
    table = pa.table(
        {
            "protein_id": ["P1", "P2", "P3", "P4"],
            "root": ["cellular organisms", "Viruses", "A", "B"],
            "predicted_transmembrane": ["alpha-helical", "none", "None|0.9", ""],
        }
    )
    gate = bs.taxonomy_root_gate(table)
    assert gate.status == "fail" and gate.data["unexpected"] == 2
    assert bs.taxonomy_root_gate(table.slice(0, 2)).status == "pass"
    # β-lactamase at 2026_03: all four top-level nodes, each a real root.
    tops = pa.table(
        {
            "protein_id": ["C", "V", "O", "U"],
            "root": [
                "cellular organisms",
                "Viruses",
                "other entries",
                "unclassified entries",
            ],
        }
    )
    assert bs.taxonomy_root_gate(tops).status == "pass"
    fly = pa.table(
        {
            "protein_id": ["H", "F"],
            "root": ["cellular organisms", "melanogaster subgroup"],
        }
    )
    gate = bs.taxonomy_root_gate(fly)  # two values, but one is a deep clade
    assert gate.status == "fail" and gate.data["unexpected"] == 1
    gate = bs.literal_none_gate(table, "predicted_transmembrane")
    # "none" is N/A in the web; "None|0.9" is a category "None" there.
    assert gate.status == "fail" and gate.data["count"] == 1
    assert (
        bs.literal_none_gate(table.slice(0, 1), "predicted_transmembrane").status
        == "pass"
    )
    assert bs.taxonomy_root_gate(table.drop_columns(["root"])) is None
    assert bs.literal_none_gate(table, "absent") is None


def test_rows_without_an_entry_take_the_papers_species_and_its_lineage():
    table = pa.table(
        {
            "protein_id": ["H1", "H2", "F1", "X1", "X2", "X3"],
            "root": [
                "cellular organisms",
                "cellular organisms",
                "cellular organisms",
                "None",
                "None",
                None,
            ],
            "genus": ["Homo", "Homo", "Drosophila", "None", "None", None],
            "species": [
                "Homo sapiens",
                "Homo sapiens",
                "Drosophila melanogaster",
                "None",
                "None",
                "",
            ],
            "pfam": ["PF1", "PF2", "PF3", "None", "nan", None],
            "length": ["10", "20", "30", "None", "None", None],
        }
    )
    paper = pa.table(
        {
            "protein_id": ["X1", "X2"],
            "species": ["Drosophila melanogaster", "Homo sapiens"],
        }
    )
    filled, report = bs.fill_missing_taxonomy(table, paper)
    rows = {r["protein_id"]: r for r in filled.to_pylist()}
    assert rows["X1"]["species"] == "Drosophila melanogaster"
    assert (
        rows["X1"]["genus"] == "Drosophila"
        and rows["X1"]["root"] == "cellular organisms"
    )
    assert rows["X2"]["genus"] == "Homo"
    assert rows["X1"]["pfam"] is None and rows["X2"]["length"] is None  # no "None" left
    assert rows["H1"] == table.to_pylist()[0]  # untouched
    assert report == {"filled": 2, "ids": ["X1", "X2"], "unresolved": ["X3"]}
    assert bs.fill_missing_taxonomy(table.slice(0, 3), paper)[1] == {"filled": 0}


# ---------------------------------------------------------------------------
# Provenance without machine paths (W12) and the owner's commands (W33)
# ---------------------------------------------------------------------------


def test_the_build_command_never_shows_a_machine_path():
    command = bs.build_command(
        [
            "build",
            "--only",
            "three-finger-toxins",
            "--cli-root",
            "/private/tmp/claude-501/x/scratchpad/wt/cli-build",
            "--out-root=/tmp/out",
            "--path",
            "nm_data=/Users/someone/nm",
            "--redo",
            "stats",
        ]
    )
    assert command == (
        "build_showcase.py build --only three-finger-toxins --cli-root $CLI "
        "--out-root=$OUT --path nm_data=$NM_DATA --redo stats"
    )
    assert "/tmp" not in command and "/Users" not in command
    # The joined --path form, and a scratch path in a value no option names.
    command = bs.build_command(
        [
            "build",
            "--path=nm_data=/private/tmp/x/nm",
            "--only",
            "/var/folders/ab/T/tmp1/x",
            "--release",
            "/Users/jane/r",
        ]
    )
    assert command == (
        "build_showcase.py build --path=nm_data=$NM_DATA --only $TMP --release ~/r"
    )
    # Abbreviated options would slip past the redaction: the parsers refuse them.
    with pytest.raises(SystemExit):
        bs.parse_args(["build", "--cli", "/private/tmp/cli"])
    assert bs.parse_args(["build", "--cli-root", "/c"]).cli_root == Path("/c")


# ---------------------------------------------------------------------------
# Catalog default views
# ---------------------------------------------------------------------------

CATALOG = """
export const EXAMPLE_DATASETS = [
  {
    id: 'demo',
    label: 'x',
    defaultView: {
      projection: 'ProtT5 — UMAP 2',
      annotation: 'protein_families',
      tooltip: ['species', "ec"],
    },
  },
  { id: 'venom-eat', label: 'y', defaultView: { projection: 'ProtT5 — PCA 2', annotation: 'ec' } },
  { id: 'old', label: 'z', url: './data/old.parquetbundle' },
];
"""


def test_parse_catalog_default_views():
    views = bs.parse_catalog_default_views(CATALOG)
    assert views == {
        "demo": [
            {
                "projection": "ProtT5 — UMAP 2",
                "annotation": "protein_families",
                "tooltip": ["species", "ec"],
            }
        ],
        "venom-eat": [
            {"projection": "ProtT5 — PCA 2", "annotation": "ec", "tooltip": []}
        ],
    }


def test_the_default_view_comes_from_the_catalog_alone(tmp_path):
    catalog = tmp_path / "example-datasets.ts"
    catalog.write_text(CATALOG)
    view = bs.resolve_default_view("venom-eat", catalog)
    assert view == {"projection": "ProtT5 — PCA 2", "annotation": "ec", "tooltip": []}
    for ds_id in ("old", "swissprot"):  # no defaultView, or not listed
        with pytest.raises(bs.BuildError, match="no defaultView"):
            bs.resolve_default_view(ds_id, catalog)
    with pytest.raises(bs.BuildError, match="does not exist"):
        bs.resolve_default_view("demo", tmp_path / "absent.ts")
    # The interim catalog lists the demo again: the same view is fine, another not.
    demo = "  { id: 'demo', defaultView: { projection: 'ProtT5 — UMAP 2', "
    catalog.write_text(
        CATALOG
        + demo
        + "annotation: 'protein_families', tooltip: ['species', 'ec'] } },"
    )
    assert bs.resolve_default_view("demo", catalog)["annotation"] == "protein_families"
    catalog.write_text(CATALOG + demo + "annotation: 'ec' } },")
    with pytest.raises(bs.BuildError, match="different defaultViews"):
        bs.resolve_default_view("demo", catalog)


def test_the_real_catalog_gives_every_showcase_example_a_view(config):
    catalog = config.path(config.build["catalog"])
    for ds_id in config.datasets:
        assert bs.resolve_default_view(ds_id, catalog)["projection"], ds_id


# ---------------------------------------------------------------------------
# Styles and settings
# ---------------------------------------------------------------------------


def test_filter_styles_drops_absent_values_and_resizes_the_pinned_legend():
    table = _annotations(
        species=["Homo sapiens", "Homo sapiens", None], ec=["a", "b", "c"]
    )
    styles = {
        "species": {
            "pinnedValues": ["Homo sapiens", "Drosophila melanogaster", ""],
            "maxVisibleValues": 3,
            "colors": {"Homo sapiens": "#F3C300", "Drosophila melanogaster": "#875692"},
        },
        "ec": {"pinnedValues": ["__REST__", ""], "maxVisibleValues": 10},
        "gone": {"colors": {"x": "#000"}},
    }
    kept, notes = bs.filter_styles(styles, table)
    assert kept["species"]["pinnedValues"] == ["Homo sapiens", ""]  # null reads as N/A
    assert kept["species"]["maxVisibleValues"] == 2
    assert kept["species"]["colors"] == {"Homo sapiens": "#F3C300"}
    # No N/A cell, so "" goes; __REST__ keeps the legend size.
    assert kept["ec"] == {"pinnedValues": ["__REST__"], "maxVisibleValues": 10}
    assert "gone" not in kept and len(notes) == 4


def test_filter_legend_keeps_present_and_na_categories():
    table = _annotations(protein_families=["A", "B|IC", ""])
    legend = {
        "sortMode": "manual",
        "categories": {"A": {"zOrder": 0}, "Z": {"zOrder": 1}, "__NA__": {"zOrder": 2}},
    }
    kept, notes = bs.filter_legend(legend, table, "protein_families")
    assert list(kept["categories"]) == ["A", "__NA__"] and len(notes) == 1


# ---------------------------------------------------------------------------
# Gates
# ---------------------------------------------------------------------------


def test_family_defects_find_the_parser_artefacts():
    table = _annotations(
        protein_families=[
            "cation transport ATPase (P-type) (TC 3",
            "In the N-terminal section; belongs to the X family",
            "cation transport ATPase (P-type) (TC 3.A.3) family",
        ]
    )
    defects = bs.family_defects(table, "protein_families")
    assert defects["truncated_tc"] == ["cation transport ATPase (P-type) (TC 3"]
    assert defects["section_pseudo"] == ["In the N-terminal section"]


def test_category_counts_and_label_gates():
    table = pa.table(
        {
            "protein_id": [f"P{i}" for i in range(6)],
            "species": ["H", "H", "H", "F", "F", "H"],
            "protein_families": [
                "kinase",
                "kinase|IC",
                "MHC",
                "kinase",
                "PBP",
                "MHC;kinase",
            ],
        }
    )
    counts = bs.gate_category_counts(
        table, {"column": "species", "expected": {"H": 4, "F": 2}}
    )
    assert counts.status == "pass"
    drift = bs.gate_category_counts(
        table, {"column": "species", "expected": {"H": 5}, "rel_tol": 0.1}
    )
    assert drift.status == "fail"
    shared = bs.gate_label_split(
        table,
        {
            "column": "protein_families",
            "by": "species",
            "label": "kinase",
            "expected_total": 4,
            "min_per_group": {"H": 2, "F": 1},
        },
    )
    assert shared.status == "pass" and shared.data["split"] == {"H": 3, "F": 1}
    exclusive = bs.gate_label_exclusive(
        table,
        {
            "column": "protein_families",
            "by": "species",
            "group": "H",
            "labels": ["MHC"],
        },
    )
    assert exclusive.status == "pass"
    leaky = bs.gate_label_exclusive(
        table,
        {
            "column": "protein_families",
            "by": "species",
            "group": "F",
            "labels": ["kinase", "absent"],
        },
    )
    assert leaky.status == "fail"
    assert (
        bs.gate_accession_label(
            table, {"accession": "P1", "column": "protein_families", "label": "kinase"}
        ).status
        == "pass"
    )
    assert (
        bs.gate_coverage(table, {"column": "species", "min_fraction": 0.9}).status
        == "pass"
    )


def test_check_default_view():
    columns = ["ec", "species", "gene_name", "ec__pred_value"]
    good = bs.check_default_view(
        {"projection": "U", "annotation": "ec", "tooltip": ["species"]}, columns, ["U"]
    )
    assert good.status == "pass"
    for view in (
        {"projection": "X", "annotation": "ec", "tooltip": []},
        {"projection": "U", "annotation": "gene_name", "tooltip": []},
        {"projection": "U", "annotation": "ec__pred_value", "tooltip": []},
        {"projection": "U", "annotation": "ec", "tooltip": ["ec"]},
        {"projection": "U", "annotation": "ec", "tooltip": ["pfam"]},
    ):
        assert bs.check_default_view(view, columns, ["U"]).status == "fail", view


def test_obsolete_rows():
    table = _annotations(reviewed=["Swiss-Prot", "", None], protein_name=["x", "", "y"])
    assert bs.obsolete_rows(table) == ["P2"]


def _gate_table(**extra):
    return bs.stamp_format_version(
        _annotations(
            ec=["a", "b", "c"],
            reviewed=["Swiss-Prot"] * 3,
            xref_pdb=["True", "False", "False"],
            protein_name=["x", "y", "z"],
            **extra,
        )
    )


def _common_gates(bundle):
    return {
        g.name: g
        for g in bs.common_gates(
            bundle,
            {
                "proteins": 3,
                "reviewed": "Swiss-Prot",
                "keep_uninformative": ["reviewed"],
            },
            {"projection": "U", "annotation": "ec"},
        )
    }


def test_common_gates_flag_leaks_membership_and_a_legacy_container(tmp_path):
    table = _gate_table(sequence=["M", "MK", "MKT"])
    bundle = bs.read_bundle(
        _write_bundle(tmp_path / "b.parquetbundle", table, names=("U",))
    )
    gates = _common_gates(bundle)
    assert gates["proteins"].status == "pass"
    assert gates["membership"].status == "pass"
    assert gates["no-internal-or-legacy"].status == "fail"
    # A legacy file is one from before the conversion: the build writes v3.
    assert gates["format-v3"].status == "fail"
    assert "legacy" in gates["format-v3"].detail
    assert gates["xref_pdb"].status == "pass"
    assert gates["reviewed"].status == "pass"
    assert gates["default-view"].status == "pass"
    assert gates["informative-columns"].status == "pass"
    assert "root-values" not in gates  # no root column, no gate
    ok, summary = bs.summarize(list(gates.values()))
    assert not ok and "2 fail" in summary


def test_common_gates_pass_a_v3_bundle_as_the_build_writes_it(tmp_path):
    legacy = _write_bundle(
        tmp_path / "legacy.parquetbundle", _gate_table(), names=("U",)
    )
    built = tmp_path / "built.parquetbundle"
    source = bs.read_bundle(legacy)
    bs.rebuild_bundle(legacy, source.annotations, {"ec": {}}, built)

    bundle = bs.read_bundle(built)
    assert bundle.container_version == 3 and len(_parts(built)) == 6
    gates = _common_gates(bundle)
    assert gates["format-v3"].status == "pass"
    assert gates["format-v3"].detail == "container v3, cell grammar v2"
    assert bs.summarize(list(gates.values()))[0], gates
    # The gates see what the legacy file held: the same proteins, cells and
    # coordinates (at the float32 the browser draws).
    assert bundle.annotations.to_pylist() == source.annotations.to_pylist()
    assert bs.same_coordinates(bundle.projections, source.projections)


def test_faithfulness_gate_needs_a_score_per_projection():
    metadata, _ = _projections()
    assert bs.faithfulness_gate(metadata).status == "pass"
    skipped = metadata.set_column(
        2,
        "info_json",
        pa.array(
            [
                json.dumps(
                    {
                        "quality": {
                            "knn_overlap": {"value": None, "skipped": "n_too_large"}
                        }
                    }
                )
            ]
            * 2
        ),
    )
    assert bs.faithfulness_gate(skipped).status == "fail"


# ---------------------------------------------------------------------------
# Clustering report
# ---------------------------------------------------------------------------


def _clusters(n=300, seed=0):
    rng = np.random.default_rng(seed)
    centers = np.array([[0, 0], [10, 0], [0, 10]])
    labels = [f"c{i % 3}" for i in range(n)]
    xy = np.array([centers[i % 3] + rng.normal(0, 0.5, 2) for i in range(n)])
    return xy, labels


def test_knn_agreement_separates_clustered_from_random_labels():
    xy, labels = _clusters()
    clustered = bs.knn_agreement(xy, labels, k=10)
    shuffled = bs.knn_agreement(
        xy, list(np.random.default_rng(1).permutation(labels)), k=10
    )
    assert clustered["kappa"] > 0.95
    assert abs(shuffled["kappa"]) < 0.15
    assert clustered["coverage"] == 1.0
    partial = bs.knn_agreement(
        xy, [None if i % 2 else lab for i, lab in enumerate(labels)], k=10
    )
    assert partial["coverage"] == 0.5


def test_legend_view_keeps_the_top_labels():
    assert bs.legend_view(["a", "a", "b", "c", None], top=1) == [
        "a",
        "a",
        "Other",
        "Other",
        None,
    ]


def test_clustering_report_writes_rows_markdown_and_thumbnails(tmp_path):
    pytest.importorskip("matplotlib")
    xy, labels = _clusters(60)
    ids = [f"P{i}" for i in range(60)]
    annotations = pa.table({"protein_id": ids, "fam": labels, "noise": ["x"] * 60})
    metadata = pa.table(
        {"projection_name": ["U"], "dimensions": [2], "info_json": ["{}"]}
    )
    data = pa.table(
        {"projection_name": ["U"] * 60, "identifier": ids, "x": xy[:, 0], "y": xy[:, 1]}
    )
    bundle = bs.Bundle(annotations, metadata, data)
    annotations = annotations.append_column(
        "cluster_elbow_U", pa.array(labels)
    ).append_column(
        "fam__pred_value",
        pa.array([lab if i % 5 == 0 else None for i, lab in enumerate(labels)]),
    )
    annotations = annotations.set_column(
        1,
        "fam",
        pa.array([None if i % 5 == 0 else lab for i, lab in enumerate(labels)]),
    )
    bundle = bs.Bundle(annotations, metadata, data)
    rows = bs.clustering_report(
        bundle,
        "demo",
        {"annotations": ["fam", "noise", "absent", "cluster_elbow_U"]},
        tmp_path,
        k=5,
    )
    assert rows[0]["annotation"] == "fam" and rows[0]["legend_kappa"] > 0.9
    assert any(r.get("error") for r in rows)
    # W21: k-means on the layout is never a candidate view.
    assert "cluster_elbow_U" not in {r["annotation"] for r in rows}
    # The EAT column's thumbnail draws its transfers as rings.
    assert (tmp_path / "report.md").is_file() and (
        tmp_path / "thumbs" / "fam__u.png"
    ).is_file()


def test_neighbourhood_gate():
    xy, labels = _clusters(90)
    ids = [f"P{i}" for i in range(90)]
    annotations = pa.table({"protein_id": ids, "fam": labels})
    data = pa.table(
        {"projection_name": ["U"] * 90, "identifier": ids, "x": xy[:, 0], "y": xy[:, 1]}
    )
    bundle = bs.Bundle(annotations, pa.table({"projection_name": ["U"]}), data)
    own = bs.gate_neighbourhood(
        bundle,
        {
            "projection": "U",
            "column": "fam",
            "value": "c0",
            "subset_column": "fam",
            "subset_labels": ["c0"],
            "k": 10,
            "min_mean": 0.9,
        },
    )
    assert own.status == "pass"
    away = bs.gate_neighbourhood(
        bundle,
        {
            "projection": "U",
            "column": "fam",
            "value": "c1",
            "accessions": ["P0"],
            "k": 10,
            "max_mean": 0.2,
        },
    )
    assert away.status == "pass"


# ---------------------------------------------------------------------------
# Small parsers
# ---------------------------------------------------------------------------


def test_small_parsers(tmp_path):
    assert bs.parse_fasta_text(">sp|P1|X_HUMAN desc\nMK\nT\n>Q2\nAA\n") == {
        "P1": "MKT",
        "Q2": "AA",
    }
    tsv = tmp_path / "t.tsv"
    tsv.write_text("Entry\tSequence\tSignal peptide\nP1\tMKT\t\nP2\tAA\tSIGNAL 1..2\n")
    assert bs.read_tsv_sequences(tsv) == {"P1": "MKT", "P2": "AA"}
    text = "# v\nuniprot_release: 2026_02\n---\nuniprot_release: 2026_03, unknown\n"
    assert bs.parse_run_log_releases(text) == {"2026_03", "unknown"}
    assert bs.parse_run_log_releases("uniprot_release: none\n") == set()
    assert bs.parse_run_log_releases("# no release line\n") is None
    fasta = tmp_path / "x.fasta"
    assert bs.write_fasta(fasta, {"P1": "MK"}, ["P1", "P2"]) == 1
    assert fasta.read_text() == ">P1\nMK\n"


def test_full_length_evidence_compares_the_fasta_with_uniprots_length(tmp_path):
    fasta = tmp_path / "full_length.fasta"
    bs.write_fasta(fasta, {"P1": "MKT", "P2": "MKTAA"}, ["P1", "P2"])
    table = _annotations(length=["3", "4", "9"])  # P2 is the mature length
    assert bs.full_length_evidence(fasta, table) == {
        "sequences": 2,
        "length_matches_uniprot": 1,
    }
    assert bs.full_length_evidence(fasta, _annotations())["length_matches_uniprot"] == 0


def _http_error(status):
    response = requests.Response()
    response.status_code = status
    return requests.HTTPError(f"{status}", response=response)


def test_uniprot_get_falls_back_only_on_an_answer_asking_again_cannot_change(
    monkeypatch,
):
    def answer(error):
        def get(url, params=None, **kwargs):
            raise error

        monkeypatch.setattr(bs, "get_with_retry", get)

    answer(_http_error(404))  # an unknown accession: the caller falls back
    assert bs.uniprot_get("https://rest.uniprot.org/uniprotkb/X") is None
    answer(_http_error(503))  # given up after the retries: never a silent gap
    with pytest.raises(bs.BuildError, match="answered 503"):
        bs.uniprot_get("https://rest.uniprot.org/uniprotkb/X")
    answer(requests.ConnectionError("reset"))
    with pytest.raises(bs.BuildError, match="could not be reached"):
        bs.uniprot_get("https://rest.uniprot.org/uniprotkb/X")
    answer(_http_error(400))
    with pytest.raises(bs.BuildError, match="refused the accessions A1…A2"):
        bs.fetch_uniprot_entries(["A1", "A2"])


@pytest.mark.parametrize(
    ("version", "ok"),
    [
        ("4.16.0", True),
        ("4.16.1.dev3+g1234567", True),
        ("5.0.0", True),
        ("4.15.0", False),  # no v3 container
        ("4.9.12", False),
        ("unknown", False),  # the checkout's protspace could not be imported
    ],
)
def test_the_cli_must_be_new_enough(version, ok):
    assert bs.cli_version_ok(version) is ok


def test_check_inputs_refuses_an_old_cli(config, tmp_path, monkeypatch):
    class OldCli(bs.Cli):
        def version(self):
            return "4.15.0"

    monkeypatch.setattr(bs, "current_uniprot_release", lambda: "2026_03")
    cli = OldCli(REPO_ROOT)
    ctx = _context(config, "three-finger-toxins", tmp_path, cli=cli, dry_run=False)
    with pytest.raises(bs.BuildError, match="protspace 4.15.0; the build needs 4.16"):
        bs.check_inputs_step(ctx).action()
    OldCli.version = lambda self: bs.MIN_CLI_VERSION
    bs.check_inputs_step(ctx).action()


# ---------------------------------------------------------------------------
# showcase.toml and the build plan
# ---------------------------------------------------------------------------


@pytest.fixture(scope="module")
def config():
    return bs.Config.load(bs.DEFAULT_CONFIG)


FINAL_IDS = ["demo", "three-finger-toxins", "human-fly", "beta-lactamase", "swissprot"]


def test_showcase_toml_lists_the_five_final_ids(config):
    assert list(config.datasets) == FINAL_IDS
    proteins = [d["proteins"] for d in list(config.datasets.values())[1:]]
    assert proteins == sorted(proteins)  # demo first, then ascending count
    assert config.datasets["swissprot"].get("large") is True
    assert config.datasets["demo"]["hosting"] == "repo"
    assert set(bs.KINDS) == {d["kind"] for d in config.datasets.values()}


def test_every_example_ships_its_umap_and_a_pca(config):
    """D3: a PCA in every example; the demo keeps both pLMs' projections."""
    for ds_id, dataset in config.datasets.items():
        names = [t for _, t in bs.parse_projection_spec(dataset["projections"])]
        assert names[0] == "ProtT5 — UMAP 2", ds_id
        assert "ProtT5 — PCA 2" in names, ds_id
    assert len(config.datasets["demo"]["projections"]) == 4
    swissprot = bs.parse_projection_spec(config.datasets["swissprot"]["projections"])
    assert ("PCA_2", "ProtT5 — PCA 2") in swissprot


def test_the_large_sets_skip_biocentral_and_say_why(config):
    """D4, W11: the skip is committed, not a local edit."""
    for ds_id in ("human-fly", "beta-lactamase", "swissprot"):
        stages = config.datasets[ds_id]["stages"]
        biocentral = [s for s in stages if "biocentral" in s["groups"]]
        assert biocentral and biocentral[0]["enabled"] is False, ds_id
    # The two small sets keep their predicted_* columns.
    assert config.datasets["demo"]["refresh_groups"] == ["all"]
    stages = config.datasets["three-finger-toxins"]["stages"]
    fetched = {g for s in stages if s.get("enabled", True) for g in s["groups"]}
    assert "predicted_subcellular_location" in fetched


def test_the_swissprot_statistics_list_follows_the_paper(config):
    listed = config.datasets["swissprot"]["stats_annotations"]
    assert "reviewed" not in listed and "xref_pdb" in listed  # W22


def test_every_recipe_is_complete(config):
    for ds_id, dataset in config.datasets.items():
        view = _view(config, ds_id)
        spec_ = bs.parse_projection_spec(dataset["projections"])
        assert spec_[0][1] == "ProtT5 — UMAP 2", ds_id  # UMAP first everywhere
        assert view["projection"] in [t for _, t in spec_], ds_id
        assert view["annotation"] in dataset["report"]["annotations"], ds_id
        assert view["annotation"] not in view.get("tooltip", []), ds_id
        styles = dataset.get("styles")
        if styles:
            assert isinstance(json.loads((SCRIPT_DIR / styles).read_text()), dict)
        if dataset.get("stats"):
            listed = dataset["stats_annotations"]  # G12: always explicit
            assert listed and not [
                c
                for c in listed
                if "__pred_" in c or c == "eat_split" or c.endswith("_withheld")
            ]
        for gate in dataset.get("gates", []):
            assert gate["type"] in {
                *bs.GATE_TYPES,
                *bs.BUNDLE_GATE_TYPES,
                *bs.CONTEXT_GATES,
            }, (ds_id, gate["type"])
        report = dataset["report"]["annotations"]
        assert not [a for a in report if a.startswith(bs.CLUSTER_COLUMN_PREFIX)], ds_id


def test_the_eat_example_opens_at_reliability_0_on_its_truth(config):
    dataset = config.datasets["three-finger-toxins"]
    assert dataset["envelope"] == {
        "eatOverlayEnabled": True,
        "eatConfidenceThreshold": 0,
    }
    view = _view(config, "three-finger-toxins")
    assert view["annotation"] == "toxin_class"
    assert view["tooltip"] == ["toxin_class_withheld", "species", "eat_split"]
    assert (
        dataset["transfer"]["metric"] == "euclidean" and dataset["transfer"]["k"] == 1
    )
    assert set(dataset["transfer"]["columns"]) == set(dataset["holdout"]["columns"])
    assert dataset["projection_params"] == {
        "n_neighbors": 25,
        "min_dist": 0.1,
        "random_state": 42,
    }
    assert dataset["stats_annotations"] == [
        "toxin_class",
        "toxin_subfamily",
        "family",
        "genus",
        "pfam",
    ]


def test_the_membership_file_matches_its_pin(config):
    dataset = config.datasets["three-finger-toxins"]
    path = bs.SCRIPT_DIR / dataset["membership_file"]
    assert bs.sha256_file(path) == dataset["membership_sha256"]
    ids = bs.read_membership(path)
    assert len(ids) == dataset["proteins"] and ids == sorted(ids)
    header = [line for line in path.read_text().splitlines() if line.startswith("#")]
    assert any(dataset["membership"] in line for line in header)
    assert any(dataset["membership_release"] in line for line in header)


def _view(config, ds_id):
    """The example's default view, from the web catalog as the build reads it."""
    return bs.resolve_default_view(ds_id, config.path(config.build["catalog"]))


def _context(config, ds_id, tmp_path, cli=None, **kwargs):
    return bs.Context(
        ds_id=ds_id,
        dataset=config.datasets[ds_id],
        config=config,
        out_root=tmp_path,
        cli=cli,
        release="2026_03",
        dry_run=kwargs.pop("dry_run", True),
        view=_view(config, ds_id),
        **kwargs,
    )


def test_stage_groups_are_cumulative_and_disabled_stages_opt_in(config, tmp_path):
    ctx = _context(config, "swissprot", tmp_path)
    assert bs.enabled_stage_groups(ctx) == [
        ["domain", "uniprot", "taxonomy"],
        ["domain", "uniprot", "taxonomy", "interpro"],
        ["domain", "uniprot", "taxonomy", "interpro", "ted"],
    ]
    ctx = _context(config, "swissprot", tmp_path, enabled_stages={"biocentral"})
    assert bs.enabled_stage_groups(ctx)[-1][-1] == "biocentral"


@pytest.mark.parametrize("ds_id", FINAL_IDS)
def test_the_build_plan_runs_the_cli_through_uv(config, tmp_path, ds_id):
    cli = bs.Cli(REPO_ROOT, dry_run=True)
    ctx = _context(config, ds_id, tmp_path, cli=cli)
    steps = bs.recipe_steps(ctx)
    names = [s.name for s in steps]
    assert names[0] == "check-inputs" and names[-4:] == [
        "stats",
        "bundle",
        "style",
        "finalize",
    ]
    commands = [s.command for s in steps if s.command]
    assert all(
        c[0] in {"prepare", "annotate", "embed", "transfer", "stats", "bundle", "style"}
        for c in commands
    )
    argv = cli.argv(commands[0])
    assert argv[:5] == [
        "uv",
        "run",
        "--frozen",
        "--project",
        str(bs.resolve_cli_project(REPO_ROOT)),
    ]
    stats = [c for c in commands if c[0] == "stats"]
    if config.datasets[ds_id].get("stats"):
        assert (
            stats and "auto" not in stats[0][stats[0].index("--stats-annotation") + 1]
        )
    else:
        assert not stats
    pipeline = bs.pipeline_commands(ctx)
    assert all(str(tmp_path) not in line for line in pipeline)


def test_the_eat_example_embeds_projects_holds_out_and_transfers(config, tmp_path):
    cli = bs.Cli(REPO_ROOT, dry_run=True)
    ctx = _context(config, "three-finger-toxins", tmp_path, cli=cli)
    steps = {s.name: s for s in bs.recipe_steps(ctx)}
    assert list(steps)[:4] == ["check-inputs", "entries", "sequences", "embed"]
    embed = steps["embed"]
    assert embed.extras == ("local",)  # the on-device backend's dependencies
    assert cli.argv(embed.command, embed.extras)[5:8] == [
        "--extra",
        "local",
        "protspace",
    ]
    assert embed.command[embed.command.index("--backend") + 1] == "local"
    assert (
        str(tmp_path / "three-finger-toxins" / "work" / "mature.fasta") in embed.command
    )
    fetch = steps["fetch-1"].command
    # Mature-chain embeddings in, full-length sequences for the annotation
    # sources, and the projections kept with their parameters spelled out.
    assert fetch[fetch.index("-f") + 1].endswith("full_length.fasta")
    assert fetch[fetch.index("-m") + 1] == "umap2,pca2"
    for option, value in (
        ("--n-neighbors", "25"),
        ("--min-dist", "0.1"),
        ("--random-state", "42"),
    ):
        assert fetch[fetch.index(option) + 1] == value
    transfer = steps["transfer"].command
    assert transfer[transfer.index("--k") + 1] == "1"
    assert transfer[transfer.index("--metric") + 1] == "euclidean"
    assert [transfer[i + 1] for i, a in enumerate(transfer) if a == "-t"] == [
        "toxin_class",
        "toxin_subfamily",
    ]
    assert [
        transfer[i + 1] for i, a in enumerate(transfer) if a == "--query-where"
    ] == [
        "eat_split~holdout",
        "eat_split~trembl",
    ]
    names = list(steps)
    assert names.index("transfer") < names.index("stats")  # stats see the transfer
    assert bs.find_projection_source(ctx) == ctx.work / "ann" / "data.parquetbundle"
    assert bs.dataset_embeddings(ctx) == [
        f"{ctx.work / 'embed' / 'prot_t5.h5'}:prot_t5"
    ]


def test_execute_skips_finished_steps_until_one_reruns(config, tmp_path):
    ctx = _context(config, "demo", tmp_path, dry_run=False)
    calls = []
    steps = [
        bs.Step(n, f"cmd {n}", lambda n=n: calls.append(n)) for n in ("a", "b", "c")
    ]
    bs.execute(ctx, steps)
    assert calls == ["a", "b", "c"]
    calls.clear()
    bs.execute(ctx, steps)
    assert calls == []
    steps[1] = bs.Step("b", "cmd b changed", lambda: calls.append("b"))
    bs.execute(ctx, steps)
    assert calls == ["b", "c"]  # a changed step re-runs everything after it


def _write_manifest_module():
    return bs.manifest_writer()


def test_stamped_provenance_reads_back_through_write_manifest(tmp_path):
    """The manifest writer reads the nested {group: {release, columns}} form the
    build stamps: one release per group, and a group without one left out."""
    groups = bs.release_groups(
        {"ec": "source", "pfam": "refreshed"},
        ["protein_id", "ec", "pfam", "cluster_elbow_U"],
        {"refreshed": "2026_03", "source": "2025_03"},
    )
    table = bs.set_provenance(
        bs.stamp_format_version(_annotations(ec=["a", "b", "c"], pfam=["x", "y", "z"])),
        {
            "example_id": "three-finger-toxins",
            "protspace_version": "4.14.0",
            "git_sha": "abc",
            "uniprot_release": groups,
            "membership_release": "2025_03",
            "built_at": "2026-10-01T00:00:00+00:00",
            "command": "build_showcase.py build --only three-finger-toxins",
            "pipeline": ["protspace annotate …"],
        },
    )
    bundle = _write_bundle(
        tmp_path / "three-finger-toxins_2026_03.parquetbundle", table, names=("U",)
    )
    record = _write_manifest_module().read_bundle_record(
        bundle, example_id="three-finger-toxins", file=bundle.name, hosting="release"
    )
    assert record["releases"] == {
        "membership": "2025_03",
        "annotations": {"source": "2025_03", "refreshed": "2026_03"},
    }
    assert record["columns"] == ["ec", "pfam"] and record["projections"] == ["U"]
    assert record["protspaceVersion"] == "4.14.0" and record["gitSha"] == "abc"
    with pytest.raises(ValueError, match="stamped example_id"):
        _write_manifest_module().read_bundle_record(
            bundle, example_id="demo", file=bundle.name, hosting="release"
        )


# ---------------------------------------------------------------------------
# Step markers keyed on every input
# ---------------------------------------------------------------------------


def test_a_marker_is_keyed_on_the_step_inputs(config, tmp_path):
    ctx = _context(config, "demo", tmp_path, dry_run=False)
    styles = tmp_path / "styles.json"
    styles.write_text('{"ec": {}}')
    recipe = {"envelope": None}
    calls = []
    steps = [
        bs.Step("a", "cmd a", lambda: calls.append("a")),
        bs.Step(
            "style",
            "protspace style",
            lambda: calls.append("style"),
            inputs=lambda: {
                "styles": bs.content_sha256(styles),
                "recipe": dict(recipe),
            },
        ),
    ]
    bs.execute(ctx, steps)
    bs.execute(ctx, steps)
    assert calls == ["a", "style"]
    styles.write_text('{"ec": {"pinnedValues": ["x"]}}')  # same summary, new content
    bs.execute(ctx, steps)
    assert calls == ["a", "style", "style"]
    recipe["envelope"] = {"eatConfidenceThreshold": 0.5}
    bs.execute(ctx, steps)
    assert calls[-1] == "style" and len(calls) == 4
    marker = json.loads((ctx.work / ".steps" / "style.done").read_text())
    assert marker["summary"] == "protspace style" and len(marker["key"]) == 64


def test_a_pre_digest_marker_runs_the_step_again(config, tmp_path):
    ctx = _context(config, "demo", tmp_path, dry_run=False)
    (ctx.work / ".steps").mkdir(parents=True)
    (ctx.work / ".steps" / "a.done").write_text("cmd a")  # the old summary marker
    calls = []
    bs.execute(ctx, [bs.Step("a", "cmd a", lambda: calls.append("a"))])
    assert calls == ["a"]


def _step(ctx, name):
    return next(s for s in bs.recipe_steps(ctx) if s.name == name)


def test_an_author_fact_reruns_finalize_but_not_stats(config, tmp_path):
    # three-finger-toxins: its one input is in the repository.
    cli = bs.Cli(REPO_ROOT, dry_run=True)
    ctx = _context(config, "three-finger-toxins", tmp_path, cli=cli)
    before = {n: _step(ctx, n).key() for n in ("assemble", "stats", "finalize")}
    ctx.dataset = {**ctx.dataset, "gates": [], "report": {}, "name": "renamed"}
    assert {n: _step(ctx, n).key() for n in before} == before
    ctx.dataset = {**ctx.dataset, "membership_release": "2025_04"}
    after = {n: _step(ctx, n).key() for n in before}
    assert after["assemble"] == before["assemble"]
    assert after["stats"] == before["stats"]
    assert after["finalize"] != before["finalize"]
    ctx.dataset = {**ctx.dataset, "stats_annotations": ["toxin_class"]}
    assert _step(ctx, "stats").key() != before["stats"]
    ctx.view = {**ctx.view, "annotation": "protein_families"}
    assert _step(ctx, "assemble").key() != before["assemble"]
    # Pinning the embeddings after the first build re-embeds nothing.
    embed = _step(ctx, "embed").key()
    ctx.dataset = {
        **ctx.dataset,
        "embed": {**ctx.dataset["embed"], "vectors_sha256": "0" * 64},
    }
    assert _step(ctx, "embed").key() == embed


def test_every_local_step_declares_its_inputs(config, tmp_path):
    for ds_id in config.datasets:
        cli = bs.Cli(REPO_ROOT, dry_run=True)
        ctx = _context(config, ds_id, tmp_path, cli=cli)
        steps = [s for s in bs.recipe_steps(ctx) if not s.always]
        assert all(s.inputs is not None for s in steps), ds_id
        expected = {"fetch-1"}
        if config.datasets[ds_id].get("refresh_groups"):
            expected = {"annotate", "fasta"}
        elif config.datasets[ds_id]["kind"] == "embed-build":
            expected = {"entries", "fetch-1"}
        assert {s.name for s in steps if s.fetches} >= expected, ds_id


def test_a_dry_run_writes_nothing(config, tmp_path):
    cli = bs.Cli(REPO_ROOT, dry_run=True)
    for ds_id in ("three-finger-toxins", "demo"):
        ctx = _context(config, ds_id, tmp_path, cli=cli, web_cut=None)
        bs.execute(ctx, bs.recipe_steps(ctx))
        ctx.record("anything", 1)
    assert list(tmp_path.iterdir()) == []


# ---------------------------------------------------------------------------
# Incomplete annotation sources (the CLI exits 0 with a partial source)
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("line", "sources"),
    [
        (
            "WARNING Incomplete annotations from: interpro, ted. The affected "
            "proteins have empty values in out.parquet",
            {"interpro", "ted"},
        ),
        (
            "Caching annotations at /w/ann/tmp/all_annotations.parquet without ted: "
            "that source could not be fully retrieved, so its columns are left out",
            {"ted"},
        ),
        (
            "Caching annotations at /w/c.parquet with the values it already held for "
            "biocentral: that source could not be fully retrieved, so ...",
            {"biocentral"},
        ),
        (
            "Not caching annotations at /w/c.parquet: uniprot, taxonomy could not be "
            "fully retrieved, and nothing else was retrieved either.",
            {"uniprot", "taxonomy"},
        ),
        (
            "Could not retrieve annotations from the following sources: "
            "InterPro (timeout), TED (HTTP 429)",
            {"interpro", "ted"},
        ),
        ("Failed to retrieve Biocentral predictions: 503", {"biocentral"}),
        (
            "TED lookups: recovered 3 of 9 that failed in the first pass; 6 still "
            "failed (P1, ...). TED domains are incomplete and will not be cached.",
            {"ted"},
        ),
        (
            "InterPro lost 5 batches in a row, so it is taken to be down: ... "
            "InterPro annotations are incomplete and will not be cached.",
            {"interpro"},
        ),
        (
            "InterPro had no sequence for 4 proteins because UniProt did not return "
            "every batch; InterPro values are not cached this run and are requested "
            "again next run.",
            {"interpro"},
        ),
        ("something else could not be fully retrieved", {"unknown"}),
        ("Using cached annotations", set()),
        ("Annotation cache lacks 3 of 10 requested identifier(s)", set()),
    ],
)
def test_incomplete_sources_in_reads_the_cli_warnings(line, sources):
    assert bs.incomplete_sources_in(line) == sources


def test_stream_command_passes_output_through_and_finds_incomplete_sources(
    tmp_path, capfd
):
    script = (
        "import sys\n"
        "print('fetching', flush=True)\n"
        "sys.stderr.write('progress 10%\\rprogress 100%\\r')\n"
        "sys.stderr.write('WARNING Incomplete annotations from: ted. The affected')\n"
    )
    transcript = tmp_path / "logs" / "step.log"
    code, incomplete = bs.stream_command(
        [sys.executable, "-c", script], cwd=tmp_path, transcript=transcript
    )
    assert code == 0 and incomplete == {"ted"}
    assert "Incomplete annotations from: ted" in transcript.read_text()
    assert "fetching" in capfd.readouterr().out


class ScriptedCli(bs.Cli):
    """A CLI whose runs report the given incomplete sources, one set per run."""

    def __init__(self, reports):
        super().__init__(REPO_ROOT)
        self.reports = list(reports)
        self.runs = 0

    def run(self, args, *, cwd, log, transcript=None):
        self.runs += 1
        return bs.CliResult(set(self.reports.pop(0)))


def _fetch_ctx(config, tmp_path, cli, monkeypatch, served="2026_03"):
    monkeypatch.setattr(bs, "current_uniprot_release", lambda: served)
    ctx = _context(config, "demo", tmp_path, cli=cli, dry_run=False)
    ctx.config = copy.copy(config)
    ctx.config.raw = {
        **config.raw,
        "build": {**config.build, "incomplete_retry_wait_s": 0},
    }
    return ctx


def _annotate_step(ctx, releases=lambda: {"2026_03"}):
    return bs.fetch_step(
        ctx,
        "annotate",
        ["annotate", "-i", "x.fasta"],
        inputs=lambda: {},
        releases=releases,
    )


def test_a_partial_fetch_is_run_again_and_then_marked_done(
    config, tmp_path, monkeypatch
):
    cli = ScriptedCli([{"ted"}, set()])
    ctx = _fetch_ctx(config, tmp_path, cli, monkeypatch)
    bs.execute(ctx, [_annotate_step(ctx)])
    assert cli.runs == 2
    assert (ctx.work / ".steps" / "annotate.done").is_file()
    assert ctx.facts()["data-release:annotate"] == ["2026_03"]


def test_a_fetch_that_stays_partial_fails_without_a_marker(
    config, tmp_path, monkeypatch
):
    cli = ScriptedCli([{"ted"}, {"ted", "interpro"}])
    ctx = _fetch_ctx(config, tmp_path, cli, monkeypatch)
    with pytest.raises(bs.BuildError, match=r"\['interpro', 'ted'\] still incomplete"):
        bs.execute(ctx, [_annotate_step(ctx)])
    assert cli.runs == 2
    assert not (ctx.work / ".steps" / "annotate.done").exists()


def test_a_fetch_refuses_to_start_on_another_served_release(
    config, tmp_path, monkeypatch
):
    cli = ScriptedCli([set()])
    ctx = _fetch_ctx(config, tmp_path, cli, monkeypatch, served="2026_04")
    with pytest.raises(bs.BuildError, match="UniProt serves 2026_04"):
        bs.execute(ctx, [_annotate_step(ctx)])
    assert cli.runs == 0
    assert ctx.facts()["probe-release:annotate"] == "2026_04"


# ---------------------------------------------------------------------------
# Provenance: the release the data came from, not the one served at a probe
# ---------------------------------------------------------------------------


def test_cache_release_stamp_reads_the_cli_stamp(tmp_path):
    frame = pd.DataFrame({"identifier": ["P1"], "ec": ["x"]})
    frame.attrs[UNIPROT_RELEASE_ATTR] = "2026_03,2026_02"
    frame.to_parquet(tmp_path / "all_annotations.parquet", index=False)
    assert bs.cache_release_stamp(tmp_path / "all_annotations.parquet") == {
        "2026_02",
        "2026_03",
    }
    pd.DataFrame({"identifier": ["P1"]}).to_parquet(tmp_path / "plain.parquet")
    # No stamp, or no cache: unknown, as the CLI reads it.
    assert bs.cache_release_stamp(tmp_path / "plain.parquet") == {"unknown"}
    assert bs.cache_release_stamp(tmp_path / "absent.parquet") == {"unknown"}


def _facts(ctx, facts):
    ctx.work.mkdir(parents=True, exist_ok=True)
    (ctx.work / "facts.json").write_text(json.dumps(facts))


def test_fetched_release_ignores_what_uniprot_serves_later(config, tmp_path):
    cli = bs.Cli(REPO_ROOT, dry_run=True)
    ctx = _context(config, "demo", tmp_path, cli=cli, dry_run=False)
    _facts(
        ctx,
        {
            "data-release:fasta": ["2026_03"],
            "data-release:annotate": ["2026_03"],
            "probe-release:start": "2026_04",  # UniProt moved on; data did not
        },
    )
    assert bs.fetched_release(ctx) == "2026_03"


@pytest.mark.parametrize(
    ("facts", "message"),
    [
        (
            {"data-release:fasta": ["2026_03"], "data-release:annotate": ["2026_04"]},
            "mixes UniProt releases",
        ),
        ({"data-release:annotate": ["unknown"]}, "recorded no UniProt release"),
        ({}, "no fetch step recorded"),
        ({"data-release:annotate": ["2026_02"]}, r"from \['2026_02'\], not 2026_03"),
    ],
)
def test_fetched_release_refuses_data_it_cannot_certify(
    config, tmp_path, facts, message
):
    cli = bs.Cli(REPO_ROOT, dry_run=True)
    ctx = _context(config, "demo", tmp_path, cli=cli, dry_run=False)
    _facts(ctx, facts)
    with pytest.raises(bs.BuildError, match=message):
        bs.fetched_release(ctx)
    ctx.allow_release_mismatch = True
    bs.fetched_release(ctx)  # allowed: warns instead


def test_data_releases_only_count_this_recipes_fetch_steps(config, tmp_path):
    cli = bs.Cli(REPO_ROOT, dry_run=True)
    ctx = _context(config, "demo", tmp_path, cli=cli, dry_run=False)
    _facts(
        ctx,
        {"data-release:annotate": ["2026_03"], "data-release:fetch-9": ["2025_01"]},
    )
    assert bs.data_releases(ctx) == {"annotate": ["2026_03"]}


def test_provenance_gate_holds_unconfirmed_releases():
    found = {
        "example_id": "demo",
        "protspace_version": "4.14.0",
        "built_at": "t",
        "command": "c",
        "membership_release": "2025_04 (inferred; confirm with the author)",
        "uniprot_release": {
            "refreshed": {"release": "2026_03", "columns": ["ec"]},
            "computed": {"release": None, "columns": ["cluster_x"]},
        },
    }
    gate = bs.provenance_gate(found)
    assert gate.status == "pending" and "membership" in gate.detail
    found["membership_release"] = "2025_04"
    assert bs.provenance_gate(found).status == "pass"
    del found["command"]
    assert bs.provenance_gate(found).status == "fail"


# ---------------------------------------------------------------------------
# Gates that must not pass silently
# ---------------------------------------------------------------------------


def test_obsolete_rows_fall_back_to_the_name_and_refuse_to_guess():
    names_only = _annotations(protein_name=["x", "", None])
    assert bs.obsolete_rows(names_only) == ["P2", "P3"]
    assert bs.obsolete_rows(_annotations(pfam=["a", "b", "c"])) is None
    gate = bs.obsolete_gate("fetch-without-entry", None, 10, "accessions")
    assert gate.status == "fail"


def test_an_empty_refreshed_source_fails():
    table = _annotations(
        pfam=["PF1", "", "PF2"], ted_domains=["", None, ""], ec=["", "", ""]
    )
    gate = bs.sources_filled_gate(table, {"ec": "paper", "pfam": "refreshed"})
    assert gate.status == "fail" and "ted (ted_domains)" in gate.detail
    ok = bs.sources_filled_gate(table.drop_columns(["ted_domains"]), {"ec": "paper"})
    assert ok.status == "pass"


def test_pfam_duplicates_fail_without_the_cache(config, tmp_path):
    ctx = _context(config, "swissprot", tmp_path)
    assert bs.pfam_duplicate_gate(ctx, {}).status == "fail"
    cache = ctx.work / "ann" / "tmp"
    cache.mkdir(parents=True)
    pq.write_table(
        pa.table({"identifier": ["P1"], "sequence": ["M"]}),
        cache / "all_annotations.parquet",
    )
    assert bs.pfam_duplicate_gate(ctx, {}).status == "fail"


def test_unknown_story_gate_types_fail():
    bundle = bs.Bundle(
        _annotations(), pa.table({"projection_name": ["U"]}), pa.table({})
    )
    gates = bs.run_story_gates(bundle, [{"type": "browser_load"}, {"type": "typo"}])
    assert [(g.name, g.status) for g in gates] == [("typo", "fail")]


def test_pending_blocks_like_a_failure():
    ok, text = bs.summarize([bs.Gate("a", "pass"), bs.Gate("b", "pending")])
    assert not ok and "1 pending" in text
    assert bs.summarize([bs.Gate("a", "pass"), bs.Gate("b", "warn")])[0]


# ---------------------------------------------------------------------------
# D2: the browser measurement, the web cut and the release gate
# ---------------------------------------------------------------------------


def _built(ctx, content=b"bundle bytes"):
    ctx.root.mkdir(parents=True, exist_ok=True)
    ctx.final.write_bytes(content)
    return bs.file_identity(ctx.final)


def test_the_d2_measurement_is_tied_to_the_measured_bytes(config, tmp_path):
    ctx = _context(config, "swissprot", tmp_path, dry_run=False)
    params = {"max_seconds": 35, "max_heap_mb": 1536}
    identity = _built(ctx)
    assert bs.browser_load_gate(ctx, params, identity).status == "pending"
    bs.record_load(ctx, seconds=28, heap_mb=1300, machine="M1, Chrome 140")
    assert bs.browser_load_gate(ctx, params, identity).status == "pass"
    slow = bs.record_load(ctx, seconds=50, heap_mb=1300, machine="M1")
    assert slow["sha256"] == identity["sha256"]
    assert bs.browser_load_gate(ctx, params, identity).status == "fail"
    bs.record_load(ctx, seconds=28, heap_mb=1300, machine="M1")
    rebuilt = _built(ctx, b"the web-cut bytes")  # e.g. build --web-cut
    gate = bs.browser_load_gate(ctx, params, rebuilt)
    assert gate.status == "pending" and "measured other bytes" in gate.detail


def test_the_web_cut_decision_is_kept_for_later_builds(config, tmp_path):
    ctx = _context(config, "swissprot", tmp_path, dry_run=False)
    assert not ctx.web_cut_active()
    bs.persist_web_cut(ctx, True)
    later = _context(config, "swissprot", tmp_path, dry_run=False, web_cut=None)
    assert later.web_cut_active()
    bs.persist_web_cut(later, False)
    assert not _context(config, "swissprot", tmp_path, dry_run=False).web_cut_active()
    with pytest.raises(bs.BuildError, match="no web_cut columns"):
        bs.persist_web_cut(_context(config, "demo", tmp_path, dry_run=False), True)


def test_release_readiness_needs_a_passed_verify_of_these_bytes(tmp_path):
    bundle = tmp_path / "x.parquetbundle"
    verify = tmp_path / "verify.json"
    assert "not built" in bs.release_readiness(bundle, verify)
    bundle.write_bytes(b"v1")
    assert "never verified" in bs.release_readiness(bundle, verify)
    record = {
        **bs.file_identity(bundle),
        "ok": False,
        "gates": [
            {"name": "browser-load", "status": "pending"},
            {"name": "proteins", "status": "pass"},
        ],
    }
    verify.write_text(json.dumps(record))
    assert "browser-load (pending)" in bs.release_readiness(bundle, verify)
    verify.write_text(json.dumps({**record, "ok": True}))
    assert bs.release_readiness(bundle, verify) is None
    bundle.write_bytes(b"v2")
    assert "other bytes" in bs.release_readiness(bundle, verify)


def test_stage_release_refuses_unverified_files(config, tmp_path):
    ctx = _context(config, "three-finger-toxins", tmp_path, dry_run=False)
    _built(ctx)
    with pytest.raises(bs.BuildError, match="refusing to stage"):
        bs.stage_release(
            config, tmp_path, "2026_03", tmp_path / "s", ["three-finger-toxins"]
        )
    assert not (tmp_path / "s").exists()


def test_the_v3_files_get_names_the_v2_release_assets_never_had(config, tmp_path):
    """The v2 bundles are published under <id>_2026_03; the v3 build writes
    <id>_2026_03_v3, so no published name ever gets new bytes."""
    assert config.build["file_pattern"] == bs.DEFAULT_FILE_PATTERN
    ctx = _context(config, "swissprot", tmp_path)
    assert ctx.file_name == "swissprot_2026_03_v3.parquetbundle"
    assert ctx.full_variant.name == "swissprot_2026_03_v3_full.parquetbundle"
    assert bs.built_file(config, tmp_path, "demo", "2026_03").name == (
        "demo_2026_03_v3.parquetbundle"
    )
    # The demo is repo-hosted under its own name.
    assert config.datasets["demo"]["repo_file"] == "data.parquetbundle"


def _published(tag, file, sha256, retained=()):
    return {
        "release": tag,
        "retained": list(retained),
        "examples": {
            "demo": {"file": "data.parquetbundle", "hosting": "repo", "sha256": "d"},
            "swissprot": {"file": file, "hosting": "release", "sha256": sha256},
        },
    }


def test_a_published_name_never_gets_new_bytes(tmp_path):
    built = tmp_path / "swissprot_2026_03.parquetbundle"
    built.write_bytes(b"v3 bytes")
    digest = bs.sha256_file(built)
    files = {"swissprot": built}
    tag = "showcase-2026_03"

    conflicts = bs.published_name_conflicts(
        _published(tag, built.name, "v2"), tag, files
    )
    assert len(conflicts) == 1 and "already published" in conflicts[0]
    # The same bytes again, another name, another release: no conflict.
    assert not bs.published_name_conflicts(
        _published(tag, built.name, digest), tag, files
    )
    assert not bs.published_name_conflicts(_published(tag, "other", "v2"), tag, files)
    assert not bs.published_name_conflicts(
        _published("showcase-2026_06", built.name, "v2"), tag, files
    )
    # A file the release still serves as retained counts as published.
    retained = [{"release": tag, "file": built.name, "bytes": 1, "sha256": "v2"}]
    assert bs.published_name_conflicts(
        _published(tag, "other", "x", retained), tag, files
    )


def test_stage_release_refuses_new_bytes_under_a_published_name_even_forced(
    config, tmp_path
):
    ctx = _context(config, "three-finger-toxins", tmp_path, dry_run=False)
    _built(ctx)
    previous = tmp_path / "example-manifest.ts"
    writer = bs.manifest_writer()
    previous.write_text(
        writer.render_manifest(
            _published(config.build["release_tag"], ctx.file_name, "0" * 64)
        )
    )
    with pytest.raises(bs.BuildError, match="already published"):
        bs.stage_release(
            config,
            tmp_path,
            "2026_03",
            tmp_path / "s",
            ["three-finger-toxins"],
            force=True,
            previous_manifest=previous,
        )
    assert not (tmp_path / "s").exists()


def test_stage_release_adds_the_v3_files_to_the_published_release(
    config, tmp_path, capsys
):
    """The v2 files stay as published; the v3 ones and their own checksum file
    are uploaded next to them, never with --clobber."""
    ctx = _context(config, "three-finger-toxins", tmp_path, dry_run=False)
    ctx.root.mkdir(parents=True)
    _write_bundle(ctx.final, bs.stamp_format_version(_annotations()), v3=True)
    tag = config.build["release_tag"]
    previous = tmp_path / "example-manifest.ts"
    previous.write_text(
        bs.manifest_writer().render_manifest(
            _published(tag, "three-finger-toxins_2026_03.parquetbundle", "0" * 64)
        )
    )
    staging = tmp_path / "s"

    manifest = bs.stage_release(
        config,
        tmp_path,
        "2026_03",
        staging,
        ["three-finger-toxins"],
        force=True,  # not verified: a synthetic file
        previous_manifest=previous,
    )

    printed = capsys.readouterr().out
    assert config.build["checksums_file"] == "SHA256SUMS_v3"
    assert f"gh release upload {tag} " in printed and "--clobber" not in printed
    assert "gh release create" not in printed
    assert str(staging / "SHA256SUMS_v3") in printed
    assert not (staging / "SHA256SUMS").exists()
    assert (
        (staging / "SHA256SUMS_v3")
        .read_text()
        .endswith("  three-finger-toxins_2026_03_v3.parquetbundle\n")
    )
    record = manifest["examples"]["three-finger-toxins"]
    assert record["file"] == "three-finger-toxins_2026_03_v3.parquetbundle"

    # The release's SHA256SUMS is published too: the added checksums need a new name.
    local = copy.copy(config)
    local.raw = copy.deepcopy(config.raw)
    del local.raw["build"]["checksums_file"]
    with pytest.raises(bs.BuildError, match="checksums_file"):
        bs.stage_release(
            local,
            tmp_path,
            "2026_03",
            tmp_path / "s2",
            ["three-finger-toxins"],
            force=True,
            previous_manifest=previous,
        )


def _published_v3_build(config, tmp_path):
    """A built three-finger-toxins v3 file and a committed manifest that names
    only it: the re-pinned manifest, which no longer lists the v2 names."""
    ctx = _context(config, "three-finger-toxins", tmp_path, dry_run=False)
    ctx.root.mkdir(parents=True)
    _write_bundle(ctx.final, bs.stamp_format_version(_annotations()), v3=True)
    previous = tmp_path / "example-manifest.ts"
    previous.write_text(
        bs.manifest_writer().render_manifest(
            _published(
                config.build["release_tag"], ctx.file_name, bs.sha256_file(ctx.final)
            )
        )
    )
    return ctx, previous


def _asset(name, digest):
    return {"name": name, "digest": digest and f"sha256:{digest}"}


def test_stage_release_checks_the_names_the_release_itself_holds(
    config, tmp_path, capsys
):
    """A name the committed manifest no longer lists is still an asset of the
    release: it never gets new bytes, and one it holds with these bytes is not
    uploaded again."""
    ctx, previous = _published_v3_build(config, tmp_path)
    tag = config.build["release_tag"]

    def stage(live, staging):
        return bs.stage_release(
            config,
            tmp_path,
            "2026_03",
            tmp_path / staging,
            ["three-finger-toxins"],
            force=True,  # not verified: a synthetic file
            previous_manifest=previous,
            live=live,
        )

    for digest in ("0" * 64, None):
        with pytest.raises(bs.BuildError, match=f"already an asset of {tag}"):
            stage({"assets": [_asset(ctx.file_name, digest)], "body": ""}, "s1")
    assert not (tmp_path / "s1").exists()
    with pytest.raises(bs.BuildError, match="SHA256SUMS_v3 is already an asset"):
        stage({"assets": [_asset("SHA256SUMS_v3", "0" * 64)], "body": ""}, "s1")

    # Already uploaded with exactly these bytes: only the checksums are left.
    stage({"assets": [_asset(ctx.file_name, bs.sha256_file(ctx.final))]}, "s2")
    printed = capsys.readouterr().out
    upload = next(line for line in printed.splitlines() if "gh release upload" in line)
    assert ctx.file_name not in upload and "SHA256SUMS_v3" in upload
    assert "could not read" not in printed

    # Without GitHub the committed manifest's names are all that is checked.
    stage(None, "s3")
    assert "could not read" in capsys.readouterr().out


def test_stage_release_keeps_the_published_notes(config, tmp_path, capsys):
    """`gh release upload` leaves the notes as they are: RELEASE_NOTES.md is the
    published text with the added files appended, for `gh release edit`."""
    ctx, previous = _published_v3_build(config, tmp_path)
    tag = config.build["release_tag"]
    body = (
        "Curated example datasets for protspace.app.\n\n"
        "- `three-finger-toxins_2026_03.parquetbundle` (three-finger-toxins, "
        "release): 1,089 proteins, 0.1 MB\n"
    )
    live = {
        "assets": [_asset("three-finger-toxins_2026_03.parquetbundle", "0" * 64)],
        "body": body,
    }
    staging = tmp_path / "s"

    bs.stage_release(
        config,
        tmp_path,
        "2026_03",
        staging,
        ["three-finger-toxins"],
        force=True,  # not verified: a synthetic file
        previous_manifest=previous,
        live=live,
    )

    notes = (staging / "RELEASE_NOTES.md").read_text()
    assert notes.startswith(body + "\nAdded to this release (checksums in ")
    assert f"- `{ctx.file_name}` (three-finger-toxins, release)" in notes
    printed = capsys.readouterr().out
    assert (
        f"gh release edit {tag} --repo {bs.GITHUB_REPO} --notes-file "
        f"{staging / 'RELEASE_NOTES.md'}"
    ) in printed

    # Notes that already list the file are left as they are.
    live["body"] = notes
    bs.stage_release(
        config,
        tmp_path,
        "2026_03",
        tmp_path / "s2",
        ["three-finger-toxins"],
        force=True,
        previous_manifest=previous,
        live=live,
    )
    assert (tmp_path / "s2" / "RELEASE_NOTES.md").read_text() == notes
    assert "gh release edit" not in capsys.readouterr().out


def test_live_release_tells_a_missing_release_from_an_unknown_one(monkeypatch):
    def run(stdout="", stderr="", returncode=0):
        def fake(*args, **kwargs):
            return bs.subprocess.CompletedProcess(args, returncode, stdout, stderr)

        monkeypatch.setattr(bs.subprocess, "run", fake)
        return bs.live_release("o/r", "t")

    assert run('{"assets": [], "body": "x"}') == {"assets": [], "body": "x"}
    assert run(stderr="release not found\n", returncode=1) == {}
    assert run(stderr="HTTP 401: Bad credentials\n", returncode=1) is None

    def missing(*args, **kwargs):
        raise FileNotFoundError("gh")

    monkeypatch.setattr(bs.subprocess, "run", missing)
    assert bs.live_release("o/r", "t") is None


def test_outputs_may_not_land_in_the_repository_or_an_input(config, tmp_path):
    with pytest.raises(bs.BuildError, match="inside the repository"):
        bs.check_output_location(REPO_ROOT / "build-out", config, "--out-root")
    local = bs.Config.load(bs.DEFAULT_CONFIG, {"nm_data": str(tmp_path / "nm")})
    with pytest.raises(bs.BuildError, match="nm_data"):
        bs.check_output_location(tmp_path / "nm" / "x", local, "--staging")
    bs.check_output_location(tmp_path / "out", local, "--out-root")


def test_the_cli_offers_one_command_per_job():
    parser_help = bs.__doc__
    for command in (
        "build",
        "verify",
        "report",
        "record-load",
        "stage-release",
    ):
        assert command in parser_help
    for retired in ("manifest", "stage-perf"):  # stage_perf.py has its own CLI
        with pytest.raises(SystemExit):
            bs.parse_args([retired])
    args = bs.parse_args(["build", "--only", "swissprot", "--no-web-cut"])
    assert args.web_cut is False
    assert bs.parse_args(["build", "--only", "swissprot"]).web_cut is None


# ---------------------------------------------------------------------------
# End to end, offline: fake UniProt, embed and prepare; real protspace bundle,
# transfer, stats and style
# ---------------------------------------------------------------------------

SHORT = (
    "SIMILARITY: Belongs to the three-finger toxin family. Short-chain subfamily. "
    "Type I alpha-neurotoxin sub-subfamily. {ECO:0000305}."
)
LONG = (
    "SIMILARITY: Belongs to the three-finger toxin family. Long-chain subfamily. "
    "Type II alpha-neurotoxin sub-subfamily. {ECO:0000305}."
)
BOIGA = (
    "SIMILARITY: Belongs to the three-finger toxin family. Ancestral subfamily. "
    "Boigatoxin sub-subfamily. {ECO:0000256|RuleBase:RU000001}."
)


def _tftx_entries() -> list[dict[str, str]]:
    """40 entries: 12 short- and 12 long-chain Swiss-Prot toxins (half of them
    mature chains, half precursors), 16 TrEMBL precursors, two of them with
    UniProt's automatic Boigatoxin label."""
    entries = []
    for i in range(40):
        reviewed = i < 24
        short = i % 2 == 0
        precursor = not reviewed or i % 4 < 2
        mature = ("MKT" if short else "RIC") * 20 + "A" * (i % 5)
        sequence = ("MKTLLLTLVVVTIVCLDLGYT" if precursor else "") + mature
        signal = 21 if precursor else 0
        name = "Short neurotoxin" if short else "Long neurotoxin"
        entries.append(
            {
                **dict.fromkeys(bs.ENTRY_FIELDS, ""),
                "accession": f"{'P' if reviewed else 'A0A'}{i:05d}",
                "reviewed": "reviewed" if reviewed else "unreviewed",
                "protein_name": f"{name} {i}",
                "organism_name": "Naja naja" if i % 3 else "Bungarus multicinctus",
                "length": str(len(sequence)),
                "ft_signal": f"SIGNAL 1..{signal}" if signal else "",
                "ft_chain": f"CHAIN {signal + 1}..{len(sequence)}",
                "cc_similarity": (SHORT if short else LONG)
                if reviewed
                else (BOIGA if i in (30, 31) else ""),
                "xref_interpro": "IPR003571;" if i != 5 else "",
                "sequence": sequence,
            }
        )
    # A reviewed precursor with a curated propeptide, and a TrEMBL precursor
    # whose SignalP chain still starts with it (two mismatches).
    signal, propeptide = "MKTLLLTLVVVTIVCLDLGYT", "DQLGLGRQQIDWGQG"
    for index, pep in ((1, propeptide), (35, "DQLGLGRQRIDWQQG")):
        entry = entries[index]
        mature = entry["sequence"][len(signal) :]
        entry["sequence"] = signal + pep + mature
        entry["length"] = str(len(entry["sequence"]))
        if index == 1:
            entry["ft_propep"] = f"PROPEP 22..{21 + len(pep)}"
            entry["ft_chain"] = f"CHAIN {22 + len(pep)}..{len(entry['sequence'])}"
        else:
            entry["ft_chain"] = f"CHAIN 22..{len(entry['sequence'])}"
    # TrEMBL precursors UniProt gives no feature: 39's signal peptide ends in
    # the motif before a Cys-3 chain ("RIC…"), 38's before "MKT…" does not.
    for index in (38, 39):
        entries[index]["ft_signal"] = entries[index]["ft_chain"] = ""
    return entries


class EmbedBuildCli(bs.Cli):
    """Fakes ``embed`` and ``prepare``; runs the installed protspace otherwise."""

    def __init__(self, entries):
        super().__init__(REPO_ROOT)
        self.entries = {e["accession"]: e for e in entries}
        self.commands = []

    def argv(self, args, extras=()):
        return [str(Path(sys.executable).with_name("protspace")), *map(str, args)]

    def _vector(self, accession):
        entry = self.entries[accession]
        index = int(accession[-5:])
        short = "Short" in entry["protein_name"]
        vector = np.zeros(16, dtype=np.float32)
        vector[0] = 1.0 if short else -1.0
        vector[1 + index % 15] = 0.05
        return vector

    def run(self, args, *, cwd, log, transcript=None, extras=()):
        self.commands.append(args[0])
        if args[0] == "embed":
            assert extras == ("local",)
            fasta = Path(args[args.index("-i") + 1])
            out = Path(args[args.index("-o") + 1])
            out.mkdir(parents=True, exist_ok=True)
            sequences = bs.parse_fasta_text(fasta.read_text())
            with h5py.File(out / "prot_t5.h5", "w") as handle:
                for accession, sequence in sequences.items():
                    dataset = handle.create_dataset(
                        accession, data=self._vector(accession)
                    )
                    # What protspace embed stores.
                    dataset.attrs[SEQUENCE_DIGEST_ATTR] = sequence_digest(sequence)
            return bs.CliResult()
        if args[0] == "prepare":
            h5 = Path(bs.split_h5_spec(args[args.index("-i") + 1])[0])
            out = Path(args[args.index("-o") + 1])
            with h5py.File(h5) as handle:
                ids = list(handle.keys())
            full = bs.parse_fasta_text(Path(args[args.index("-f") + 1]).read_text())
            rows = [self.entries[a] for a in ids]
            annotations = pa.table(
                {
                    "protein_id": ids,
                    "protein_name": [r["protein_name"] for r in rows],
                    "reviewed": [
                        "Swiss-Prot" if r["reviewed"] == "reviewed" else "TrEMBL"
                        for r in rows
                    ],
                    "length": [str(len(full[a])) for a in ids],
                    "species": [r["organism_name"] for r in rows],
                    "genus": [r["organism_name"].split()[0] for r in rows],
                    "family": [
                        "Elapidae" if i % 4 else "Colubridae" for i in range(40)
                    ],
                    "pfam": [
                        "PF00087 (Toxin_TOLIP)|50.1"
                        if i % 2
                        else "PF21947 (Toxin_3FTx)|41.0"
                        for i in range(40)
                    ],
                    "xref_pdb": ["True" if i % 7 == 0 else "False" for i in range(40)],
                    "sequence": [full[a] for a in ids],
                }
            )
            xy = np.array([self._vector(a)[:2] for a in ids], dtype=float)
            metadata = pa.table(
                {
                    "projection_name": ["ProtT5 — UMAP 2", "ProtT5 — PCA 2"],
                    "dimensions": [2, 2],
                    "info_json": ["{}", "{}"],
                }
            )
            data = pa.table(
                {
                    "projection_name": ["ProtT5 — UMAP 2"] * 40
                    + ["ProtT5 — PCA 2"] * 40,
                    "identifier": ids * 2,
                    "x": list(xy[:, 0]) + list(-xy[:, 0]),
                    "y": list(xy[:, 1]) + list(xy[:, 1] * 2),
                    "z": pa.nulls(80, pa.float64()),
                }
            )
            out.mkdir(parents=True, exist_ok=True)
            # A legacy container, as the released 4.15.0 CLI writes it; the
            # real bundle, transfer and style below write v3.
            (out / "data.parquetbundle").write_bytes(
                _legacy_blob(bs.stamp_format_version(annotations), metadata, data)
            )
            with (out / "run.log").open("a") as handle:
                handle.write("## Annotations\nuniprot_release: 2026_03\n")
            return bs.CliResult()
        return super().run(args, cwd=cwd, log=log, transcript=transcript)

    def version(self):
        return bs.MIN_CLI_VERSION


@pytest.mark.slow
def test_the_eat_example_builds_offline_and_passes_its_gates(
    config, tmp_path, monkeypatch
):
    entries = _tftx_entries()
    monkeypatch.setattr(bs, "current_uniprot_release", lambda: "2026_03")
    monkeypatch.setattr(
        bs,
        "fetch_uniprot_entries",
        lambda ids, fields=bs.ENTRY_FIELDS, chunk=100: (
            [e for e in entries if e["accession"] in set(ids)],
            {"2026_03"},
        ),
    )
    membership = tmp_path / "membership.txt"
    membership.write_text(
        "# query: test\n" + "\n".join(sorted(e["accession"] for e in entries)) + "\n"
    )
    local = copy.copy(config)
    local.raw = copy.deepcopy(config.raw)
    dataset = local.raw["datasets"]["three-finger-toxins"]
    dataset.update(
        membership_file=str(membership),
        membership_sha256=bs.sha256_file(membership),
        proteins=40,
        embed={"model": "prot_t5", "backend": "local"},  # unpinned: fake vectors
        keep_uninformative=["toxin_class_uniprot_rule"],
        gates=[
            {
                "type": "category_counts",
                "column": "eat_split",
                "expected": {"reference": 20, "holdout": 4, "trembl": 16},
            },
            {
                "type": "no_refill",
                "split_column": "eat_split",
                "query_value": ["holdout", "trembl"],
                "columns": ["toxin_class", "toxin_subfamily"],
            },
            {
                "type": "eat_accuracy",
                "column": "toxin_class",
                "truth_column": "toxin_class_withheld",
                "split_column": "eat_split",
                "query_value": "holdout",
                "min_n": 4,
                "min_accuracy": 88.0,
                "min_accuracy_at_threshold": 90.0,
            },
            {
                "type": "eat_transfers",
                "column": "toxin_class",
                "split_column": "eat_split",
                "query_value": "trembl",
                "expected_predicted": 16,
                "expected_at_threshold": 16,
                "rel_tol": 0.05,
            },
            {"type": "eat_fanout", "column": "toxin_class", "max_fanout": 40},
            {
                "type": "name_agreement",
                "names_from": "entries",
                "column": "toxin_class",
                "split_column": "eat_split",
                "query_value": "trembl",
                "min_fraction": 0.85,
                "rules": [
                    ["short neurotoxin", "Type I α-neurotoxin (short)"],
                    ["long neurotoxin", "Type II α-neurotoxin (long)"],
                ],
            },
            {
                "type": "mature_inputs",
                "family_only_xref": "IPR003571",
                "expected_family_only": 1,
            },
            {"type": "full_length_inputs", "min_fraction": 0.99},
            {"type": "holdout_split"},  # unpinned: pending
        ],
    )
    cli = EmbedBuildCli(entries)
    ctx = _context(
        local,
        "three-finger-toxins",
        tmp_path / "out",
        cli=cli,
        dry_run=False,
        thumbnails=False,
    )
    bs.execute(ctx, bs.recipe_steps(ctx))
    assert cli.commands == [
        "embed", "prepare", "prepare", "prepare", "prepare",
        "bundle", "transfer", "stats", "bundle", "style",
    ]  # fmt: skip
    ok, gates = bs.verify(ctx)
    by_name = {g.name: g for g in gates}
    failed = {
        n: g.detail for n, g in by_name.items() if g.status not in ("pass", "warn")
    }
    # The embeddings and the split are unpinned in this copy of the recipe:
    # pending, nothing else.
    assert set(failed) == {"embeddings-pin", "holdout-split"}, failed
    assert by_name["embeddings-pin"].status == "pending" and not ok
    assert by_name["holdout-split"].status == "pending"
    for name in (
        "membership-pinned",
        "mature-inputs",
        "full-length-inputs",
        "no-refill",
        "eat-accuracy:toxin_class",
        "eat:toxin_class",
        "eat-fanout:toxin_class",
        "name-agreement:toxin_class",
        "counts:eat_split",
        "informative-columns",
        "settings-envelope",
        "default-view",
        "coordinates",
        "faithfulness",
        "provenance",
    ):
        assert by_name[name].status == "pass", (name, by_name[name].detail)
    assert by_name["mature-inputs"].data["family_only"] == 1
    assert by_name["mature-inputs"].data["homologous_propeptides"] == 1
    assert by_name["mature-inputs"].data["derivations"]["signal motif"] == 1

    final = bs.read_bundle(ctx.final)
    # The shipped file is v3, whatever the CLI's bundle/style wrote.
    assert final.container_version == 3 and by_name["format-v3"].status == "pass"
    assert ctx.final.name == "three-finger-toxins_2026_03_v3.parquetbundle"
    table = final.annotations
    rows = {r["protein_id"]: r for r in table.to_pylist()}
    assert table.column_names[1] == "toxin_class"
    assert final.metadata.column("projection_name").to_pylist() == [
        "ProtT5 — UMAP 2",
        "ProtT5 — PCA 2",
    ]
    # The TrEMBL rows are queries; their automatic label is kept aside.
    assert bs.is_missing(rows["A0A00030"]["toxin_class"])
    assert (
        rows["A0A00030"]["toxin_class_uniprot_rule"] == "Ancestral / non-conventional"
    )
    assert rows["A0A00030"]["toxin_class__pred_value"]
    # Mature chains are embedded; the precursor's length is UniProt's.
    assert rows["P00000"]["mature_length"] == 60 and rows["P00000"]["length"] == "81"
    assert rows["P00002"]["mature_length"] == 62 and rows["P00002"]["length"] == "62"
    # One rule for references and queries: both lose the curated propeptide,
    # and a precursor without features loses its signal peptide at the motif.
    assert rows["P00001"]["mature_length"] == 61  # without its 15-residue propeptide
    assert rows["A0A00035"]["mature_length"] == 60  # the homologous one cut too
    assert rows["A0A00039"]["mature_length"] == 64
    assert rows["A0A00038"]["mature_length"] == 84  # no motif: as deposited
    assert final.settings["eatOverlayEnabled"] is True
    assert final.settings["eatConfidenceThreshold"] == 0
    assert "toxin_class" in final.settings["legendSettings"]
    stats_names = set(final.statistics.column("annotation").to_pylist())
    assert {"toxin_class", "toxin_subfamily", "pfam"} <= stats_names
    assert "eat_split" not in stats_names
    provenance = bs.read_provenance(table)
    groups = provenance["uniprot_release"]
    assert groups["refreshed"]["release"] == "2026_03"
    assert "toxin_class_withheld" in groups["withheld-truth"]["columns"]
    assert "toxin_class__pred_value" in groups["computed"]["columns"]
    assert provenance["membership_release"] == "2026_03"
    assert any(line.startswith("protspace embed") for line in provenance["pipeline"])
    assert all(str(tmp_path) not in line for line in provenance["pipeline"])
    assert (ctx.work / "labels.csv").read_text().startswith("identifier,toxin_class,")
    assert provenance["holdout"] == {
        "split_column": "eat_split",
        "stratify": "toxin_class",
        "fraction": 0.2,
        "seed": 7,
        "held_out": 4,
        "split_sha256": by_name["holdout-split"].data["split_sha256"],
    }
    assert provenance["transfer"]["metric"] == "euclidean"
    assert provenance["transfer"]["k"] == 1
    assert provenance["embeddings"]["source"] == "embedded in this build"

    # Pinned, the same build passes; a second run re-runs nothing.
    facts = ctx.facts()["embeddings"]
    dataset["embed"] = {
        **dataset["embed"],
        "vectors_sha256": facts["vectors_sha256"],
        "sha256": facts["sha256"],
    }
    dataset["gates"][-1]["split_sha256"] = provenance["holdout"]["split_sha256"]
    ctx.dataset = dataset
    assert bs.verify(ctx)[0]
    cli.commands.clear()
    bs.execute(ctx, bs.recipe_steps(ctx))
    assert cli.commands == []

    # The gate checks the vectors and the flags, not only its own files.
    table_with_flags = table.append_column(
        "predicted_signal_peptide",
        pa.array(
            ["True" if pid == "A0A00038" else "False" for pid in bs.row_ids(table)]
        ),
    )
    gate = bs.mature_inputs_gate(ctx, {}, table_with_flags)
    assert gate.status == "fail" and "predicted to carry a signal" in gate.detail
    with h5py.File(bs.embed_h5(ctx), "r+") as handle:
        handle["P00002"].attrs[SEQUENCE_DIGEST_ATTR] = "0" * 16
    gate = bs.mature_inputs_gate(ctx, {}, table)
    assert gate.status == "fail" and "not computed from the embedded" in gate.detail
    with h5py.File(bs.embed_h5(ctx), "r+") as handle:
        mature = bs.parse_fasta_text((ctx.work / "mature.fasta").read_text())
        handle["P00002"].attrs[SEQUENCE_DIGEST_ATTR] = sequence_digest(mature["P00002"])
    assert bs.mature_inputs_gate(ctx, {}, table).status == "pass"
    # A query embedded with the propeptide its reference lacks (the G1 case).
    saved = {
        name: (ctx.work / name).read_bytes() for name in ("mature.tsv", "mature.fasta")
    }
    full = {e["accession"]: e["sequence"] for e in entries}["A0A00035"]
    tsv = saved["mature.tsv"].decode().splitlines()
    tsv = [
        "\t".join(
            [*r.split("\t")[:4], "22", r.split("\t")[5], str(len(full) - 21)]
            + ["chain", ""]
        )
        if r.startswith("A0A00035\t")
        else r
        for r in tsv
    ]
    (ctx.work / "mature.tsv").write_text("\n".join(tsv) + "\n")
    fasta = bs.parse_fasta_text(saved["mature.fasta"].decode())
    fasta["A0A00035"] = full[21:]
    bs.write_fasta(ctx.work / "mature.fasta", fasta, list(fasta))
    gate = bs.mature_inputs_gate(ctx, {}, table)
    assert gate.status == "fail" and "propeptide their references lack" in gate.detail
