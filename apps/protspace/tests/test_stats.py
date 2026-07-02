"""Tests for the projection-statistics package (protspace.stats).

Known-answer fixtures with numeric tolerances — not just "rows exist".
"""

from __future__ import annotations

import numpy as np
import pytest
from sklearn.datasets import make_blobs
from sklearn.decomposition import PCA

from protspace.stats import compute_statistics, get_statistics
from protspace.stats.base import STATS_SCHEMA, StatContext, StatRow, StatsReport
from protspace.stats.cluster.kmeans_elbow import chord_deviation, kmeans_elbow
from protspace.stats.driver import compute_statistics as driver_compute
from protspace.stats.metrics.faithfulness import FaithfulnessStatistic
from protspace.stats.metrics.validity import ClusterValidityStatistic


class _EmbSet:
    """Minimal stand-in for EmbeddingSet (name/data/headers/precomputed)."""

    def __init__(self, name, data, headers, precomputed=False):
        self.name = name
        self.data = np.asarray(data, dtype=float)
        self.headers = list(headers)
        self.precomputed = precomputed


def _blobs(n=300, centers=4, dim=2, seed=0):
    X, y = make_blobs(
        n_samples=n, centers=centers, n_features=dim, random_state=seed, cluster_std=0.6
    )
    return X, y


# --------------------------------------------------------------------------- #
# 1. scaffolding / contract
# --------------------------------------------------------------------------- #


def test_registry_returns_two_statistics():
    stats = get_statistics()
    families = {s.family for s in stats}
    assert families == {"cluster_validity", "faithfulness"}


def test_to_arrow_has_eight_column_schema():
    report = StatsReport()
    report.add(
        [
            StatRow(
                space_kind="projection",
                space_name="UMAP_2",
                stat_family="cluster_validity",
                label_kind="kmeans_elbow",
                metric="silhouette",
                metric_kind="validity",
                value=0.42,
                extra={"seed": 42},
            )
        ]
    )
    table = report.to_arrow()
    assert table.schema.names == [
        "space_kind",
        "space_name",
        "stat_family",
        "label_kind",
        "metric",
        "metric_kind",
        "value",
        "extra_json",
    ]
    assert table.num_rows == 1
    assert table.column("value")[0].as_py() == pytest.approx(0.42)


def test_empty_report_keeps_schema():
    table = StatsReport().to_arrow()
    assert table.num_rows == 0
    assert table.schema == STATS_SCHEMA


# --------------------------------------------------------------------------- #
# 2. cluster validity / elbow
# --------------------------------------------------------------------------- #


def test_elbow_recovers_known_cluster_count():
    X, _ = _blobs(n=300, centers=4, dim=2, seed=1)
    res = kmeans_elbow(X, rng_seed=42)
    assert res is not None
    assert res.k in {3, 4, 5}
    assert res.knee_confidence == "high"


def test_cluster_validity_separated_vs_overlapping():
    sep, _ = _blobs(n=300, centers=4, dim=2, seed=2)
    ctx = StatContext(
        "projection", "PCA_2", coords=sep, ids=[str(i) for i in range(len(sep))]
    )
    sep_sil = {
        r.metric: r.value
        for r in ClusterValidityStatistic().compute(ctx)
        if isinstance(r, StatRow)
    }["silhouette"]
    assert sep_sil > 0.6

    # Heavily overlapping clusters: KMeans still imposes a split, but the
    # silhouette is markedly lower than for well-separated clusters.
    overlap, _ = make_blobs(
        n_samples=300, centers=4, n_features=2, random_state=2, cluster_std=4.0
    )
    ctx2 = StatContext(
        "projection", "PCA_2", coords=overlap, ids=[str(i) for i in range(300)]
    )
    ov_sil = {
        r.metric: r.value
        for r in ClusterValidityStatistic().compute(ctx2)
        if isinstance(r, StatRow)
    }["silhouette"]
    assert ov_sil < 0.45
    assert sep_sil > ov_sil + 0.2


