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
import sys
from pathlib import Path

import h5py
import numpy as np
import pandas as pd
import pyarrow as pa
import pyarrow.parquet as pq
import pytest

SCRIPT_DIR = Path(__file__).parent.parent / "scripts" / "generate_examples"
SCRIPT_PATH = SCRIPT_DIR / "build_showcase.py"
spec = importlib.util.spec_from_file_location("build_showcase", SCRIPT_PATH)
bs = importlib.util.module_from_spec(spec)
sys.modules["build_showcase"] = bs
spec.loader.exec_module(bs)
build_showcase = bs

REPO_ROOT = Path(__file__).resolve().parents[3]

# The former apps/web/public/data/datasets.json: the benchmark's default sweep.
FORMER_DEFAULT_SWEEP = [
    "venom_eat_stats",
    "5K",
    "40K",
    "7K_toxprot",
    "35K_ec_brenda",
    "105K_homoSapiens_drosophilaMelanogaster",
    "127K_beta_lactamase",
    "beta_lactamase_ec",
    "beta_lactamase_pn",
    "phosphatase",
]


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


def _write_bundle(
    path: Path,
    annotations,
    *,
    settings=None,
    statistics=None,
    names=("PCA_2", "UMAP_2"),
):
    metadata, data = _projections(names, bs.row_ids(annotations))
    blob = bs.join_parts(
        bs.parquet_bytes(annotations),
        bs.parquet_bytes(metadata),
        bs.parquet_bytes(data),
        bs.settings_bytes(settings) if settings is not None else None,
        bs.parquet_bytes(statistics) if statistics is not None else None,
    )
    path.write_bytes(blob)
    return path


# ---------------------------------------------------------------------------
# Encoding and display values
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    "value",
    [
        "PF00017 (SH2)|97.6;PF00018 (SH3_1)|64.1",
        "family (a; b) name|IC",
        "3.1.1.4 (phospholipase A2)",
        "100% match|EXP",
        "tab\there",
        "",
    ],
)
def test_vendored_encoding_matches_protspace(value):
    from protspace.data.annotations import encoding

    assert bs.encode_field(value) == encoding.encode_field(value)
    assert bs.decode_field(bs.encode_field(value)) == value
    assert bs.encode_legacy_cell(value) == encoding.encode_legacy_cell(value)


def test_migrate_v1_columns_matches_protspace_and_counts_changes():
    from protspace.data.annotations.encoding import migrate_legacy_annotation_table

    table = pa.table(
        {
            "protein_id": ["P1", "P2"],
            "ec": ["1.1.1.1 (x; y)", None],
            "ec__pred_source": ["A|B", "Q9"],
            "length": [10, 20],
        }
    )
    migrated, changed = bs.migrate_v1_columns(table)
    assert migrated.to_pylist() == migrate_legacy_annotation_table(table).to_pylist()
    # A ";" inside a label's parentheses is text, not a hit separator.
    assert changed == {"ec": 1, "ec__pred_source": 1}
    assert migrated.column("ec").to_pylist() == ["1.1.1.1 (x%3B y)", None]
    assert migrated.column("ec__pred_source").to_pylist() == ["A%7CB", "Q9"]


def test_display_values_and_cell_labels():
    assert bs.display_values("A|IC;B%3Bc|1.0") == ["A", "B;c"]
    assert bs.display_values(None) == ["None"]
    assert bs.cell_labels(" A |x; ;__NA__") == ["A"]
    assert bs.cell_labels(None) == []
    assert bs.cell_labels(42) == ["42"]
    assert bs.first_label("B|x;A") == "B"
    assert bs.is_missing("") and not bs.is_missing("x")


def test_format_version_defaults_to_v1():
    table = pa.table({"a": [1]})
    assert bs.format_version(table) == 1
    assert bs.format_version(bs.stamp_v2(table)) == 2


# ---------------------------------------------------------------------------
# Bundle helpers: split_bundle / select_proj / extract_ann
# ---------------------------------------------------------------------------


def test_split_bundle_writes_parts_byte_for_byte(tmp_path):
    stats = pa.table({"space_kind": ["projection"], "space_name": ["UMAP_2"]})
    bundle = _write_bundle(
        tmp_path / "b.parquetbundle",
        _annotations(ec=["a", "b", "c"]),
        settings={"ec": {"categories": {}}},
        statistics=stats,
    )
    parts = bs.split_parts(bundle.read_bytes())
    written = bs.split_bundle(bundle, tmp_path / "out")
    assert set(written) == {
        "annotations.parquet",
        "projections_metadata.parquet",
        "projections_data.parquet",
        "statistics.parquet",
        "settings.json",
    }
    assert (tmp_path / "out" / "annotations.parquet").read_bytes() == parts[0]
    assert (tmp_path / "out" / "statistics.parquet").read_bytes() == parts[4]
    assert json.loads((tmp_path / "out" / "settings.json").read_text()) == {
        "ec": {"categories": {}}
    }


