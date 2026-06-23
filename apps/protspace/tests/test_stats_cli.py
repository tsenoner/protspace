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
    table = report.to_arrow()
    assert table.schema.names[0] == "space_kind"
    assert table.num_rows == len(report.rows)


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
    table = pipeline._compute_statistics([emb], reductions, headers)
    assert table is not None
    assert table.num_rows > 0
    assert "faithfulness" in set(table.column("stat_family").to_pylist())
