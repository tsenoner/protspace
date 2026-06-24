"""Carriage router: faithfulness → projections_metadata.info_json.quality.

Phase 1A of route-projection-statistics. Per-projection faithfulness scalars are
folded into each projection's ``info_json`` under a ``quality`` object; the
aggregate fifth part stays validity-only.
"""

from __future__ import annotations

import json

import numpy as np
from sklearn.datasets import make_blobs
from sklearn.decomposition import PCA

from protspace.data.processors.base_processor import BaseProcessor
from protspace.stats import compute_statistics
from protspace.stats.base import StatRow, StatsReport
from protspace.stats.carriage import route_faithfulness_to_metadata


class _EmbSet:
    def __init__(self, name, data, headers, precomputed=False):
        self.name = name
        self.data = np.asarray(data, dtype=float)
        self.headers = list(headers)
        self.precomputed = precomputed


def _faith_row(space_name, metric_name, value, **extra):
    return StatRow(
        space_kind="projection",
        space_name=space_name,
        stat_family="faithfulness",
        label_kind="none",
        metric=metric_name,
        metric_kind="faithfulness",
        value=value,
        extra=extra,
        destination="projection_metadata",
    )


def _faith_report(space_name, **provenance):
    report = StatsReport()
    report.add(
        [
            _faith_row(space_name, "knn_overlap", 0.8, **provenance),
            _faith_row(space_name, "trustworthiness", 0.9, **provenance),
            _faith_row(space_name, "continuity", 0.85, **provenance),
        ]
    )
    return report


def test_router_injects_quality_per_metric_with_provenance():
    report = _faith_report("PCA_2", k=15, metric="cosine", sampled=False)
    reductions = [{"name": "PCA_2", "info": {"metric": "cosine"}}]
    route_faithfulness_to_metadata(report, reductions)

    q = reductions[0]["info"]["quality"]
    assert set(q) == {"knn_overlap", "trustworthiness", "continuity"}
    assert q["trustworthiness"]["value"] == 0.9
    # each value records its own provenance (k + distance metric)
    assert q["knn_overlap"]["k"] == 15
    assert q["knn_overlap"]["metric"] == "cosine"
    # pre-existing info keys are preserved
    assert reductions[0]["info"]["metric"] == "cosine"


def test_router_omits_quality_when_no_faithfulness():
    # No faithfulness rows (e.g. projection without an available embedding) → no key.
    report = StatsReport()
    reductions = [{"name": "PCA_2", "info": {"metric": "euclidean"}}]
    route_faithfulness_to_metadata(report, reductions)
    assert "quality" not in reductions[0]["info"]


def test_router_creates_info_dict_when_missing():
    report = _faith_report("PCA_2", k=15, metric="euclidean")
    reductions = [{"name": "PCA_2"}]  # no info dict yet
    route_faithfulness_to_metadata(report, reductions)
    assert "quality" in reductions[0]["info"]


def test_router_maps_skip_nan_to_null_and_keeps_marker():
    report = StatsReport()
    report.add(
        [
            _faith_row(
                "PCA_2",
                "knn_overlap",
                float("nan"),
                skipped="n_too_large",
                n=30000,
                hard_ceiling=20000,
            )
        ]
    )
    reductions = [{"name": "PCA_2", "info": {}}]
    route_faithfulness_to_metadata(report, reductions)

    q = reductions[0]["info"]["quality"]["knn_overlap"]
    assert q["value"] is None  # NaN is not valid JSON → null
    assert q["skipped"] == "n_too_large"
    # The injected info must serialize to strictly valid JSON (no `NaN` token).
    serialized = json.dumps(reductions[0]["info"])
    assert "NaN" not in serialized
    assert json.loads(serialized)["quality"]["knn_overlap"]["value"] is None


def test_router_round_trips_through_projections_metadata_table():
    X, _ = make_blobs(n_samples=120, centers=3, n_features=6, random_state=5)
    coords = PCA(n_components=2, random_state=0).fit_transform(X)
    headers = [f"p{i}" for i in range(120)]
    emb = _EmbSet("e", X, headers)
    reductions = [
        {
            "name": "P",
            "dimensions": 2,
            "info": {"metric": "euclidean"},
            "data": coords,
            "ids": headers,
            "source": "e",
        }
    ]
    report = compute_statistics([emb], reductions, rng_seed=42)
    route_faithfulness_to_metadata(report, reductions)

    table = BaseProcessor({}, {})._create_projections_metadata_table(reductions)
    info = json.loads(table.column("info_json")[0].as_py())
    assert {"knn_overlap", "trustworthiness", "continuity"} <= set(info["quality"])
    # faithfulness stayed OUT of the aggregate fifth part
    families = set(report.to_arrow().column("stat_family").to_pylist())
    assert "faithfulness" not in families


def test_router_multi_embedding_routes_each_projection_to_its_own_scores():
    Xa, _ = make_blobs(n_samples=100, centers=3, n_features=5, random_state=8)
    Xb, _ = make_blobs(n_samples=100, centers=4, n_features=7, random_state=9)
    ha = [f"a{i}" for i in range(100)]
    hb = [f"b{i}" for i in range(100)]
    ea, eb = _EmbSet("A", Xa, ha), _EmbSet("B", Xb, hb)
    ca = PCA(n_components=2, random_state=0).fit_transform(Xa)
    cb = PCA(n_components=2, random_state=0).fit_transform(Xb)
    reductions = [
        {"name": "A — PCA 2", "info": {}, "data": ca, "ids": ha, "source": "A"},
        {"name": "B — PCA 2", "info": {}, "data": cb, "ids": hb, "source": "B"},
    ]
    report = compute_statistics([ea, eb], reductions, rng_seed=42)
    driver_vals = {
        r.space_name: r.value
        for r in report.rows
        if r.stat_family == "faithfulness" and r.metric == "trustworthiness"
    }
    route_faithfulness_to_metadata(report, reductions)

    qa = reductions[0]["info"]["quality"]["trustworthiness"]["value"]
    qb = reductions[1]["info"]["quality"]["trustworthiness"]["value"]
    assert qa == driver_vals["A — PCA 2"]
    assert qb == driver_vals["B — PCA 2"]
    assert qa != qb  # each projection scored against its own embedding
