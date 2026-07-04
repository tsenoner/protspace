import numpy as np

from protspace.stats.base import StatContext, StatRow
from protspace.stats.metrics.annotation_validity import AnnotationValidityStatistic


def _blobs(n=200, centers=4, dim=2, seed=1):
    from sklearn.datasets import make_blobs

    X, y = make_blobs(n_samples=n, centers=centers, n_features=dim, random_state=seed)
    return X, y


def test_scores_each_annotation_on_ctx_coords():
    X, y = _blobs(n=200, centers=4, dim=2, seed=3)
    ids = [f"p{i}" for i in range(200)]
    ann = {"grp": {pid: f"g{int(c)}" for pid, c in zip(ids, y, strict=True)}}
    outs = AnnotationValidityStatistic().compute(
        StatContext("projection", "PCA_2", coords=X, ids=ids, annotations=ann)
    )
    by_metric = {r.metric: r for r in outs if isinstance(r, StatRow)}
    assert {"silhouette", "davies_bouldin", "calinski_harabasz"} <= set(by_metric)
    s = by_metric["silhouette"]
    assert s.stat_family == "annotation_validity"
    assert s.annotation == "grp" and s.label_kind == "annotation"
    assert 0.4 < s.value <= 1.0  # well-separated blobs → high silhouette


def test_space_kind_is_taken_from_context():
    X, y = _blobs(n=120, centers=3, dim=8, seed=4)
    ids = [f"p{i}" for i in range(120)]
    ann = {"grp": {pid: f"g{int(c)}" for pid, c in zip(ids, y, strict=True)}}
    outs = AnnotationValidityStatistic().compute(
        StatContext("embedding", "prot_t5", coords=X, ids=ids, annotations=ann)
    )
    assert all(r.space_kind == "embedding" for r in outs)
    assert all(r.space_name == "prot_t5" for r in outs)


def test_missing_annotation_values_excluded():
    X, y = _blobs(n=100, centers=2, dim=2, seed=5)
    ids = [f"p{i}" for i in range(100)]
    # Only half the proteins have a category → the rest are dropped from scoring.
    ann = {"grp": {pid: f"g{int(c)}" for pid, c in list(zip(ids, y, strict=True))[:50]}}
    outs = AnnotationValidityStatistic().compute(
        StatContext("projection", "P", coords=X, ids=ids, annotations=ann)
    )
    sil = next(r for r in outs if r.metric == "silhouette")
    assert sil.extra["n_labels"] == 50


def test_single_category_annotation_emits_nothing():
    X, _ = _blobs(n=80, centers=1, dim=2, seed=6)
    ids = [f"p{i}" for i in range(80)]
    ann = {"grp": dict.fromkeys(ids, "only")}  # 1 category
    outs = AnnotationValidityStatistic().compute(
        StatContext("projection", "P", coords=X, ids=ids, annotations=ann)
    )
    assert outs == []


def test_no_annotations_returns_empty():
    X, _ = _blobs(n=50, centers=2, dim=2, seed=7)
    outs = AnnotationValidityStatistic().compute(
        StatContext("projection", "P", coords=X, ids=[f"p{i}" for i in range(50)])
    )
    assert outs == []


def test_subsample_path_flags_sampled_and_is_deterministic():
    """When n exceeds ``sample_threshold`` the shared subsample kicks in: the
    emitted silhouette row must report ``sampled=True`` and ``n_labels`` equal to
    the threshold (not the full n), and repeating the identical call must
    reproduce the exact same value (deterministic rng_seed-based subsample)."""
    threshold = 30
    X, y = _blobs(n=200, centers=4, dim=2, seed=9)
    ids = [f"p{i}" for i in range(200)]
    ann = {"grp": {pid: f"g{int(c)}" for pid, c in zip(ids, y, strict=True)}}

    def _run():
        outs = AnnotationValidityStatistic().compute(
            StatContext(
                "projection",
                "P",
                coords=X,
                ids=ids,
                annotations=ann,
                params={"sample_threshold": threshold},
            )
        )
        return next(r for r in outs if r.metric == "silhouette")

    sil = _run()
    assert sil.extra["sampled"] is True
    assert sil.extra["n_labels"] == threshold

    sil_again = _run()
    assert sil_again.value == sil.value
    assert sil_again.extra == sil.extra
