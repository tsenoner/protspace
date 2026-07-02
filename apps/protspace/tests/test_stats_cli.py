"""Integration tests for the discrete `protspace stats` path and prepare wiring."""

from __future__ import annotations

import h5py
import numpy as np
import pyarrow as pa
import pyarrow.parquet as pq
import pytest
from sklearn.datasets import make_blobs
from sklearn.decomposition import PCA

from protspace.cli.stats import _load_reductions
from protspace.data.loaders import load_h5
from protspace.stats import compute_statistics


def _project_dir(tmp_path, n=150, dim=6, centers=4, seed=0):
    X, _ = make_blobs(n_samples=n, centers=centers, n_features=dim, random_state=seed)
    headers = [f"p{i}" for i in range(n)]
    coords = PCA(n_components=2, random_state=0).fit_transform(X)

    h5_path = tmp_path / "emb.h5"
    with h5py.File(h5_path, "w") as f:
        for i, h in enumerate(headers):
            f.create_dataset(h, data=X[i].astype(np.float32))

    proj = tmp_path / "project"
    proj.mkdir()
    pq.write_table(
        pa.table(
            {
                "projection_name": ["E — PCA 2"],
                "dimensions": [2],
                "info_json": ['{"metric": "euclidean"}'],
            }
        ),
        str(proj / "projections_metadata.parquet"),
    )
    pq.write_table(
        pa.table(
            {
                "projection_name": ["E — PCA 2"] * n,
                "identifier": headers,
                "x": coords[:, 0],
                "y": coords[:, 1],
                "z": [None] * n,
            }
        ),
        str(proj / "projections_data.parquet"),
    )
    return h5_path, proj, headers


def test_load_reductions_reconstructs_coords(tmp_path):
    _, proj, headers = _project_dir(tmp_path)
    reductions = _load_reductions(proj)
    assert len(reductions) == 1
    red = reductions[0]
    assert red["name"] == "E — PCA 2"
    assert red["ids"] == headers
    assert red["data"].shape == (len(headers), 2)
    assert red["info"]["metric"] == "euclidean"


def test_discrete_path_produces_full_matrix(tmp_path):
    h5_path, proj, _ = _project_dir(tmp_path)
    emb = load_h5([h5_path], name_override="E")
    reductions = _load_reductions(proj)
    report = compute_statistics([emb], reductions, rng_seed=42)
    metrics = {r.metric for r in report.rows}
    # cluster-validity (coords only) + faithfulness (embedding matched by id-join)
    assert {"silhouette", "n_clusters"} <= metrics
    assert {"knn_overlap", "trustworthiness", "continuity"} <= metrics
    # The fifth part (to_arrow) now carries aggregate validity only — faithfulness
    # routes to projection metadata, not this table (route-projection-statistics).
    table = report.to_arrow()
    assert table.schema.names[0] == "space_kind"
    assert set(table.column("stat_family").to_pylist()) == {"cluster_validity"}
    assert table.num_rows == len(report.partition()["statistics_part"])


def test_stats_command_writes_aggregate_only_part(tmp_path):
    """`protspace stats -o statistics.parquet` writes validity/meta rows only —
    faithfulness now rides in projection metadata, not this fifth part
    (route-projection-statistics Phase 1A; the prep stats+bundle path stays valid)."""
    from typer.testing import CliRunner

    from protspace.cli.app import app

    h5_path, proj, _ = _project_dir(tmp_path)
    out = tmp_path / "statistics.parquet"
    result = CliRunner().invoke(
        app, ["stats", "-i", f"{h5_path}:E", "-p", str(proj), "-o", str(out)]
    )
    assert result.exit_code == 0, result.output
    assert out.exists()

    table = pq.read_table(str(out))
    families = set(table.column("stat_family").to_pylist())
    assert families == {"cluster_validity"}
    metrics = set(table.column("metric").to_pylist())
    assert {
        "silhouette",
        "davies_bouldin",
        "calinski_harabasz",
        "n_clusters",
    } <= metrics
    assert not ({"knn_overlap", "trustworthiness", "continuity"} & metrics)