def test_statistics_without_settings_keep_a_zero_byte_slot(tmp_path):
    stats = pa.table({"space_kind": ["projection"]})
    bundle = _write_bundle(
        tmp_path / "b.parquetbundle", _annotations(), statistics=stats
    )
    parts = bs.split_parts(bundle.read_bytes())
    assert len(parts) == 5 and parts[3] == b""
    read = bs.read_bundle(bundle)
    assert read.settings is None and read.statistics.num_rows == 1
    assert "settings.json" not in bs.split_bundle(bundle, tmp_path / "out")


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
    before = bs.coordinate_map(data)
    after = bs.coordinate_map(out)
    assert after[("ProtT5 — UMAP 2", "P2")] == before[("UMAP_2", "P2")]
    assert len(after) == len(before)


def test_select_projections_can_drop_one_and_rejects_unknown_names():
    metadata, data = _projections()
    meta, out = bs.select_projections(metadata, data, [("UMAP_2", "U")])
    assert meta.num_rows == 1 and set(out.column("projection_name").to_pylist()) == {
        "U"
    }
    assert "quality" in meta.column("info_json")[0].as_py()
    with pytest.raises(bs.BuildError, match="not found"):
        bs.select_projections(metadata, data, [("TSNE_2", "T")])


def test_select_proj_directory_form(tmp_path):
    metadata, data = _projections()
    pq.write_table(metadata, tmp_path / "projections_metadata.parquet")
    pq.write_table(data, tmp_path / "projections_data.parquet")
    bs.select_proj(tmp_path, "UMAP_2=ProtT5 — UMAP 2", tmp_path / "out")
    names = pq.read_table(tmp_path / "out" / "projections_metadata.parquet").column(
        "projection_name"
    )
    assert names.to_pylist() == ["ProtT5 — UMAP 2"]


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


def _eat_fresh():
    return pa.table(
        {
            "identifier": ["R1", "Q1", "Q2"],
            "ec": ["9.9.9.9 (new)", "1.1.1.1 (a)|EXP", "3.3.3.3 (c)"],
            "protein_families": ["fam new", "fam A", "fam C"],
            "species": ["new R", "new Q1", "new Q2"],
            "pfam": ["PF9", "PF1", "PF2"],
            "organism_id": ["1", "2", "3"],
        }
    )


def test_graft_refresh_keeps_frozen_columns_and_fills_withheld_truth_on_queries_only():
    spec_ = bs.GraftSpec(
        frozen=["ec", "protein_families", "eat_split", "*__pred_*"],
        keep_paper_columns=False,
        withheld={"ec": "ec_withheld", "protein_families": "protein_families_withheld"},
        split_column="eat_split",
        query_value="query",
    )
    table, report = bs.graft_columns(_eat_paper(), _eat_fresh(), spec_)
    rows = {r["protein_id"]: r for r in table.to_pylist()}
    assert (
        rows["Q1"]["ec"] == "" and rows["R1"]["ec"] == "1.1.1.1 (a)"
    )  # paper, never fresh
    assert rows["Q2"]["species"] == "new Q2"  # refreshed
    assert rows["R1"]["pfam"] == "PF9"  # new source added
    assert rows["Q1"]["ec_withheld"] == "1.1.1.1 (a)|EXP"
    assert rows["R1"]["ec_withheld"] is None  # truth only for the queries
    assert (
        "sequence" not in table.column_names and "organism_id" not in table.column_names
    )
    assert report["origin"]["ec"] == "paper-frozen"
    assert report["origin"]["species"] == "refreshed"
    assert report["origin"]["ec_withheld"] == "withheld-truth"
    bs.assert_no_refill(table, "eat_split", "query", ["ec", "protein_families"])


def test_graft_keep_paper_columns_only_adds_new_sources():
    spec_ = bs.GraftSpec(frozen=["ec", "*__pred_*"], keep_paper_columns=True)
    table, report = bs.graft_columns(_eat_paper(), _eat_fresh(), spec_)
    assert table.column("species").to_pylist() == ["old"] * 3
    assert table.column("pfam").to_pylist() == ["PF1", "PF2", "PF9"]
    assert report["origin"]["species"] == "paper"


def test_graft_reports_accessions_the_fetch_missed():
    fresh = _eat_fresh().slice(0, 2)
    _, report = bs.graft_columns(_eat_paper(), fresh, bs.GraftSpec(frozen=["ec"]))
    assert report["absent_from_fetch"] == ["Q2"]


