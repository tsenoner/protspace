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
        annotation="",  # faithfulness rows are not annotation-scoped
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


def test_build_cluster_legend_settings_produces_valid_envelope():
    from protspace.stats.base import AnnotationColumn, StatsReport
    from protspace.stats.carriage import build_cluster_legend_settings

    report = StatsReport()
    report.add(
        [
            AnnotationColumn(
                name="cluster_P",
                kind="categorical",
                values={"a": "cluster 0", "b": "cluster 1", "c": "cluster 0"},
            ),
            AnnotationColumn(name="silhouette_P", kind="numeric", values={"a": 0.5}),
        ]
    )
    settings = build_cluster_legend_settings(report)

    # only the categorical membership column is styled (silhouette is a numeric ramp)
    assert set(settings) == {"cluster_P"}
    env = settings["cluster_P"]
    # every field sanitizeLegendSettingsEntry requires, with the right types
    assert isinstance(env["maxVisibleValues"], int)
    assert isinstance(env["shapeSize"], int | float)
    assert env["sortMode"] in {
        "size-asc",
        "size-desc",
        "alpha-asc",
        "alpha-desc",
        "manual",
        "manual-reverse",
    }
    assert env["enableDuplicateStackUI"] is False
    assert env["hiddenValues"] == []
    assert env["selectedPaletteId"] == "kellys"
    cats = env["categories"]
    assert set(cats) == {"cluster 0", "cluster 1"}
    colors = set()
    for cat in cats.values():
        assert isinstance(cat["zOrder"], int)
        assert isinstance(cat["color"], str) and cat["color"].startswith("#")
        assert isinstance(cat["shape"], str)
        colors.add(cat["color"])
    assert len(colors) == 2  # distinct palette colors per cluster


def test_merge_annotation_columns_joins_by_identifier():
    import pandas as pd

    from protspace.stats.base import AnnotationColumn, StatsReport
    from protspace.stats.carriage import merge_annotation_columns

    report = StatsReport()
    report.add(
        [
            AnnotationColumn(
                name="cluster_P",
                kind="categorical",
                values={"a": "cluster 0", "b": "cluster 1"},
            ),
            AnnotationColumn(
                name="silhouette_P", kind="numeric", values={"a": 0.5, "b": 0.2}
            ),
        ]
    )
    frame = pd.DataFrame({"identifier": ["a", "b", "c"]})
    added = merge_annotation_columns(report, frame)

    assert added == ["cluster_P", "silhouette_P"]
    assert frame.loc[frame.identifier == "a", "cluster_P"].item() == "cluster 0"
    assert frame.loc[frame.identifier == "b", "silhouette_P"].item() == 0.2
    # a protein absent from the column gets no value (not a fabricated one)
    assert pd.isna(frame.loc[frame.identifier == "c", "cluster_P"].item())


def test_merge_skips_and_warns_on_zero_id_matches(caplog):
    import logging

    import pandas as pd

    from protspace.stats.base import AnnotationColumn, StatsReport
    from protspace.stats.carriage import (
        build_cluster_legend_settings,
        merge_annotation_columns,
    )

    # Membership values keyed by projection ids that share NO id with the frame
    # (e.g. 'sp|..|NAME' headers vs bare accessions) → an all-empty column.
    report = StatsReport()
    report.add(
        [
            AnnotationColumn(
                name="cluster_elbow_P",
                kind="categorical",
                values={"sp|P1|X": "cluster 0", "sp|P2|Y": "cluster 1"},
            )
        ]
    )
    frame = pd.DataFrame({"identifier": ["P1", "P2", "P3"]})
    with caplog.at_level(logging.WARNING):
        added = merge_annotation_columns(report, frame)

    assert added == []  # phantom column skipped, not reported as added
    assert "cluster_elbow_P" not in frame.columns  # not added to the frame
    assert "matched 0" in caplog.text
    # And it gets no legend when the caller gates styling on the added columns.
    assert build_cluster_legend_settings(report, columns=added) == {}


def test_annotation_columns_are_typed_in_protein_annotations_table():
    import pandas as pd

    from protspace.data.processors.base_processor import BaseProcessor
    from protspace.stats import compute_statistics
    from protspace.stats.carriage import merge_annotation_columns

    X, _ = make_blobs(n_samples=120, centers=3, n_features=5, random_state=7)
    headers = [f"p{i}" for i in range(120)]
    coords = PCA(n_components=2, random_state=0).fit_transform(X)
    emb = _EmbSet("e", X, headers)
    reductions = [
        {
            "name": "P",
            "dimensions": 2,
            "info": {},
            "data": coords,
            "ids": headers,
            "source": "e",
        }
    ]
    report = compute_statistics([emb], reductions, rng_seed=42)
    metadata = pd.DataFrame({"identifier": headers})
    merge_annotation_columns(report, metadata)

    table = BaseProcessor({}, {})._create_protein_annotations_table(metadata)
    cols = table.column_names
    # Single membership column; per-point silhouette is attached to its value.
    assert "cluster_elbow_P" in cols and "silhouette_P" not in cols
    d = table.to_pydict()
    for v in d["cluster_elbow_P"]:
        label, _, score = v.partition("|")
        assert label.startswith("cluster ")  # categorical part
        float(score)  # attached per-point silhouette parses as a number


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


def test_legend_settings_strip_attached_silhouette_score():
    """Membership values carry a `|silhouette` confidence; the auto legend must key
    categories by the bare `cluster N` label (stripping the attached score)."""
    from protspace.stats.base import AnnotationColumn, StatsReport
    from protspace.stats.carriage import build_cluster_legend_settings

    report = StatsReport()
    report.add(
        [
            AnnotationColumn(
                name="cluster_P",
                kind="categorical",
                values={
                    "a": "cluster 0|0.5123",
                    "b": "cluster 1|0.3011",
                    "c": "cluster 0|0.6200",
                },
            )
        ]
    )
    settings = build_cluster_legend_settings(report)
    assert set(settings["cluster_P"]["categories"]) == {"cluster 0", "cluster 1"}