def test_stats_settings_out_without_annotations_errors(tmp_path):
    """`--settings-out` without `-a/--annotations` must fail fast rather than
    silently writing nothing — cluster legend styles are only produced alongside
    the per-protein membership columns."""
    from typer.testing import CliRunner

    from protspace.cli.app import app

    h5_path, proj, _ = _project_dir(tmp_path)
    out = tmp_path / "statistics.parquet"
    styles = tmp_path / "styles.json"
    result = CliRunner().invoke(
        app,
        [
            "stats",
            "-i",
            f"{h5_path}:E",
            "-p",
            str(proj),
            "-o",
            str(out),
            "--settings-out",
            str(styles),
        ],
    )
    assert result.exit_code != 0
    assert not styles.exists()


def test_stats_command_writes_faithfulness_into_metadata(tmp_path):
    """`protspace stats` folds faithfulness into projections_metadata.info_json.quality
    in place, so the prep `protspace bundle -p` carries it through to the bundle
    (route-projection-statistics Phase 1B, option A)."""
    import json

    from typer.testing import CliRunner

    from protspace.cli.app import app

    h5_path, proj, _ = _project_dir(tmp_path)
    meta_path = proj / "projections_metadata.parquet"
    before = pq.read_table(str(meta_path))

    out = tmp_path / "statistics.parquet"
    result = CliRunner().invoke(
        app, ["stats", "-i", f"{h5_path}:E", "-p", str(proj), "-o", str(out)]
    )
    assert result.exit_code == 0, result.output

    after = pq.read_table(str(meta_path))
    # All non-info columns and rows preserved; only info_json is enriched.
    assert after.num_rows == before.num_rows
    assert after.column_names == before.column_names
    assert (
        after.column("dimensions").to_pylist()
        == before.column("dimensions").to_pylist()
    )

    info_by_name = dict(
        zip(
            after.column("projection_name").to_pylist(),
            after.column("info_json").to_pylist(),
            strict=False,
        )
    )
    info = json.loads(info_by_name["E — PCA 2"])
    assert {"knn_overlap", "trustworthiness", "continuity"} <= set(info["quality"])
    assert info["quality"]["knn_overlap"]["value"] is not None
    assert info["metric"] == "euclidean"  # pre-existing reducer info preserved


def test_stats_command_enriches_annotations_with_computed_columns(tmp_path):
    """`protspace stats -a annotations.parquet` merges per-protein cluster
    membership + silhouette columns into the annotations file in place
    (route-projection-statistics Phase 2A), so the prep `bundle -a` carries them."""
    from typer.testing import CliRunner

    from protspace.cli.app import app

    h5_path, proj, headers = _project_dir(tmp_path)
    ann_path = tmp_path / "annotations.parquet"
    pq.write_table(
        pa.table({"identifier": headers, "organism": ["x"] * len(headers)}),
        str(ann_path),
    )

    out = tmp_path / "statistics.parquet"
    result = CliRunner().invoke(
        app,
        [
            "stats",
            "-i",
            f"{h5_path}:E",
            "-p",
            str(proj),
            "-a",
            str(ann_path),
            "-o",
            str(out),
        ],
    )
    assert result.exit_code == 0, result.output

    df = pq.read_table(str(ann_path)).to_pandas()
    cluster_cols = [c for c in df.columns if c.startswith("cluster_")]
    assert cluster_cols
    assert not [c for c in df.columns if c.startswith("silhouette_")]  # no 2nd column
    assert "organism" in df.columns  # pre-existing annotation preserved
    assert "identifier" in df.columns
    # membership value = "cluster N|<silhouette>" (category + attached confidence)
    label, _, score = str(df[cluster_cols[0]].iloc[0]).partition("|")
    assert label.startswith("cluster ")
    float(score)  # attached per-point silhouette parses as a number