def test_no_refill_guard_detects_a_leaked_query_value():
    table = _eat_paper().set_column(1, "ec", pa.array(["1.1.1.1 (a)", "", "x"]))
    assert bs.refill_violations(
        table, "eat_split", "query", ["ec", "protein_families"]
    ) == {"ec": ["Q1"]}
    with pytest.raises(bs.BuildError, match="hold-out leak"):
        bs.assert_no_refill(table, "eat_split", "query", ["ec"])


# ---------------------------------------------------------------------------
# Provenance
# ---------------------------------------------------------------------------


def test_provenance_round_trip_keeps_the_format_stamp():
    table = bs.stamp_v2(_annotations())
    table = table.replace_schema_metadata({**table.schema.metadata, b"pandas": b"{}"})
    stamped = bs.set_provenance(
        table,
        {
            "example_id": "venom-eat",
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
    assert found["example_id"] == "venom-eat" and found["protspace_version"] == "4.14.0"
    assert found["uniprot_release"]["refreshed"]["release"] == "2026_03"
    assert found["pipeline"] == ["protspace annotate …"]
    with pytest.raises(bs.BuildError):
        bs.set_provenance(table, {"surprise": "x"})


def test_release_groups_label_every_column():
    groups = bs.release_groups(
        {"ec": "paper-frozen", "pfam": "refreshed", "ec_withheld": "withheld-truth"},
        ["protein_id", "ec", "pfam", "ec_withheld", "cluster_elbow_U", "species"],
        {"refreshed": "2026_03", "paper": "2025_03", "withheld-truth": "2026_03"},
    )
    assert groups["paper"] == {"release": "2025_03", "columns": ["ec"]}
    assert groups["refreshed"]["columns"] == ["pfam", "species"]
    assert groups["computed"] == {"release": None, "columns": ["cluster_elbow_U"]}
    assert groups["withheld-truth"]["columns"] == ["ec_withheld"]


# ---------------------------------------------------------------------------
# EAT accuracy (phosphatase gate)
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
    # Q4 has no truth; Q1 and Q3 are exact (order-free), Q2 is wrong.
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
            "expected_n": 3,
            "expected_accuracy": 66.7,
            "expected_n_at_threshold": 2,
            "expected_accuracy_at_threshold": 50.0,
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
    table = table.append_column(
        "ec__pred_source", pa.array(["R1", None, None, None, None])
    )
    source = bs.gate_eat_source(
        table,
        {
            "accession": "Q1",
            "column": "ec",
            "source": "R1",
            "confidence": 0.9,
            "value_contains": "1.1.1.1",
        },
    )
    assert source.status == "pass"
    assert (
        bs.gate_eat_source(
            table, {"accession": "X", "column": "ec", "source": "R1", "confidence": 0.9}
        ).status
        == "fail"
    )


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
        "demo": {
            "projection": "ProtT5 — UMAP 2",
            "annotation": "protein_families",
            "tooltip": ["species", "ec"],
        },
        "venom-eat": {
            "projection": "ProtT5 — PCA 2",
            "annotation": "ec",
            "tooltip": [],
        },
    }


def test_resolve_default_view_prefers_the_catalog(tmp_path):
    catalog = tmp_path / "example-datasets.ts"
    catalog.write_text(CATALOG)
    dataset = {"default_view": {"projection": "P", "annotation": "a", "tooltip": ["b"]}}
    view, source = bs.resolve_default_view("venom-eat", dataset, catalog)
    assert view["projection"] == "ProtT5 — PCA 2" and source.startswith("catalog")
    view, source = bs.resolve_default_view("swissprot", dataset, catalog)
    assert view == dataset["default_view"] and "provisional" in source


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


def test_filter_legend_and_settings_shapes():
    table = _annotations(protein_families=["A", "B|IC", ""])
    legend = {
        "sortMode": "manual",
        "categories": {"A": {"zOrder": 0}, "Z": {"zOrder": 1}, "__NA__": {"zOrder": 2}},
    }
    kept, notes = bs.filter_legend(legend, table, "protein_families")
    assert list(kept["categories"]) == ["A", "__NA__"] and len(notes) == 1
    assert bs.make_settings({"a": {}}, None) == {"a": {}}
    assert bs.make_settings({}, None) is None
    envelope = bs.make_settings({"a": {}}, {"eatConfidenceThreshold": 0.5})
    assert envelope == {
        "legendSettings": {"a": {}},
        "exportOptions": {},
        "eatConfidenceThreshold": 0.5,
    }
    assert bs.unwrap_legends(envelope) == {"a": {}}
    assert bs.unwrap_legends({"a": {}}) == {"a": {}}
    assert bs.unwrap_legends(None) == {}


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


def test_common_gates_flag_leaks_and_membership(tmp_path):
    table = bs.stamp_v2(
        _annotations(
            ec=["a", "b", "c"],
            reviewed=["Swiss-Prot"] * 3,
            xref_pdb=["True", "False", "False"],
            protein_name=["x", "y", "z"],
            sequence=["M", "M", "M"],
        )
    )
    bundle = bs.read_bundle(
        _write_bundle(tmp_path / "b.parquetbundle", table, names=("U",))
    )
    gates = {
        g.name: g
        for g in bs.common_gates(
            bundle,
            {"proteins": 3, "reviewed": "Swiss-Prot"},
            {"projection": "U", "annotation": "ec"},
        )
    }
    assert gates["proteins"].status == "pass"
    assert gates["membership"].status == "pass"
    assert gates["no-internal-or-legacy"].status == "fail"
    assert gates["format-v2"].status == "pass"
    assert gates["xref_pdb"].status == "pass"
    assert gates["reviewed"].status == "pass"
    assert gates["default-view"].status == "pass"
    ok, summary = bs.summarize(list(gates.values()))
    assert not ok and "1 fail" in summary


def test_faithfulness_gate_needs_a_score_per_projection():
    metadata, _ = _projections()
    assert bs.faithfulness_gate(metadata, {}).status == "pass"
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
    assert bs.faithfulness_gate(skipped, {}).status == "fail"


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
    rows = bs.clustering_report(
        bundle, "demo", {"annotations": ["fam", "noise", "absent"]}, tmp_path, k=5
    )
    assert rows[0]["annotation"] == "fam" and rows[0]["legend_kappa"] > 0.9
    assert any(r.get("error") for r in rows)
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
    assert bs.split_h5_spec("/a/b.h5:prot_t5") == ("/a/b.h5", "prot_t5")
    assert bs.split_h5_spec("/a/b.h5") == ("/a/b.h5", None)
    fasta = tmp_path / "x.fasta"
    assert bs.write_fasta(fasta, {"P1": "MK"}, ["P1", "P2"]) == 1
    assert fasta.read_text() == ">P1\nMK\n"


def test_read_capabilities(tmp_path):
    source = tmp_path / "src" / "protspace"
    (source / "cli").mkdir(parents=True)
    (source / "stats" / "metrics").mkdir(parents=True)
    (source / "cli" / "annotate.py").write_text("typer.Option('--cache-dir')")
    (source / "stats" / "metrics" / "faithfulness.py").write_text(
        "DEFAULT_HARD_CEILING = 20_000\n"
    )
    assert bs.read_capabilities(tmp_path) == {
        "annotate_cache_dir": True,
        "faithfulness_ceiling": 20000,
    }
    (source / "stats" / "metrics" / "faithfulness.py").write_text("# ceiling removed\n")
    assert bs.read_capabilities(tmp_path)["faithfulness_ceiling"] is None


# ---------------------------------------------------------------------------
# showcase.toml and the build plan
# ---------------------------------------------------------------------------


@pytest.fixture(scope="module")
def config():
    return bs.Config.load(bs.DEFAULT_CONFIG)


def test_showcase_toml_lists_the_six_final_ids(config):
    assert list(config.datasets) == [
        "demo",
        "venom-eat",
        "phosphatase-eat",
        "human-fly",
        "beta-lactamase",
        "swissprot",
    ]
    proteins = [d["proteins"] for d in list(config.datasets.values())[1:]]
    assert proteins == sorted(proteins)  # demo first, then ascending count
    assert config.datasets["swissprot"].get("large") is True
    assert config.datasets["demo"]["hosting"] == "repo"


def test_every_recipe_is_complete(config):
    for ds_id, dataset in config.datasets.items():
        view = dataset["default_view"]
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
                "full_length_inputs",
                "source_column_kept",
                "pfam_duplicates",
                "browser_load",
            }, (ds_id, gate["type"])