def test_cluster_validity_emits_meta_and_validity_kinds():
    X, _ = _blobs(n=200, centers=3, dim=2, seed=3)
    ctx = StatContext(
        "projection", "PCA_2", coords=X, ids=[str(i) for i in range(len(X))]
    )
    rows = [
        r for r in ClusterValidityStatistic().compute(ctx) if isinstance(r, StatRow)
    ]
    by_metric = {r.metric: r for r in rows}
    assert by_metric["n_clusters"].metric_kind == "meta"
    assert by_metric["silhouette"].metric_kind == "validity"
    assert {"davies_bouldin", "calinski_harabasz"} <= set(by_metric)
    assert all(r.label_kind == "kmeans_elbow" for r in rows)


def test_cluster_validity_too_few_points():
    ctx = StatContext("projection", "PCA_2", coords=np.zeros((2, 2)), ids=["a", "b"])
    assert ClusterValidityStatistic().compute(ctx) == []


def test_chord_deviation_linear_curve_is_flat():
    y = np.linspace(10.0, 1.0, 20)  # straight line
    dev = chord_deviation(y)
    assert float(dev.max()) < 0.05


# --------------------------------------------------------------------------- #
# 3. faithfulness
# --------------------------------------------------------------------------- #


def test_faithful_projection_scores_higher_than_random():
    X, _ = _blobs(n=200, centers=5, dim=8, seed=4)
    faithful = PCA(n_components=2, random_state=0).fit_transform(X)
    rng = np.random.default_rng(0)
    random_proj = rng.normal(size=(200, 2))
    ids = [str(i) for i in range(200)]

    stat = FaithfulnessStatistic()
    good = {
        r.metric: r.value
        for r in stat.compute(
            StatContext(
                "projection",
                "PCA_2",
                coords=faithful,
                ids=ids,
                embedding=X,
                embedding_name="e",
            )
        )
    }
    bad = {
        r.metric: r.value
        for r in stat.compute(
            StatContext(
                "projection",
                "RAND_2",
                coords=random_proj,
                ids=ids,
                embedding=X,
                embedding_name="e",
            )
        )
    }
    assert good["trustworthiness"] > 0.9
    assert good["trustworthiness"] > bad["trustworthiness"]
    assert good["knn_overlap"] > bad["knn_overlap"]


def test_faithfulness_records_k_and_metric():
    X, _ = _blobs(n=120, centers=3, dim=6, seed=5)
    coords = PCA(n_components=2, random_state=0).fit_transform(X)
    ids = [str(i) for i in range(120)]
    rows = FaithfulnessStatistic().compute(
        StatContext(
            "projection",
            "PCA_2",
            coords=coords,
            ids=ids,
            embedding=X,
            embedding_name="e",
            high_dim_metric="cosine",
        )
    )
    knn = next(r for r in rows if r.metric == "knn_overlap")
    assert knn.extra["k"] == 15
    assert knn.extra["metric"] == "cosine"
    assert knn.label_kind == "none"


def test_faithfulness_skips_without_embedding():
    ctx = StatContext(
        "projection", "PCA_2", coords=np.zeros((10, 2)), ids=[str(i) for i in range(10)]
    )
    assert FaithfulnessStatistic().compute(ctx) == []


def test_faithfulness_rows_route_to_projection_metadata():
    X, _ = _blobs(n=120, centers=3, dim=6, seed=21)
    coords = PCA(n_components=2, random_state=0).fit_transform(X)
    ids = [str(i) for i in range(120)]
    rows = FaithfulnessStatistic().compute(
        StatContext(
            "projection",
            "PCA_2",
            coords=coords,
            ids=ids,
            embedding=X,
            embedding_name="e",
        )
    )
    assert rows  # sanity: faithfulness produced rows
    assert all(r.destination == "projection_metadata" for r in rows)


def test_faithfulness_skip_row_routes_to_projection_metadata():
    # Beyond the hard ceiling faithfulness emits a single skip row — it must also
    # route to projection metadata, not the aggregate fifth part.
    n = 30
    X, _ = _blobs(n=n, centers=2, dim=4, seed=22)
    coords = PCA(n_components=2, random_state=0).fit_transform(X)
    ids = [str(i) for i in range(n)]
    rows = FaithfulnessStatistic().compute(
        StatContext(
            "projection",
            "PCA_2",
            coords=coords,
            ids=ids,
            embedding=X,
            embedding_name="e",
            params={"hard_ceiling": 10},  # force the skip path
        )
    )
    assert len(rows) == 1 and rows[0].extra.get("skipped") == "n_too_large"
    assert rows[0].destination == "projection_metadata"