def test_stats_without_annotations_does_not_compute_per_protein(tmp_path):
    """Without -a, stats stays aggregate+faithfulness only (the per-protein
    computation has nowhere to land, so it is skipped)."""
    from typer.testing import CliRunner

    from protspace.cli.app import app

    h5_path, proj, _ = _project_dir(tmp_path)
    out = tmp_path / "statistics.parquet"
    result = CliRunner().invoke(
        app, ["stats", "-i", f"{h5_path}:E", "-p", str(proj), "-o", str(out)]
    )
    assert result.exit_code == 0, result.output
    table = pq.read_table(str(out))
    assert set(table.column("stat_family").to_pylist()) == {"cluster_validity"}


def test_stats_a_then_bundle_carries_computed_columns_into_bundle(tmp_path):
    """End-to-end prep path: `stats -a` then `bundle -a` ships a bundle whose
    protein_annotations part carries the computed cluster_/silhouette_ columns."""
    from typer.testing import CliRunner

    from protspace.cli.app import app
    from protspace.data.io.bundle import read_bundle

    h5_path, proj, headers = _project_dir(tmp_path)
    runner = CliRunner()
    ann_path = tmp_path / "annotations.parquet"
    pq.write_table(
        pa.table({"identifier": headers, "organism": ["x"] * len(headers)}),
        str(ann_path),
    )

    stats_out = tmp_path / "statistics.parquet"
    r1 = runner.invoke(
        app,
        [
            "stats",
            "-i",
            f"{h5_path}:E",
            "-p",
            str(proj),
            "-a",
            str(ann_path),
            "-o",
            str(stats_out),
        ],
    )
    assert r1.exit_code == 0, r1.output

    bundle_out = tmp_path / "data.parquetbundle"
    r2 = runner.invoke(
        app,
        [
            "bundle",
            "-p",
            str(proj),
            "-a",
            str(ann_path),
            "-s",
            str(stats_out),
            "-o",
            str(bundle_out),
        ],
    )
    assert r2.exit_code == 0, r2.output

    core, _ = read_bundle(bundle_out)
    ann_table = pq.read_table(
        pa.BufferReader(core[0])
    )  # protein_annotations is 1st part
    cols = ann_table.column_names
    assert any(c.startswith("cluster_") for c in cols)
    assert not any(c.startswith("silhouette_") for c in cols)  # folded into cluster_
    assert "protein_id" in cols  # identifier renamed by bundle


def test_stats_settings_out_then_bundle_settings_styles_clusters(tmp_path):
    """End-to-end auto-style: `stats -a --settings-out` writes a valid cluster
    legend-settings JSON, and `bundle --settings` folds it into the bundle's
    settings part (route-projection-statistics Phase 2A.4)."""
    import json

    from typer.testing import CliRunner

    from protspace.cli.app import app
    from protspace.data.io.bundle import read_bundle

    h5_path, proj, headers = _project_dir(tmp_path)
    runner = CliRunner()
    ann_path = tmp_path / "annotations.parquet"
    pq.write_table(pa.table({"identifier": headers}), str(ann_path))

    stats_out = tmp_path / "statistics.parquet"
    styles_out = tmp_path / "cluster_styles.json"
    r1 = runner.invoke(
        app,
        [
            "stats",
            "-i",
            f"{h5_path}:E",
            "-p",
            str(proj),
            "-a",
            str(ann_path),
            "--settings-out",
            str(styles_out),
            "-o",
            str(stats_out),
        ],
    )
    assert r1.exit_code == 0, r1.output
    assert styles_out.exists()
    styles = json.loads(styles_out.read_text())
    cluster_keys = [k for k in styles if k.startswith("cluster_")]
    assert cluster_keys
    env = styles[cluster_keys[0]]
    assert env["selectedPaletteId"] == "kellys" and env["categories"]

    bundle_out = tmp_path / "data.parquetbundle"
    r2 = runner.invoke(
        app,
        [
            "bundle",
            "-p",
            str(proj),
            "-a",
            str(ann_path),
            "-s",
            str(stats_out),
            "--settings",
            str(styles_out),
            "-o",
            str(bundle_out),
        ],
    )
    assert r2.exit_code == 0, r2.output

    _, settings = read_bundle(bundle_out)
    assert settings is not None
    assert any(k.startswith("cluster_") for k in settings)