def test_eat_thresholds_follow_d6(config):
    assert config.datasets["venom-eat"]["envelope"]["eatConfidenceThreshold"] == 0
    assert (
        config.datasets["phosphatase-eat"]["envelope"]["eatConfidenceThreshold"] == 0.5
    )
    withheld = config.datasets["phosphatase-eat"]["withheld"]["columns"]
    tooltip = config.datasets["phosphatase-eat"]["default_view"]["tooltip"]
    assert set(withheld.values()) <= set(tooltip)


def _context(config, ds_id, tmp_path, cli=None, **kwargs):
    dataset = config.datasets[ds_id]
    return bs.Context(
        ds_id=ds_id,
        dataset=dataset,
        config=config,
        out_root=tmp_path,
        cli=cli,
        release="2026_03",
        dry_run=kwargs.pop("dry_run", True),
        view=dataset["default_view"],
        view_source="test",
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


@pytest.mark.parametrize(
    "ds_id",
    [
        "demo",
        "venom-eat",
        "phosphatase-eat",
        "human-fly",
        "beta-lactamase",
        "swissprot",
    ],
)
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
        c[0] in {"prepare", "annotate", "stats", "bundle", "style"} for c in commands
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
        {"ec": "paper-frozen", "pfam": "refreshed"},
        ["protein_id", "ec", "pfam", "cluster_elbow_U"],
        {"refreshed": "2026_03", "paper": "2025_03"},
    )
    table = bs.set_provenance(
        bs.stamp_v2(_annotations(ec=["a", "b", "c"], pfam=["x", "y", "z"])),
        {
            "example_id": "venom-eat",
            "protspace_version": "4.14.0",
            "git_sha": "abc",
            "uniprot_release": groups,
            "membership_release": "2025_03",
            "built_at": "2026-10-01T00:00:00+00:00",
            "command": "build_showcase.py build --only venom-eat",
            "pipeline": ["protspace annotate …"],
        },
    )
    bundle = _write_bundle(
        tmp_path / "venom-eat_2026_03.parquetbundle", table, names=("U",)
    )
    record = _write_manifest_module().read_bundle_record(
        bundle, example_id="venom-eat", file=bundle.name, hosting="release"
    )
    assert record["releases"] == {
        "membership": "2025_03",
        "annotations": {"paper": "2025_03", "refreshed": "2026_03"},
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
    # venom-eat: every input is in the repository (the swissprot ones are not).
    cli = bs.Cli(REPO_ROOT, dry_run=True)
    ctx = _context(config, "venom-eat", tmp_path, cli=cli)
    before = {n: _step(ctx, n).key() for n in ("assemble", "stats", "finalize")}
    ctx.dataset = {**ctx.dataset, "gates": [], "report": {}, "name": "renamed"}
    assert {n: _step(ctx, n).key() for n in before} == before
    ctx.dataset = {**ctx.dataset, "membership_release": "2025_04"}
    after = {n: _step(ctx, n).key() for n in before}
    assert after["assemble"] == before["assemble"]
    assert after["stats"] == before["stats"]
    assert after["finalize"] != before["finalize"]
    ctx.dataset = {**ctx.dataset, "freeze_statistics": False}
    assert _step(ctx, "stats").key() != before["stats"]
    ctx.view = {**ctx.view, "annotation": "protein_families"}
    assert _step(ctx, "assemble").key() != before["assemble"]


def test_every_local_step_declares_its_inputs(config, tmp_path):
    for ds_id in config.datasets:
        cli = bs.Cli(REPO_ROOT, dry_run=True)
        ctx = _context(config, ds_id, tmp_path, cli=cli)
        steps = [s for s in bs.recipe_steps(ctx) if not s.always]
        assert all(s.inputs is not None for s in steps), ds_id
        assert {s.name for s in steps if s.fetches} >= (
            {"annotate", "fasta"}
            if config.datasets[ds_id].get("refresh_groups")
            else {"fetch-1"}
        )


def test_a_dry_run_writes_nothing(config, tmp_path):
    cli = bs.Cli(REPO_ROOT, dry_run=True)
    for ds_id in ("venom-eat", "phosphatase-eat", "demo"):
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
    frame.attrs[bs.CACHE_RELEASE_ATTR] = "2026_03,2026_02"
    frame.to_parquet(tmp_path / "all_annotations.parquet", index=False)
    assert bs.cache_release_stamp(tmp_path / "all_annotations.parquet") == {
        "2026_02",
        "2026_03",
    }
    pd.DataFrame({"identifier": ["P1"]}).to_parquet(tmp_path / "plain.parquet")
    assert bs.cache_release_stamp(tmp_path / "plain.parquet") is None
    assert bs.cache_release_stamp(tmp_path / "absent.parquet") is None


def _facts(ctx, facts):
    ctx.work.mkdir(parents=True, exist_ok=True)
    (ctx.work / "facts.json").write_text(json.dumps(facts))


def test_fetched_release_ignores_what_uniprot_serves_later(config, tmp_path):
    cli = bs.Cli(REPO_ROOT, dry_run=True)
    ctx = _context(config, "venom-eat", tmp_path, cli=cli, dry_run=False)
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
    ctx = _context(config, "venom-eat", tmp_path, cli=cli, dry_run=False)
    _facts(ctx, facts)
    with pytest.raises(bs.BuildError, match=message):
        bs.fetched_release(ctx)
    ctx.allow_release_mismatch = True
    bs.fetched_release(ctx)  # allowed: warns instead


def test_data_releases_only_count_this_recipes_fetch_steps(config, tmp_path):
    cli = bs.Cli(REPO_ROOT, dry_run=True)
    ctx = _context(config, "venom-eat", tmp_path, cli=cli, dry_run=False)
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
    ctx = _context(config, "venom-eat", tmp_path, dry_run=False)
    _built(ctx)
    with pytest.raises(bs.BuildError, match="refusing to stage"):
        bs.stage_release(config, tmp_path, "2026_03", tmp_path / "s", ["venom-eat"])
    assert not (tmp_path / "s").exists()


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
        "stage-perf",
    ):
        assert command in parser_help
    with pytest.raises(SystemExit):
        bs.parse_args(["manifest"])
    args = bs.parse_args(["stage-perf", "--out", "/tmp/x"])
    assert args.out == Path("/tmp/x") and args.nm_dir is None
    args = bs.parse_args(["build", "--only", "swissprot", "--no-web-cut"])
    assert args.web_cut is False
    assert bs.parse_args(["build", "--only", "swissprot"]).web_cut is None