# --------------------------------------------------------------------------- #
# 4. driver: mapping, alignment, failure isolation
# --------------------------------------------------------------------------- #


def test_driver_full_matrix_shape():
    X, _ = _blobs(n=150, centers=4, dim=5, seed=6)
    coords = PCA(n_components=2, random_state=0).fit_transform(X)
    headers = [f"p{i}" for i in range(150)]
    emb = _EmbSet("prot_t5", X, headers)
    reductions = [
        {"name": "ProtT5 — PCA 2", "data": coords, "ids": headers, "source": "prot_t5"}
    ]
    report = compute_statistics([emb], reductions, rng_seed=42)
    metrics = {r.metric for r in report.rows}
    assert {
        "silhouette",
        "davies_bouldin",
        "calinski_harabasz",
        "n_clusters",
    } <= metrics
    assert {"knn_overlap", "trustworthiness", "continuity"} <= metrics
    assert all(r.space_name == "ProtT5 — PCA 2" for r in report.rows)


def test_driver_alignment_is_permutation_invariant():
    X, _ = _blobs(n=120, centers=4, dim=6, seed=7)
    coords = PCA(n_components=2, random_state=0).fit_transform(X)
    headers = [f"p{i}" for i in range(120)]
    emb = _EmbSet("e", X, headers)

    base = compute_statistics(
        [emb],
        [{"name": "P", "data": coords, "ids": headers, "source": "e"}],
        rng_seed=42,
    )
    # Permute the projection rows + ids together; the id-join must recover pairing.
    perm = np.random.default_rng(3).permutation(120)
    permuted = compute_statistics(
        [emb],
        [
            {
                "name": "P",
                "data": coords[perm],
                "ids": [headers[i] for i in perm],
                "source": "e",
            }
        ],
        rng_seed=42,
    )
    b = {r.metric: r.value for r in base.rows}
    p = {r.metric: r.value for r in permuted.rows}
    assert b["trustworthiness"] == pytest.approx(p["trustworthiness"], abs=1e-9)
    assert b["knn_overlap"] == pytest.approx(p["knn_overlap"], abs=1e-9)


def test_driver_maps_each_projection_to_its_embedding():
    Xa, _ = _blobs(n=100, centers=3, dim=5, seed=8)
    Xb, _ = _blobs(n=100, centers=3, dim=7, seed=9)
    ha = [f"a{i}" for i in range(100)]
    hb = [f"b{i}" for i in range(100)]
    ea, eb = _EmbSet("A", Xa, ha), _EmbSet("B", Xb, hb)
    ca = PCA(n_components=2, random_state=0).fit_transform(Xa)
    cb = PCA(n_components=2, random_state=0).fit_transform(Xb)
    reductions = [
        {"name": "A — PCA 2", "data": ca, "ids": ha, "source": "A"},
        {"name": "B — PCA 2", "data": cb, "ids": hb, "source": "B"},
    ]
    report = compute_statistics([ea, eb], reductions, rng_seed=42)
    embs = {
        r.space_name: r.extra.get("embedding")
        for r in report.rows
        if r.stat_family == "faithfulness"
    }
    assert embs["A — PCA 2"] == "A"
    assert embs["B — PCA 2"] == "B"


def test_faithfulness_small_n_emits_trustworthiness_and_continuity():
    # Regression: for n in [4,30] the k clamp must satisfy sklearn's n_neighbors < n/2,
    # so trustworthiness AND continuity are emitted (previously silently dropped).
    for n in (4, 8, 12, 20, 30):
        X, _ = _blobs(n=n, centers=2, dim=4, seed=n)
        coords = PCA(n_components=2, random_state=0).fit_transform(X)
        ids = [str(i) for i in range(n)]
        rows = {
            r.metric
            for r in FaithfulnessStatistic().compute(
                StatContext(
                    "projection",
                    "P",
                    coords=coords,
                    ids=ids,
                    embedding_coords=coords,
                    embedding=X,
                    embedding_ids=ids,
                    embedding_name="e",
                )
            )
        }
        assert {"knn_overlap", "trustworthiness", "continuity"} <= rows, (
            f"n={n} dropped metrics: {rows}"
        )


