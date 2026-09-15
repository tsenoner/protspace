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


def test_registry_returns_three_statistics():
    stats = get_statistics()
    families = {s.family for s in stats}
    assert families == {"cluster_validity", "annotation_validity", "faithfulness"}


def test_to_arrow_has_ten_column_schema():
    report = StatsReport()
    report.add(
        [
            StatRow(
                space_kind="projection",
                space_name="UMAP_2",
                annotation="",
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
    names = [
        "space_kind",
        "space_name",
        "annotation",
        "stat_family",
        "label_kind",
        "metric",
        "metric_kind",
        "value",
        "category",
        "extra_json",
    ]
    assert table.schema.names == names
    assert len(names) == 10
    assert table.num_rows == 1
    assert table.column("value")[0].as_py() == pytest.approx(0.42)


def test_empty_report_keeps_schema():
    table = StatsReport().to_arrow()
    assert table.num_rows == 0
    assert table.schema == STATS_SCHEMA


def test_statrow_carries_annotation_column():
    from protspace.stats.base import STATS_SCHEMA, StatRow, StatsReport

    assert "annotation" in STATS_SCHEMA.names
    row = StatRow(
        space_kind="embedding",
        space_name="prot_t5",
        stat_family="annotation_validity",
        label_kind="annotation",
        metric="silhouette",
        metric_kind="validity",
        value=0.42,
        annotation="major_group",
    )
    rec = row.to_record()
    assert rec["annotation"] == "major_group"
    report = StatsReport()
    report.add([row])
    tbl = report.to_arrow()
    assert tbl.column("annotation").to_pylist() == ["major_group"]


def test_statcontext_defaults_annotations_none():
    import numpy as np

    from protspace.stats.base import StatContext

    ctx = StatContext("projection", "P", coords=np.zeros((3, 2)), ids=["a", "b", "c"])
    assert ctx.annotations is None


# --------------------------------------------------------------------------- #
# 2. cluster validity / elbow
# --------------------------------------------------------------------------- #


def test_elbow_recovers_known_cluster_count():
    X, _ = _blobs(n=300, centers=4, dim=2, seed=1)
    res = kmeans_elbow(X, rng_seed=42)
    assert res is not None
    assert res.k in {3, 4, 5}
    assert res.knee_confidence == "high"


def _cluster_silhouette(outs):
    """The auto-clustering's own aggregate silhouette, scored on its labels by
    `AnnotationValidityStatistic`. Without `ctx.annotations` that self-scoring pass is
    the only source of `annotation_validity` rows, so this cannot pick up a curated
    annotation's score by mistake."""
    return next(
        r.value
        for r in outs
        if isinstance(r, StatRow)
        and r.stat_family == "annotation_validity"
        and r.metric == "silhouette"
        and r.category is None
    )


def test_cluster_validity_separated_vs_overlapping():
    sep, _ = _blobs(n=300, centers=4, dim=2, seed=2)
    ctx = StatContext(
        "projection", "PCA_2", coords=sep, ids=[str(i) for i in range(len(sep))]
    )
    sep_sil = _cluster_silhouette(ClusterValidityStatistic().compute(ctx))
    assert sep_sil > 0.6

    # Heavily overlapping clusters: KMeans still imposes a split, but the clustering
    # scores markedly worse on its own labels than a well-separated one does.
    overlap, _ = make_blobs(
        n_samples=300, centers=4, n_features=2, random_state=2, cluster_std=4.0
    )
    ctx2 = StatContext(
        "projection", "PCA_2", coords=overlap, ids=[str(i) for i in range(300)]
    )
    ov_sil = _cluster_silhouette(ClusterValidityStatistic().compute(ctx2))
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
    # The clustering is scored on its own labels, filed under the membership
    # column's name so the frontend reads it as any other annotation. Without
    # annotations there is still nothing to agree with, so no ARI/NMI.
    assert set(by_metric) == {
        "n_clusters",
        "silhouette",
        "davies_bouldin",
        "calinski_harabasz",
    }
    self_scored = [r for r in rows if r.stat_family == "annotation_validity"]
    assert {r.annotation for r in self_scored} == {"cluster_elbow_PCA_2"}
    assert all(r.space_kind == "projection" for r in self_scored)
    # Per-category rows alongside each aggregate, one per cluster.
    per_category = {r.category for r in self_scored if r.category is not None}
    assert per_category == {f"cluster {i}" for i in range(3)}
    # label_kind names the K-selection, not "annotation": these rows describe a
    # KMeans labelling, and the tidy table's provenance column must say so.
    assert all(r.label_kind == "kmeans_elbow" for r in rows)


def test_cluster_validity_emits_agreement_and_self_validity():
    from protspace.stats.base import AnnotationColumn, StatContext, StatRow
    from protspace.stats.metrics.validity import ClusterValidityStatistic

    X, y = _blobs(n=200, centers=4, dim=2, seed=61)
    ids = [f"p{i}" for i in range(200)]
    ann = {"grp": {pid: f"g{int(c)}" for pid, c in zip(ids, y, strict=True)}}
    outs = ClusterValidityStatistic().compute(
        StatContext("projection", "PCA_2", coords=X, ids=ids, annotations=ann)
    )
    rows = [o for o in outs if isinstance(o, StatRow)]
    metrics = {r.metric for r in rows}
    # Self-validity is filed under the membership column, never under the
    # annotation it happens to be compared against.
    self_scored = [r for r in rows if r.stat_family == "annotation_validity"]
    assert {"silhouette", "davies_bouldin", "calinski_harabasz"} <= {
        r.metric for r in self_scored
    }
    assert {r.annotation for r in self_scored} == {"cluster_elbow_PCA_2"}
    # n_clusters meta kept:
    assert "n_clusters" in metrics
    # ARI/NMI agreement vs the annotation, tagged correctly:
    agree = [r for r in rows if r.stat_family == "cluster_agreement"]
    assert {r.metric for r in agree} == {"adjusted_rand", "normalized_mutual_info"}
    assert all(r.annotation == "grp" and r.metric_kind == "agreement" for r in agree)
    assert all(r.label_kind == "kmeans_elbow" for r in agree)
    # Auto-clusters recover well-separated blobs → high agreement.
    ari = next(r for r in agree if r.metric == "adjusted_rand")
    assert ari.value > 0.5
    # Membership column still emitted.
    assert any(isinstance(o, AnnotationColumn) for o in outs)


def test_cluster_validity_no_annotations_still_emits_membership():
    from protspace.stats.base import AnnotationColumn, StatContext, StatRow
    from protspace.stats.metrics.validity import ClusterValidityStatistic

    X, _ = _blobs(n=150, centers=3, dim=2, seed=62)
    ids = [f"p{i}" for i in range(150)]
    outs = ClusterValidityStatistic().compute(
        StatContext("projection", "P", coords=X, ids=ids)
    )
    assert any(isinstance(o, AnnotationColumn) for o in outs)
    assert not [
        r
        for r in outs
        if isinstance(r, StatRow) and r.stat_family == "cluster_agreement"
    ]


def test_cluster_validity_too_few_points():
    ctx = StatContext("projection", "PCA_2", coords=np.zeros((2, 2)), ids=["a", "b"])
    assert ClusterValidityStatistic().compute(ctx) == []


def test_cluster_self_validity_skipped_without_membership_column():
    """No membership column means the clustering can never be selected in the UI,
    so scoring it would file rows nothing can ever read."""
    X, _ = _blobs(n=150, centers=3, dim=2, seed=63)
    ids = [f"p{i}" for i in range(150)]
    outs = ClusterValidityStatistic().compute(
        StatContext(
            "projection",
            "P",
            coords=X,
            ids=ids,
            params={"cluster_annotations": False},
        )
    )
    assert not [
        r
        for r in outs
        if isinstance(r, StatRow) and r.stat_family == "annotation_validity"
    ]


def test_cluster_self_validity_matches_direct_annotation_scoring():
    """The pipeline's cluster rows are what ``AnnotationValidityStatistic`` produces
    for the same labels, byte for byte.

    This is the guard that lets an existing bundle be re-scored in place by driving
    the statistic directly: if the two ever diverge, a patched bundle would disagree
    with what a fresh ``protspace stats`` run emits for the same data.
    """
    from protspace.stats.base import AnnotationColumn
    from protspace.stats.metrics.annotation_validity import AnnotationValidityStatistic

    X, _ = _blobs(n=180, centers=3, dim=2, seed=64)
    ids = [f"p{i}" for i in range(180)]
    ctx = StatContext("projection", "PCA_2", coords=X, ids=ids)
    outs = ClusterValidityStatistic().compute(ctx)

    pipeline_rows = [
        r.to_record()
        for r in outs
        if isinstance(r, StatRow) and r.stat_family == "annotation_validity"
    ]
    assert pipeline_rows  # the guard is worthless if it compares two empty lists

    # Rebuild the labels the way an out-of-band re-score must: from the membership
    # column already in the bundle, with the `|silhouette` confidence stripped.
    column = next(o for o in outs if isinstance(o, AnnotationColumn))
    labels = {pid: str(v).split("|", 1)[0] for pid, v in column.values.items()}
    direct = AnnotationValidityStatistic(label_kind="kmeans_elbow").compute(
        StatContext(
            "projection", "PCA_2", coords=X, ids=ids, annotations={column.name: labels}
        )
    )

    assert [r.to_record() for r in direct] == pipeline_rows


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


def test_spearman_distance_uses_midranks_and_guards_collapse():
    from protspace.stats.metrics.faithfulness import (
        _rankdata_average,
        _spearman_distance,
    )

    # Midranks: tied values share their mean rank (not ordinal index-broken ranks).
    got = _rankdata_average(np.array([10.0, 10.0, 20.0, 30.0, 30.0, 30.0]))
    assert list(got) == [1.5, 1.5, 3.0, 5.0, 5.0, 5.0]

    # A collapsed projection (all coords coincident) has all-tied output distances;
    # the old ordinal ranks reported a spurious ~1.0 — midranks make it NaN.
    emb = np.random.default_rng(0).normal(size=(40, 4))
    assert np.isnan(_spearman_distance(emb, np.zeros((40, 2)), "euclidean"))
    # A faithful (identity) layout still scores ~1.0.
    assert _spearman_distance(emb, emb, "euclidean") == pytest.approx(1.0)


def test_faithfulness_skips_without_embedding():
    ctx = StatContext(
        "projection", "PCA_2", coords=np.zeros((10, 2)), ids=[str(i) for i in range(10)]
    )
    assert FaithfulnessStatistic().compute(ctx) == []


def test_faithfulness_marks_random_triplet_skipped_for_unsupported_metric():
    # chebyshev is accepted by the kNN/pairwise path but NOT by paired_distances
    # (which random_triplet uses). The metric must not vanish silently — it should
    # emit a row flagged skipped while the other four metrics still compute.
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
            high_dim_metric="chebyshev",
        )
    )
    by_metric = {r.metric: r for r in rows}
    assert "random_triplet" in by_metric  # present, not dropped
    assert by_metric["random_triplet"].extra.get("skipped")
    assert np.isnan(by_metric["random_triplet"].value)
    # The metrics that DO support chebyshev still produced real values.
    assert not np.isnan(by_metric["knn_overlap"].value)
    assert "skipped" not in by_metric["knn_overlap"].extra


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
    # Without annotations the only scored labels are the auto-clusters' own, so
    # the validity metrics here all belong to the membership column.
    assert "n_clusters" in metrics
    assert {"silhouette", "davies_bouldin", "calinski_harabasz"} <= metrics
    assert {
        r.annotation for r in report.rows if r.stat_family == "annotation_validity"
    } == {"cluster_elbow_ProtT5 — PCA 2"}
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
    assert any(r.metric == "n_clusters" for r in report.rows)


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
    assert any(r.metric == "n_clusters" for r in report.rows)


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


def test_driver_emits_embedding_and_projection_annotation_validity():
    from sklearn.decomposition import PCA

    from protspace.stats import compute_statistics

    X, y = _blobs(n=180, centers=4, dim=8, seed=71)
    coords = PCA(n_components=2, random_state=0).fit_transform(X)
    # Named `hdrs` (not `headers`) so the class body below can read it: a class
    # attribute assignment `headers = headers` would shadow the enclosing local
    # in the class namespace before the RHS is resolved, raising NameError.
    hdrs = [f"p{i}" for i in range(180)]
    ann = {"grp": {pid: f"g{int(c)}" for pid, c in zip(hdrs, y, strict=False)}}

    class _Emb:
        name = "e"
        data = X
        headers = hdrs
        precomputed = False

    report = compute_statistics(
        [_Emb()],
        [{"name": "e — PCA 2", "data": coords, "ids": hdrs, "source": "e"}],
        annotations=ann,
    )
    av = [r for r in report.rows if r.stat_family == "annotation_validity"]
    kinds = {(r.space_kind, r.annotation) for r in av}
    assert ("embedding", "grp") in kinds  # once-per-embedding pass
    assert ("projection", "grp") in kinds  # per-projection pass
    # embedding is computed exactly once per (embedding, annotation, metric);
    # category is None selects the aggregate row, not its per-category parts.
    emb_sil = [
        r
        for r in av
        if r.space_kind == "embedding"
        and r.metric == "silhouette"
        and r.category is None
    ]
    assert len(emb_sil) == 1


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
    assert any(r.metric == "n_clusters" for r in report.rows)


# --------------------------------------------------------------------------- #
# 5. routing / destination (route-projection-statistics, Phase 1A)
# --------------------------------------------------------------------------- #


def _statrow(metric, value, *, destination=None, annotation="", **extra):
    kw = {} if destination is None else {"destination": destination}
    return StatRow(
        space_kind="projection",
        space_name="PCA_2",
        annotation=annotation,
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
    # destination is carriage metadata, never a column in the tidy schema.
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


def test_cluster_validity_emits_plain_membership_labels():
    from protspace.stats.base import AnnotationColumn

    X, _ = _blobs(n=200, centers=4, dim=2, seed=31)
    ids = [f"p{i}" for i in range(200)]
    outs = ClusterValidityStatistic().compute(
        StatContext("projection", "PCA_2", coords=X, ids=ids)
    )
    cols = {o.name: o for o in outs if isinstance(o, AnnotationColumn)}
    assert set(cols) == {"cluster_elbow_PCA_2"}
    mem = cols["cluster_elbow_PCA_2"]
    assert mem.destination == "annotation" and mem.kind == "categorical"
    assert set(mem.values) == set(ids)  # one value per protein, joined by id
    # A bare `cluster N` label, the shape of any curated categorical annotation. The
    # membership value used to carry that point's own silhouette as `cluster N|0.41`;
    # the per-cluster rows below now report separation instead, so nothing downstream
    # has to treat a cluster column's `|` suffix as a special kind of score.
    for v in mem.values.values():
        assert v.startswith("cluster ")
        assert "|" not in v
    # The scores that replaced it: per-category silhouette on this same labelling.
    per_category = {
        r.category
        for r in outs
        if isinstance(r, StatRow)
        and r.annotation == "cluster_elbow_PCA_2"
        and r.metric == "silhouette"
        and r.category is not None
    }
    assert per_category == set(mem.values.values())


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
    # the n_clusters meta row is still produced (self-validity rows are gone)
    assert any(getattr(o, "metric", None) == "n_clusters" for o in outs)


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


def test_kmeans_elbow_subsample_is_row_order_invariant_with_ids():
    """Above max_fit_sample the fit-subsample must be id-canonical: the SAME proteins
    in a different row order must yield the same elbow K and the same per-id cluster
    assignment. (A positional draw would pick different proteins and shift labels.)"""
    X, _ = _blobs(n=400, centers=4, dim=2, seed=43)
    ids = [f"p{i}" for i in range(400)]
    res1 = kmeans_elbow(X, ids=ids, rng_seed=42, max_fit_sample=100)

    perm = np.random.default_rng(0).permutation(400)
    res2 = kmeans_elbow(
        X[perm], ids=[ids[i] for i in perm], rng_seed=42, max_fit_sample=100
    )
    assert res1.k == res2.k
    m1 = dict(zip(ids, res1.labels, strict=True))
    m2 = dict(zip([ids[i] for i in perm], res2.labels, strict=True))
    assert m1 == m2  # per-id membership invariant to input row order


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


def test_cluster_silhouette_matches_sklearn_on_the_membership_labels():
    """The silhouette reported for a cluster column is sklearn's silhouette on exactly
    the labels that column carries — not on some other labelling. (This used to pin the
    per-point `|score` the column carried instead; the column is plain now, so the
    aggregate is the number worth pinning.)"""
    from sklearn.metrics import silhouette_score

    from protspace.stats.base import AnnotationColumn
    from protspace.stats.cluster.kmeans_elbow import kmeans_elbow

    X, _ = _blobs(n=300, centers=4, dim=2, seed=45)
    ids = [f"p{i}" for i in range(300)]
    outs = ClusterValidityStatistic().compute(
        StatContext("projection", "P", coords=X, ids=ids)
    )
    col = next(
        o
        for o in outs
        if isinstance(o, AnnotationColumn) and o.name == "cluster_elbow_P"
    )

    # Recompute independently via the same deterministic elbow selection. n=300 is
    # under DEFAULT_SAMPLE_THRESHOLD, so the statistic scores every point and the
    # comparison is exact rather than an estimate.
    res = kmeans_elbow(X, rng_seed=42)

    def partition(labels_seq):
        """Grouping only. KMeans cluster numbers are arbitrary, so two runs of the
        same clustering can name the same groups differently; silhouette depends on
        the grouping alone."""
        groups: dict = {}
        for i, lbl in enumerate(labels_seq):
            groups.setdefault(lbl, set()).add(i)
        return {frozenset(g) for g in groups.values()}

    assert partition(col.values[pid] for pid in ids) == partition(res.labels)
    assert _cluster_silhouette(outs) == pytest.approx(
        float(silhouette_score(X, res.labels)), abs=1e-6
    )


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
    assert cols == {"cluster_elbow_PCA_2", "cluster_silhouette_PCA_2"}
    kinds = {r.label_kind for r in outs if isinstance(r, StatRow)}
    assert kinds == {"kmeans_elbow", "kmeans_silhouette"}


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
    # A faithful PCA projection of separated blobs preserves global ordering well:
    # assert meaningfully-high values, not just the by-construction [0,1]/[-1,1]
    # bounds (which hold for any impl, even a broken one).
    assert rows["random_triplet"].value > 0.75  # well above 0.5 chance
    assert rows["spearman_distance"].value > 0.75
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


# --------------------------------------------------------------------------- #
# regression: review findings
# --------------------------------------------------------------------------- #


def test_align_returns_none_when_no_ids_and_row_counts_differ():
    """Regression: with no ids to join on and mismatched row counts, `_align`
    must return None rather than fall through to positional indexing (which built
    out-of-range coord indices → IndexError, swallowed → the projection's whole
    stats report silently dropped)."""
    from protspace.stats.driver import _align

    emb = _EmbSet("E", np.zeros((5, 3)), [f"p{i}" for i in range(5)])
    coords = np.zeros((3, 2))  # fewer rows than the embedding, and no ids
    assert _align(emb, None, coords) is None


def test_align_positional_fallback_when_no_ids_and_rowcounts_match():
    """With no ids to join on but equal row counts (the single-embedding prepare
    path), `_align` pairs rows positionally: coords, embedding and headers come back
    row-aligned and full-length."""
    from protspace.stats.driver import _align

    headers = [f"p{i}" for i in range(4)]
    emb = _EmbSet("E", np.arange(12.0).reshape(4, 3), headers)
    coords = np.arange(8.0).reshape(4, 2)
    coord_out, emb_out, ids_out = _align(emb, None, coords)
    assert ids_out == headers
    assert np.array_equal(coord_out, coords)
    assert np.array_equal(emb_out, emb.data)


def test_align_returns_views_on_identity_match_without_copy():
    """When every row matches in order (the common single-embedding path), `_align`
    must return the source arrays as-is — not a full fancy-index copy that would
    waste ~GB at 570k scale when faithfulness then skips past its ceiling."""
    from protspace.stats.driver import _align

    ids = [f"p{i}" for i in range(5)]
    emb = _EmbSet("E", np.arange(15.0).reshape(5, 3), ids)
    coords = np.arange(10.0).reshape(5, 2)
    coord_out, emb_out, ids_out = _align(emb, ids, coords)
    assert emb_out is emb.data  # view, no copy
    assert coord_out is coords
    assert ids_out == ids

    # A reordered join still gathers (and stays correct).
    coord_out2, emb_out2, ids_out2 = _align(emb, list(reversed(ids)), coords)
    assert emb_out2 is not emb.data
    assert ids_out2 == list(reversed(ids))
    assert np.array_equal(emb_out2[0], emb.data[4])


def test_select_embedding_abstains_when_ambiguous():
    """With no `source` and two embeddings that both fully cover the ids, the
    choice is ambiguous — `_select_embedding` must return None (skip faithfulness)
    rather than silently score against embedding_sets[0]."""
    from protspace.stats.driver import _select_embedding

    ids = [f"p{i}" for i in range(4)]
    a = _EmbSet("esm2", np.zeros((4, 3)), ids)
    b = _EmbSet("prot_t5", np.zeros((4, 3)), ids)
    red = {"name": "PCA_2", "ids": ids}  # no source
    assert _select_embedding(red, [a, b], {"esm2": a, "prot_t5": b}) is None
    # An explicit source disambiguates and is honoured.
    red_src = {"name": "PCA_2", "ids": ids, "source": "prot_t5"}
    assert _select_embedding(red_src, [a, b], {"esm2": a, "prot_t5": b}) is b


def test_silhouette_selection_falls_back_to_elbow_on_degenerate_coords():
    """Regression: `--cluster-selection silhouette` on a coincident projection
    leaves silhouette_labels None (silhouette_score raises for every K), emptying
    `labelings` — the projection used to emit nothing. It must fall back to the
    elbow labelling so membership/agreement rows still appear."""
    X = np.ones((30, 2))  # all-coincident → no scorable silhouette-K
    ctx = StatContext(
        "projection",
        "P",
        coords=X,
        ids=[f"p{i}" for i in range(30)],
        params={"cluster_selection": "silhouette"},
    )
    outs = ClusterValidityStatistic().compute(ctx)
    rows = [o for o in outs if isinstance(o, StatRow)]
    assert rows, "silhouette selection on degenerate coords dropped the projection"
    assert all(r.label_kind == "kmeans_elbow" for r in rows if r.metric == "n_clusters")