# ---------------------------------------------------------------------------
# stage-perf (the perf-datasets release; perf/datasets.manifest.json)
# ---------------------------------------------------------------------------


def test_perf_datasets_keep_their_original_ids_and_default_sweep():
    datasets = build_showcase.PERF_DATASETS
    ids = [d.id for d in datasets]
    assert len(set(ids)) == len(ids)
    assert [d.id for d in datasets if d.default] == FORMER_DEFAULT_SWEEP
    # The eleven former public/data bundles plus the 113K and the 832.
    assert len(datasets) == 13
    assert {"573K_swissprot", "beta_lactamase_2026_stats", "phosphatase_eat"} <= set(
        ids
    )
    for dataset in datasets:
        assert dataset.file == f"{dataset.id}.parquetbundle"
        # Every source is pinned: a git blob id, or a checksum for a file outside git.
        assert (dataset.blob is None) != (dataset.sha256 is None)


def test_stage_perf_writes_files_checksums_and_the_manifest(tmp_path, monkeypatch):
    manifest_path = tmp_path / "datasets.manifest.json"
    monkeypatch.setattr(build_showcase, "PERF_MANIFEST", manifest_path)
    monkeypatch.setattr(build_showcase, "REPO_ROOT", tmp_path)
    monkeypatch.setattr(
        build_showcase, "read_dataset", lambda dataset, _nm: dataset.id.encode()
    )
    out = tmp_path / "staged"

    records = build_showcase.stage_perf(out, tmp_path, write_manifest=True)

    first = build_showcase.PERF_DATASETS[0]
    digest = hashlib.sha256(first.id.encode()).hexdigest()
    assert (out / first.file).read_bytes() == first.id.encode()
    assert f"{digest}  {first.file}" in (out / "SHA256SUMS").read_text().splitlines()
    manifest = json.loads(manifest_path.read_text())
    assert manifest["release"] == "perf-datasets"
    assert manifest["datasets"] == records
    assert records[0] == {
        "id": first.id,
        "file": first.file,
        "bytes": len(first.id),
        "sha256": digest,
        "default": True,
        "source": f"git blob {first.blob} ({first.path})",
    }