def test_cluster_validity_uses_full_projection_not_embedding_subset():
    # Regression: cluster_validity must score the FULL projection; only faithfulness
    # uses the embedding-aligned subset. Embedding covers 60 of 100 projected ids.
    X, _ = _blobs(n=100, centers=4, dim=5, seed=11)
    coords = PCA(n_components=2, random_state=0).fit_transform(X)
    headers = [f"p{i}" for i in range(100)]
    emb = _EmbSet("e", X[:60], headers[:60])  # strict subset
    report = compute_statistics(
        [emb],
        [{"name": "P", "data": coords, "ids": headers, "source": "e"}],
        rng_seed=42,
    )
    faith = [r for r in report.rows if r.stat_family == "faithfulness"]
    assert all(
        r.extra["sample_size"] == 60 for r in faith
    )  # faithfulness on the subset
    # cluster_validity still runs (on the full 100-point projection)
    assert any(r.metric == "silhouette" for r in report.rows)


def test_faithfulness_honors_default_metric_when_info_lacks_metric():
    X, _ = _blobs(n=120, centers=3, dim=6, seed=12)
    coords = PCA(n_components=2, random_state=0).fit_transform(X)
    headers = [f"p{i}" for i in range(120)]
    emb = _EmbSet("e", X, headers)
    # reduction info has no 'metric' (like PCA); default_metric must be used.
    report = compute_statistics(
        [emb],
        [{"name": "P", "data": coords, "ids": headers, "source": "e", "info": {}}],
        rng_seed=42,
        default_metric="cosine",
    )
    knn = next(r for r in report.rows if r.metric == "knn_overlap")
    assert knn.extra["metric"] == "cosine"


def test_precomputed_embedding_skips_faithfulness():
    headers = [f"p{i}" for i in range(40)]
    sim = _EmbSet("sim", np.eye(40), headers, precomputed=True)  # (n,n) similarity
    X, _ = _blobs(n=40, centers=3, dim=2, seed=13)
    report = compute_statistics(
        [sim],
        [{"name": "MDS", "data": X, "ids": headers, "source": "sim"}],
        rng_seed=42,
    )
    assert not any(r.stat_family == "faithfulness" for r in report.rows)
    assert any(r.metric == "silhouette" for r in report.rows)


def test_source_disambiguates_same_id_embeddings():
    # Two embeddings sharing identical ids but different vectors; explicit source
    # must route each projection to its own embedding (overlap tie would pick [0]).
    headers = [f"p{i}" for i in range(80)]
    Xa, _ = _blobs(n=80, centers=3, dim=5, seed=14)
    Xb, _ = _blobs(n=80, centers=3, dim=5, seed=15)
    ea, eb = _EmbSet("A", Xa, headers), _EmbSet("B", Xb, headers)
    ca = PCA(n_components=2, random_state=0).fit_transform(Xa)
    cb = PCA(n_components=2, random_state=0).fit_transform(Xb)
    report = compute_statistics(
        [ea, eb],
        [
            {"name": "A — PCA 2", "data": ca, "ids": headers, "source": "A"},
            {"name": "B — PCA 2", "data": cb, "ids": headers, "source": "B"},
        ],
        rng_seed=42,
    )
    embs = {
        r.space_name: r.extra.get("embedding")
        for r in report.rows
        if r.stat_family == "faithfulness"
    }
    assert embs["A — PCA 2"] == "A"
    assert embs["B — PCA 2"] == "B"