def test_stats_then_bundle_carries_faithfulness_into_bundle(tmp_path):
    """End-to-end prep path: `protspace stats` then `protspace bundle -p` ships a
    bundle whose projections_metadata.info_json carries faithfulness quality, and
    whose aggregate fifth part stays validity-only."""
    import json

    from typer.testing import CliRunner

    from protspace.cli.app import app
    from protspace.data.io.bundle import read_bundle, read_statistics_from_bundle

    h5_path, proj, headers = _project_dir(tmp_path)
    runner = CliRunner()

    stats_out = tmp_path / "statistics.parquet"
    r1 = runner.invoke(
        app, ["stats", "-i", f"{h5_path}:E", "-p", str(proj), "-o", str(stats_out)]
    )
    assert r1.exit_code == 0, r1.output

    ann_path = tmp_path / "annotations.parquet"
    pq.write_table(pa.table({"identifier": headers}), str(ann_path))

    bundle_out = tmp_path / "data.parquetbundle"
    r2 = runner.invoke(
        app,
        [
            "bundle",
            "-p",
            str(proj),
            "-a",
            str(ann_path),
            "-s",
            str(stats_out),
            "-o",
            str(bundle_out),
        ],
    )
    assert r2.exit_code == 0, r2.output

    core, _ = read_bundle(bundle_out)
    # core parts are raw parquet bytes; projections_metadata is the 2nd part.
    metadata_table = pq.read_table(pa.BufferReader(core[1]))
    info_by_name = dict(
        zip(
            metadata_table.column("projection_name").to_pylist(),
            metadata_table.column("info_json").to_pylist(),
            strict=False,
        )
    )
    info = json.loads(info_by_name["E — PCA 2"])
    assert {"knn_overlap", "trustworthiness", "continuity"} <= set(info["quality"])

    # The fifth part still ships, aggregate-only.
    stats_bytes = read_statistics_from_bundle(bundle_out)
    assert stats_bytes is not None
    fifth = pq.read_table(pa.BufferReader(stats_bytes))
    assert set(fifth.column("stat_family").to_pylist()) == {"cluster_validity"}


def test_prepare_pipeline_compute_statistics(tmp_path):
    from pathlib import Path

    from protspace.data.processors.pipeline import PipelineConfig, ReductionPipeline

    class _EmbSet:
        def __init__(self, name, data, headers):
            self.name = name
            self.data = data
            self.headers = headers

    X, _ = make_blobs(n_samples=120, centers=3, n_features=5, random_state=1)
    headers = [f"p{i}" for i in range(120)]
    coords = PCA(n_components=2, random_state=0).fit_transform(X)
    emb = _EmbSet("E", X, headers)
    reductions = [{"name": "E — PCA 2", "data": coords, "source": "E"}]

    pipeline = ReductionPipeline(PipelineConfig(methods=[], output_path=Path(tmp_path)))
    table, _settings = pipeline._compute_statistics([emb], reductions, headers)
    assert table is not None
    assert table.num_rows > 0
    # Fifth part is aggregate-only now; faithfulness rides in projection metadata.
    families = set(table.column("stat_family").to_pylist())
    assert "cluster_validity" in families
    assert "faithfulness" not in families
    # ...and _compute_statistics routed faithfulness into the reduction's info.quality
    quality = reductions[0]["info"]["quality"]
    assert {"knn_overlap", "trustworthiness", "continuity"} <= set(quality)