def test_a_workspace_file_with_the_wrong_checksum_is_refused(tmp_path):
    dataset = build_showcase.PerfDataset(
        "x", "data/x/data.parquetbundle", False, sha256="0" * 64
    )
    path = tmp_path / dataset.path
    path.parent.mkdir(parents=True)
    path.write_bytes(b"not the manuscript's bytes")

    with pytest.raises(SystemExit, match="expected"):
        build_showcase.read_dataset(dataset, tmp_path)


def test_publish_commands_name_the_release_and_every_asset(tmp_path):
    (tmp_path / "a.parquetbundle").write_bytes(b"a")
    (tmp_path / "SHA256SUMS").write_text("")

    create, upload = build_showcase.publish_commands(
        "perf-datasets", tmp_path, "T", "N"
    )

    assert create.startswith(
        "gh release create perf-datasets --repo tsenoner/protspace --latest=false "
    )
    assert str(tmp_path / "a.parquetbundle") in create
    assert str(tmp_path / "SHA256SUMS") in create
    assert "--clobber" in upload


def test_showcase_toml_has_no_second_perf_list(config):
    # PERF_DATASETS is the one list; perf/datasets.manifest.json is its output.
    assert "perf" not in config.raw
    manifest = json.loads((REPO_ROOT / "perf" / "datasets.manifest.json").read_text())
    assert [d["id"] for d in manifest["datasets"]] == [
        d.id for d in build_showcase.PERF_DATASETS
    ]


# ---------------------------------------------------------------------------
# End to end, offline: fake network + annotate, real protspace bundle/style/stats
# ---------------------------------------------------------------------------


def _first(*paths: Path) -> Path | None:
    return next((p for p in paths if p.is_file()), None)