def test_driver_isolates_failures():
    class _Boom:
        family = "boom"
        requires_embedding = False

        def compute(self, ctx):
            raise RuntimeError("boom")

    X, _ = _blobs(n=80, centers=3, dim=2, seed=10)
    headers = [str(i) for i in range(80)]
    emb = _EmbSet("e", X, headers)
    report = driver_compute(
        [emb],
        [{"name": "P", "data": X, "ids": headers, "source": "e"}],
        statistics=[_Boom(), ClusterValidityStatistic()],
    )
    # Boom is swallowed; cluster validity still produced rows.
    assert any(r.metric == "silhouette" for r in report.rows)


# --------------------------------------------------------------------------- #
# 5. routing / destination (route-projection-statistics, Phase 1A)
# --------------------------------------------------------------------------- #


def _statrow(metric, value, *, destination=None, **extra):
    kw = {} if destination is None else {"destination": destination}
    return StatRow(
        space_kind="projection",
        space_name="PCA_2",
        stat_family="cluster_validity",
        label_kind="kmeans_elbow",
        metric=metric,
        metric_kind="validity",
        value=value,
        extra=extra,
        **kw,
    )


def test_statrow_defaults_to_statistics_part_destination():
    # Every existing construction stays valid and keeps the 5th-part destination.
    assert _statrow("silhouette", 0.5).destination == "statistics_part"


def test_destination_is_not_a_tidy_table_column():
    # destination is carriage metadata, never a column in the 8-column schema.
    rec = _statrow("silhouette", 0.5).to_record()
    assert "destination" not in rec
    assert set(rec) == set(STATS_SCHEMA.names)


def test_partition_groups_rows_by_destination():
    report = StatsReport()
    report.add(
        [
            _statrow("silhouette", 0.5),  # default -> statistics_part
            _statrow("trustworthiness", 0.9, destination="projection_metadata"),
            _statrow("cluster", 1.0, destination="annotation"),
        ]
    )
    buckets = report.partition()
    assert {r.metric for r in buckets["statistics_part"]} == {"silhouette"}
    assert {r.metric for r in buckets["projection_metadata"]} == {"trustworthiness"}
    assert {r.metric for r in buckets["annotation"]} == {"cluster"}


def test_to_arrow_serializes_only_statistics_part_rows():
    report = StatsReport()
    report.add(
        [
            _statrow("silhouette", 0.5),  # statistics_part
            _statrow("trustworthiness", 0.9, destination="projection_metadata"),
            _statrow("cluster", 1.0, destination="annotation"),
        ]
    )
    table = report.to_arrow()
    assert table.schema == STATS_SCHEMA
    assert table.column("metric").to_pylist() == ["silhouette"]


# --------------------------------------------------------------------------- #
# 6. per-protein annotation outputs (route-projection-statistics Phase 2A)
# --------------------------------------------------------------------------- #


def test_annotation_column_defaults_to_annotation_destination():
    from protspace.stats.base import AnnotationColumn

    col = AnnotationColumn(name="cluster_PCA_2", kind="categorical", values={"a": "c0"})
    assert col.destination == "annotation"


def test_report_collects_annotation_columns_separately_from_rows():
    from protspace.stats.base import AnnotationColumn

    report = StatsReport()
    report.add(
        [
            _statrow("silhouette", 0.5),  # statistics_part row
            AnnotationColumn(
                name="cluster_PCA_2", kind="categorical", values={"a": "c0"}
            ),
        ]
    )
    # the scalar row stays in rows / to_arrow; the column is a separate channel
    assert [r.metric for r in report.rows] == ["silhouette"]
    assert report.to_arrow().num_rows == 1
    assert [c.name for c in report.annotation_columns] == ["cluster_PCA_2"]


def test_cluster_validity_emits_membership_with_attached_silhouette():
    from protspace.stats.base import AnnotationColumn

    X, _ = _blobs(n=200, centers=4, dim=2, seed=31)
    ids = [f"p{i}" for i in range(200)]
    outs = ClusterValidityStatistic().compute(
        StatContext("projection", "PCA_2", coords=X, ids=ids)
    )
    cols = {o.name: o for o in outs if isinstance(o, AnnotationColumn)}
    # Single membership column now; the per-point silhouette rides on its value as
    # `cluster N|<silhouette>` (like ECO / InterPro bit scores), not a 2nd column.
    assert set(cols) == {"cluster_PCA_2"}
    mem = cols["cluster_PCA_2"]
    assert mem.destination == "annotation" and mem.kind == "categorical"
    assert set(mem.values) == set(ids)  # one value per protein, joined by id
    assert mem.extra["has_silhouette_score"] is True
    for v in mem.values.values():
        label, _, score = v.partition("|")
        assert label.startswith("cluster ")  # categorical part
        assert -1.0 <= float(score) <= 1.0  # attached per-point silhouette


