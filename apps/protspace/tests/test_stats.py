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
    sep_sil = {r.metric: r.value for r in ClusterValidityStatistic().compute(ctx)}[
        "silhouette"
    ]
    assert sep_sil > 0.6

    # Heavily overlapping clusters: KMeans still imposes a split, but the
    # silhouette is markedly lower than for well-separated clusters.
    overlap, _ = make_blobs(
        n_samples=300, centers=4, n_features=2, random_state=2, cluster_std=4.0
    )
    ctx2 = StatContext(
        "projection", "PCA_2", coords=overlap, ids=[str(i) for i in range(300)]
    )
    ov_sil = {r.metric: r.value for r in ClusterValidityStatistic().compute(ctx2)}[
        "silhouette"
    ]
    assert ov_sil < 0.45
    assert sep_sil > ov_sil + 0.2


def test_cluster_validity_emits_meta_and_validity_kinds():
    X, _ = _blobs(n=200, centers=3, dim=2, seed=3)
    ctx = StatContext(
        "projection", "PCA_2", coords=X, ids=[str(i) for i in range(len(X))]
    )
    rows = ClusterValidityStatistic().compute(ctx)
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