class FakeCli(bs.Cli):
    """Runs the installed protspace, except ``annotate``, which writes a table."""

    def __init__(self, annotate):
        super().__init__(REPO_ROOT)
        self.annotate = annotate
        self.commands = []

    def argv(self, args):
        return [str(Path(sys.executable).with_name("protspace")), *map(str, args)]

    def run(self, args, *, cwd, log, transcript=None):
        self.commands.append(args[0])
        if args[0] == "annotate":
            fasta = Path(args[args.index("-i") + 1])
            ids = list(bs.parse_fasta_text(fasta.read_text()))
            pq.write_table(self.annotate(ids), args[args.index("-o") + 1])
            if "--cache-dir" in args:
                # Like the CLI, stamp the release its UniProt values came from.
                cache = Path(args[args.index("--cache-dir") + 1])
                cache.mkdir(parents=True, exist_ok=True)
                frame = pd.DataFrame({"identifier": ids})
                frame.attrs[bs.CACHE_RELEASE_ATTR] = "2026_03"
                frame.to_parquet(cache / "all_annotations.parquet", index=False)
            return bs.CliResult()
        return super().run(args, cwd=cwd, log=log, transcript=transcript)

    def capabilities(self):
        return {"annotate_cache_dir": True, "faithfulness_ceiling": None}

    def version(self):
        return "test"


@pytest.fixture
def offline(monkeypatch):
    monkeypatch.setattr(bs, "current_uniprot_release", lambda: "2026_03")
    monkeypatch.setattr(
        bs,
        "fetch_uniprot_sequences",
        lambda ids, chunk=100: (dict.fromkeys(ids, "MKTAYIAKQR"), {"2026_03"}),
    )


def _confirmed(config, ds_id, release="2025_03"):
    """A copy of ``config`` whose author facts for ``ds_id`` are confirmed releases."""
    local = copy.copy(config)
    local.raw = copy.deepcopy(config.raw)
    dataset = local.raw["datasets"][ds_id]
    dataset["membership_release"] = release
    dataset["paper_release"] = release
    return local


@pytest.mark.slow
def test_venom_eat_builds_offline_and_passes_its_gates(config, tmp_path, offline):
    source = _first(
        REPO_ROOT / "apps/web/tests/fixtures/venom_eat_stats_811.parquetbundle",
        REPO_ROOT / "apps/web/public/data/venom_eat_stats.parquetbundle",
    )
    if source is None:
        pytest.skip("venom bundle not in this checkout")

    def annotate(ids):
        return pa.table(
            {
                "identifier": ids,
                "pfam": [f"PF{i % 7:05d} (dom{i % 7})|12.5" for i in range(len(ids))],
                "ted_domains": [
                    "" if i % 3 else "3.30.30.10|91.2" for i in range(len(ids))
                ],
                "predicted_subcellular_location": ["Extracellular" for _ in ids],
                "gene_name": ["fresh" for _ in ids],  # must not replace the paper value
                "protein_name": ["fresh name" for _ in ids],  # the CLI always adds it
            }
        )

    local = _confirmed(config, "venom-eat")
    cli = FakeCli(annotate)
    ctx = _context(
        local, "venom-eat", tmp_path, cli=cli, dry_run=False, thumbnails=False
    )
    bs.execute(ctx, bs.recipe_steps(ctx))
    assert cli.commands == ["annotate", "bundle", "style"]
    ok, gates = bs.verify(ctx)
    by_name = {g.name: g for g in gates}
    failed = {n: g.detail for n, g in by_name.items() if g.status == "fail"}
    assert ok, failed
    for name in (
        "eat:ec",
        "eat-source:P0DPU8",
        "frozen-columns",
        "statistics-frozen",
        "coordinates",
        "settings-envelope",
        "faithfulness",
    ):
        assert by_name[name].status == "pass", name
    final = bs.read_bundle(ctx.final)
    assert final.metadata.column("projection_name").to_pylist()[0] == "ProtT5 — UMAP 2"
    assert final.annotations.column_names[1] == "ec"
    assert final.settings["eatConfidenceThreshold"] == 0
    assert "ec" in final.settings["legendSettings"]  # the curated legend
    assert (
        "cluster_elbow_ProtT5 — UMAP 2" in final.settings["legendSettings"]
    )  # carried
    assert (
        "pfam" in final.annotations.column_names
        and "sequence" not in final.annotations.column_names
    )
    provenance = bs.read_provenance(final.annotations)
    assert provenance["uniprot_release"]["refreshed"]["columns"] == [
        "pfam",
        "ted_domains",
        "predicted_subcellular_location",
    ]
    assert "gene_name" in provenance["uniprot_release"]["paper"]["columns"]
    assert provenance["uniprot_release"]["refreshed"]["release"] == "2026_03"
    assert by_name["provenance"].status == "pass"
    bs.report(ctx)
    assert (ctx.root / "report" / "report.json").is_file()

    # A second build re-runs nothing: every marker matches its inputs.
    cli.commands.clear()
    bs.execute(ctx, bs.recipe_steps(ctx))
    assert cli.commands == []

    # Staged through write_manifest.py, which reads the stamped provenance.
    staging = tmp_path / "staging"
    manifest = bs.stage_release(
        local,
        tmp_path,
        "2026_03",
        staging,
        ["venom-eat"],
        previous_manifest=tmp_path / "absent.ts",
    )
    record = manifest["examples"]["venom-eat"]
    assert record["file"] == "venom-eat_2026_03.parquetbundle"
    assert record["hosting"] == "release" and manifest["release"] == "showcase-2026_03"
    assert record["releases"]["annotations"]["refreshed"] == "2026_03"
    assert record["sha256"] == hashlib.sha256(ctx.final.read_bytes()).hexdigest()
    written = (staging / "example-manifest.ts").read_text()
    assert _write_manifest_module().parse_manifest(written) == manifest
    sums = (staging / "SHA256SUMS").read_text()
    assert sums == f"{record['sha256']}  venom-eat_2026_03.parquetbundle\n"