def test_per_point_silhouette_skipped_beyond_hard_ceiling():
    from protspace.stats.base import AnnotationColumn

    X, _ = _blobs(n=200, centers=3, dim=2, seed=32)
    ids = [f"p{i}" for i in range(200)]
    outs = ClusterValidityStatistic().compute(
        StatContext(
            "projection",
            "PCA_2",
            coords=X,
            ids=ids,
            params={"silhouette_hard_ceiling": 50},  # n=200 > 50
        )
    )
    cols = {o.name: o for o in outs if isinstance(o, AnnotationColumn)}
    assert set(cols) == {"cluster_PCA_2"}  # membership is cheap, still emitted
    mem = cols["cluster_PCA_2"]
    # O(n^2) per-point silhouette skipped → no attached score, plain labels.
    assert mem.extra["has_silhouette_score"] is False
    assert all("|" not in v for v in mem.values.values())


def test_cluster_annotations_can_be_disabled():
    from protspace.stats.base import AnnotationColumn

    X, _ = _blobs(n=150, centers=3, dim=2, seed=33)
    ids = [f"p{i}" for i in range(150)]
    outs = ClusterValidityStatistic().compute(
        StatContext(
            "projection",
            "PCA_2",
            coords=X,
            ids=ids,
            params={"cluster_annotations": False},
        )
    )
    assert not any(isinstance(o, AnnotationColumn) for o in outs)
    # aggregate validity rows still produced
    assert any(getattr(o, "metric", None) == "silhouette" for o in outs)


# --------------------------------------------------------------------------- #
# 7. regression: deferred-item fixes (continuity metric, silhouette consistency,
#    KMeans subsampling, order-invariant faithfulness subsample)
# --------------------------------------------------------------------------- #


def test_continuity_matches_sklearn_dual_on_euclidean():
    """_continuity is bit-identical to sklearn's dual (trustworthiness with args
    swapped) when the high-dim metric is euclidean — the default path is unchanged."""
    from sklearn.manifold import trustworthiness

    from protspace.stats.metrics.faithfulness import _continuity

    X, _ = _blobs(n=120, centers=4, dim=6, seed=41)
    coords = PCA(n_components=2, random_state=0).fit_transform(X)
    k = 10
    ours = _continuity(X, coords, k, "euclidean")
    ref = float(trustworthiness(coords, X, n_neighbors=k, metric="euclidean"))
    assert ours == pytest.approx(ref, abs=1e-12)


def test_continuity_uses_high_dim_metric_consistently():
    """For a non-euclidean high-dim metric, continuity ranks the embedding by that
    metric (recorded in extra), consistent with trustworthiness — not the euclidean
    fallback sklearn.trustworthiness forces on its second argument."""
    X, _ = _blobs(n=120, centers=4, dim=6, seed=42)
    coords = PCA(n_components=2, random_state=0).fit_transform(X)
    headers = [f"p{i}" for i in range(120)]
    emb = _EmbSet("e", X, headers)
    report = compute_statistics(
        [emb],
        [
            {
                "name": "P",
                "data": coords,
                "ids": headers,
                "source": "e",
                "info": {"metric": "cosine"},
            }
        ],
        rng_seed=42,
    )
    by_metric = {r.metric: r for r in report.rows}
    assert by_metric["continuity"].extra["metric"] == "cosine"
    assert by_metric["trustworthiness"].extra["metric"] == "cosine"