@pytest.mark.slow
def test_phosphatase_eat_builds_offline_with_stats_and_guards_the_hold_out(
    config, tmp_path, offline
):
    source = REPO_ROOT / "apps/web/tests/fixtures/phosphatase_eat.parquetbundle"
    if not source.is_file():
        pytest.skip("phosphatase fixture not in this checkout")
    paper = bs.read_bundle(source).annotations.to_pydict()
    predicted = dict(zip(paper["protein_id"], paper["ec__pred_value"], strict=True))

    # A fake ProtT5 file with the benchmark's ids; stats only needs vectors.
    h5_dir = tmp_path / "cli_data" / "eat_demo"
    h5_dir.mkdir(parents=True)
    rng = np.random.default_rng(0)
    with h5py.File(h5_dir / "phosphatase_prot_t5.h5", "w") as handle:
        for accession in paper["protein_id"]:
            handle.create_dataset(
                accession, data=rng.normal(size=16).astype(np.float16)
            )
    local = bs.Config.load(bs.DEFAULT_CONFIG, {"cli_data": str(tmp_path / "cli_data")})
    local.raw["datasets"]["phosphatase-eat"]["pins"] = []
    assert local.datasets["phosphatase-eat"]["membership_release"] == "2025_03"

    def annotate(ids):
        # The "truth": the transferred EC for queries, so accuracy is 100 %.
        return pa.table(
            {
                "identifier": ids,
                "ec": [predicted.get(a) or "3.1.3.16 (x)" for a in ids],
                "protein_families": ["PPP phosphatase family" for _ in ids],
                "species": ["Homo sapiens" for _ in ids],
                "domain": [
                    "Eukaryota" if i % 3 else "Bacteria" for i in range(len(ids))
                ],
                "kingdom": ["Metazoa" if i % 2 else "Fungi" for i in range(len(ids))],
                "reviewed": ["Swiss-Prot" for _ in ids],
                "protein_name": ["p" for _ in ids],
                "xref_pdb": [
                    "True" if i % 4 == 0 else "False" for i in range(len(ids))
                ],
            }
        )

    cli = FakeCli(annotate)
    ctx = _context(
        local,
        "phosphatase-eat",
        tmp_path / "out",
        cli=cli,
        dry_run=False,
        thumbnails=False,
    )
    bs.execute(ctx, bs.recipe_steps(ctx))
    assert cli.commands == ["annotate", "stats", "bundle", "style"]
    ok, gates = bs.verify(ctx)
    by_name = {g.name: g for g in gates}
    for name in (
        "no-refill",
        "frozen-columns",
        "coordinates",
        "settings-envelope",
        "default-view",
        "counts:eat_split",
        "faithfulness",
    ):
        assert by_name[name].status == "pass", (name, by_name[name].detail)
    accuracy = by_name["eat-accuracy:ec"]
    assert accuracy.data["n"] == 213 and accuracy.data["accuracy"] == 100.0
    assert accuracy.status == "fail"  # fake truth, so the paper's 91.5 % is not met
    assert not ok
    # A failed gate keeps the file out of the release.
    problem = bs.release_readiness(ctx.final, ctx.root / "verify.json")
    assert problem and "eat-accuracy:ec (fail)" in problem
    final = bs.read_bundle(ctx.final)
    rows = final.annotations.to_pylist()
    queries = [r for r in rows if r["eat_split"] == "query"]
    assert all(r["ec"] in ("", None) and r["ec_withheld"] for r in queries)
    assert all(r["ec_withheld"] is None for r in rows if r["eat_split"] == "reference")
    assert bs.format_version(final.annotations) == 2
    assert final.settings["eatConfidenceThreshold"] == 0.5
    assert any(c.startswith("cluster_") for c in final.annotations.column_names)
    stats_names = set(final.statistics.column("annotation").to_pylist())
    assert "eat_split" not in stats_names and not any(
        "__pred_" in (n or "") for n in stats_names
    )