def test_kmeans_elbow_subsamples_above_max_fit_sample():
    """Above max_fit_sample the elbow fits a subsample (MiniBatchKMeans) but still
    labels ALL points via predict, deterministically."""
    X, _ = _blobs(n=400, centers=4, dim=2, seed=43)
    res1 = kmeans_elbow(X, rng_seed=42, max_fit_sample=100)
    res2 = kmeans_elbow(X, rng_seed=42, max_fit_sample=100)
    assert res1 is not None
    assert len(res1.labels) == 400  # full coverage via predict
    assert np.array_equal(res1.labels, res2.labels)  # deterministic


def test_elbow_result_has_no_silhouette_optimal_k():
    """The write-only silhouette_optimal_k field/sweep was removed."""
    from dataclasses import fields

    X, _ = _blobs(n=200, centers=3, dim=2, seed=44)
    res = kmeans_elbow(X, rng_seed=42)
    assert "silhouette_optimal_k" not in {f.name for f in fields(res)}
    ctx = StatContext("projection", "P", coords=X, ids=[str(i) for i in range(len(X))])
    meta = next(
        r
        for r in ClusterValidityStatistic().compute(ctx)
        if isinstance(r, StatRow) and r.metric == "n_clusters"
    )
    assert "silhouette_optimal_k" not in meta.extra


def test_aggregate_silhouette_equals_per_point_mean():
    """The aggregate silhouette is exactly the mean of the per-point silhouettes
    attached to the membership column values (consistent, not a sampled estimate)."""
    from protspace.stats.base import AnnotationColumn

    X, _ = _blobs(n=300, centers=4, dim=2, seed=45)
    ids = [f"p{i}" for i in range(300)]
    outs = ClusterValidityStatistic().compute(
        StatContext("projection", "P", coords=X, ids=ids)
    )
    agg = next(o for o in outs if isinstance(o, StatRow) and o.metric == "silhouette")
    col = next(
        o for o in outs if isinstance(o, AnnotationColumn) and o.name == "cluster_P"
    )
    per_point = [float(v.split("|", 1)[1]) for v in col.values.values()]
    assert agg.extra["sampled"] is False
    assert agg.value == pytest.approx(float(np.mean(per_point)), abs=1e-4)


@pytest.mark.parametrize("sample_threshold", [60, 1000])
def test_faithfulness_is_row_order_invariant(sample_threshold):
    """All faithfulness metrics — including the position-sampled random_triplet —
    depend only on the id-set, not the input row order, in BOTH the subsampled
    (threshold=60 < n) and non-subsampled (threshold=1000 > n) regimes. The old
    code broke this for random_triplet in the non-subsampled path."""
    X, _ = _blobs(n=120, centers=4, dim=6, seed=46)
    coords = PCA(n_components=2, random_state=0).fit_transform(X)
    headers = [f"p{i}" for i in range(120)]
    emb = _EmbSet("e", X, headers)
    params = {"sample_threshold": sample_threshold}

    base = compute_statistics(
        [emb],
        [{"name": "P", "data": coords, "ids": headers, "source": "e"}],
        rng_seed=42,
        params=params,
    )
    perm = np.random.default_rng(5).permutation(120)
    permuted = compute_statistics(
        [emb],
        [
            {
                "name": "P",
                "data": coords[perm],
                "ids": [headers[i] for i in perm],
                "source": "e",
            }
        ],
        rng_seed=42,
        params=params,
    )
    b = {r.metric: r.value for r in base.rows}
    p = {r.metric: r.value for r in permuted.rows}
    for metric in (
        "trustworthiness",
        "knn_overlap",
        "continuity",
        "random_triplet",
        "spearman_distance",
    ):
        assert b[metric] == pytest.approx(p[metric], abs=1e-9), metric


# --------------------------------------------------------------------------- #
# 8. cluster-selection (elbow / silhouette / both) + global faithfulness
# --------------------------------------------------------------------------- #


def test_cluster_selection_silhouette_emits_silhouette_labeling():
    from protspace.stats.base import AnnotationColumn

    X, _ = _blobs(n=200, centers=4, dim=2, seed=51)
    ids = [f"p{i}" for i in range(200)]
    outs = ClusterValidityStatistic().compute(
        StatContext(
            "projection",
            "PCA_2",
            coords=X,
            ids=ids,
            params={"cluster_selection": "silhouette"},
        )
    )
    cols = {o.name for o in outs if isinstance(o, AnnotationColumn)}
    assert cols == {"cluster_silhouette_PCA_2"}
    rows = [o for o in outs if isinstance(o, StatRow)]
    assert {r.label_kind for r in rows} == {"kmeans_silhouette"}
    meta = next(r for r in rows if r.metric == "n_clusters")
    assert meta.extra["selection"] == "silhouette"


def test_cluster_selection_both_emits_two_labelings():
    from protspace.stats.base import AnnotationColumn

    X, _ = _blobs(n=200, centers=4, dim=2, seed=52)
    ids = [f"p{i}" for i in range(200)]
    outs = ClusterValidityStatistic().compute(
        StatContext(
            "projection",
            "PCA_2",
            coords=X,
            ids=ids,
            params={"cluster_selection": "both"},
        )
    )
    cols = {o.name for o in outs if isinstance(o, AnnotationColumn)}
    assert cols == {"cluster_PCA_2", "cluster_silhouette_PCA_2"}
    kinds = {r.label_kind for r in outs if isinstance(r, StatRow)}
    assert kinds == {"kmeans_elbow", "kmeans_silhouette"}


def test_cluster_membership_omits_score_when_scores_disabled():
    from protspace.stats.base import AnnotationColumn

    X, _ = _blobs(n=200, centers=4, dim=2, seed=53)
    ids = [f"p{i}" for i in range(200)]
    outs = ClusterValidityStatistic().compute(
        StatContext(
            "projection", "P", coords=X, ids=ids, params={"include_scores": False}
        )
    )
    mem = next(o for o in outs if isinstance(o, AnnotationColumn))
    assert all("|" not in v for v in mem.values.values())
    assert mem.extra["has_silhouette_score"] is False


def test_kmeans_elbow_silhouette_selection_returns_alt_k():
    X, _ = _blobs(n=200, centers=4, dim=2, seed=56)
    res = kmeans_elbow(X, rng_seed=42, silhouette_selection=True)
    assert res.silhouette_k is not None and res.silhouette_labels is not None
    assert len(res.silhouette_labels) == 200
    assert res.silhouette_k in res.k_range
    # default (no selection) leaves the alternative-K fields unpopulated
    res2 = kmeans_elbow(X, rng_seed=42)
    assert res2.silhouette_k is None and res2.silhouette_labels is None


def test_faithfulness_emits_global_metrics_tagged_by_scope():
    X, _ = _blobs(n=150, centers=4, dim=8, seed=54)
    coords = PCA(n_components=2, random_state=0).fit_transform(X)
    ids = [str(i) for i in range(150)]
    rows = {
        r.metric: r
        for r in FaithfulnessStatistic().compute(
            StatContext(
                "projection",
                "P",
                coords=coords,
                ids=ids,
                embedding=X,
                embedding_name="e",
            )
        )
    }
    assert {"random_triplet", "spearman_distance"} <= set(rows)
    assert 0.0 <= rows["random_triplet"].value <= 1.0
    assert -1.0 <= rows["spearman_distance"].value <= 1.0
    assert rows["random_triplet"].extra["scope"] == "global"
    assert rows["spearman_distance"].extra["scope"] == "global"
    assert rows["knn_overlap"].extra["scope"] == "local"


def test_global_metrics_higher_for_faithful_projection():
    X, _ = _blobs(n=150, centers=5, dim=8, seed=55)
    faithful = PCA(n_components=2, random_state=0).fit_transform(X)
    rand = np.random.default_rng(0).normal(size=(150, 2))
    ids = [str(i) for i in range(150)]

    def q(coords):
        return {
            r.metric: r.value
            for r in FaithfulnessStatistic().compute(
                StatContext(
                    "projection",
                    "P",
                    coords=coords,
                    ids=ids,
                    embedding=X,
                    embedding_name="e",
                )
            )
        }

    good, bad = q(faithful), q(rand)
    assert good["spearman_distance"] > bad["spearman_distance"]
    assert good["random_triplet"] > bad["random_triplet"]
