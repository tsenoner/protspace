import numpy as np
import pytest

from protspace.stats.base import StatContext, StatRow
from protspace.stats.metrics.annotation_validity import (
    AnnotationValidityStatistic,
    _per_category_davies_bouldin,
)


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


def test_per_category_silhouette_size_weighted_averages_to_the_aggregate():
    # UNBALANCED category sizes on purpose: silhouette_score(X, y) is defined
    # as silhouette_samples(X, y).mean(), a mean over POINTS, not categories.
    # The per-category rows are per-CATEGORY means, so recovering the
    # aggregate from them requires weighting each part by its category size.
    # A balanced fixture makes the unweighted and size-weighted means
    # coincide and cannot tell the two apart.
    from sklearn.datasets import make_blobs

    sizes = [120, 50, 20, 10]
    X, y = make_blobs(n_samples=sizes, n_features=2, random_state=3)
    ids = [f"p{i}" for i in range(len(y))]
    ann = {"grp": {pid: f"g{int(c)}" for pid, c in zip(ids, y, strict=True)}}
    outs = AnnotationValidityStatistic().compute(
        StatContext("projection", "PCA_2", coords=X, ids=ids, annotations=ann)
    )
    aggregate = next(r for r in outs if r.metric == "silhouette" and r.category is None)
    per_cat = [r for r in outs if r.metric == "silhouette" and r.category is not None]

    assert len(per_cat) == 4
    assert {r.category for r in per_cat} == {"g0", "g1", "g2", "g3"}
    # A decomposition that just repeats the aggregate satisfies the mean identity
    # vacuously; the parts must not all collapse to that one repeated value. Not
    # asserting all 4 are pairwise distinct: nothing rules out two categories
    # legitimately tying (see the Davies-Bouldin test below for a real example
    # of that on this very fixture).
    assert len({round(r.value, 9) for r in per_cat}) > 1
    labels, counts = np.unique(y, return_counts=True)
    cat_size = {f"g{int(c)}": int(n) for c, n in zip(labels, counts, strict=True)}
    total = len(y)
    # The weights come from the full y, the values from the post-subsample labels.
    # That only agrees below DEFAULT_SAMPLE_THRESHOLD; pin it, or growing this
    # fixture past the threshold would fail here looking like a decomposition bug.
    assert aggregate.extra["sampled"] is False
    weighted_mean = sum(cat_size[r.category] * r.value for r in per_cat) / total
    assert weighted_mean == pytest.approx(aggregate.value)


def test_per_category_davies_bouldin_averages_to_the_aggregate():
    # Same unbalanced fixture as the silhouette test above. Unlike silhouette,
    # scikit-learn's davies_bouldin_score really is the unweighted mean of the
    # per-cluster R_i values, so the plain mean is the correct identity here;
    # exercising it on unbalanced categories is a strictly stronger check than
    # a balanced fixture, since it also rules out an accidental match.
    #
    # The statistic now derives the aggregate from the parts rather than calling
    # davies_bouldin_score a second time, which would make a parts-vs-aggregate
    # assertion tautological. So sklearn is pinned here as the external oracle
    # instead: this fixture has no singleton and 200 rows (under the subsample
    # threshold), so every category is scorable and `ls` is `y` renumbered by
    # sorted name -- g0..g3 already in that order -- making (X, y) the exact
    # input the statistic scored.
    from sklearn.datasets import make_blobs
    from sklearn.metrics import davies_bouldin_score

    sizes = [120, 50, 20, 10]
    X, y = make_blobs(n_samples=sizes, n_features=2, random_state=3)
    ids = [f"p{i}" for i in range(len(y))]
    ann = {"grp": {pid: f"g{int(c)}" for pid, c in zip(ids, y, strict=True)}}
    outs = AnnotationValidityStatistic().compute(
        StatContext("projection", "PCA_2", coords=X, ids=ids, annotations=ann)
    )
    aggregate = next(
        r for r in outs if r.metric == "davies_bouldin" and r.category is None
    )
    per_cat = [
        r for r in outs if r.metric == "davies_bouldin" and r.category is not None
    ]

    assert len(per_cat) == 4
    assert {r.category for r in per_cat} == {"g0", "g1", "g2", "g3"}
    # A decomposition that just repeats the aggregate satisfies the mean identity
    # vacuously; the parts must not all collapse to that one repeated value. Not
    # asserting all 4 are pairwise distinct: R_i = max_{j!=i} (s_i+s_j)/d_ij ties
    # exactly for a mutual worst-rival pair, and g0/g1 do on this exact fixture
    # (verified directly) -- a property of the metric, not a decomposition bug.
    assert len({round(r.value, 9) for r in per_cat}) > 1
    assert np.mean([r.value for r in per_cat]) == pytest.approx(aggregate.value)
    assert aggregate.value == pytest.approx(davies_bouldin_score(X, y))


def test_davies_bouldin_collapses_when_centroids_coincide():
    # sklearn short-circuits to 0.0 when the centroids (or the intra-cluster spreads)
    # are all within `isclose`'s 1e-8 of zero, BEFORE substituting inf for exact zeros.
    # Reimplementing only the `== 0` substitution divides by a ~1e-16 separation instead
    # and the index explodes to ~1e16 -- a finite float64 that reaches the bundle and
    # destroys the legend strip's shared axis.
    #
    # Concentric rings: every point is distinct and the two categories are perfectly
    # nested, but both centroids sit on the origin.
    from sklearn.metrics import davies_bouldin_score

    theta = np.linspace(0, 2 * np.pi, 200, endpoint=False)
    X = np.vstack(
        [
            np.c_[np.cos(theta), np.sin(theta)],
            np.c_[5 * np.cos(theta), 5 * np.sin(theta)],
        ]
    )
    y = np.array([0] * 200 + [1] * 200)

    per_cat = _per_category_davies_bouldin(X, y, ["inner", "outer"])

    assert per_cat == {"inner": 0.0, "outer": 0.0}
    # Both halves of the contract at once: matches sklearn, and the aggregate is still
    # exactly the mean of the parts (a bare 0.0 aggregate would break the second).
    assert np.mean(list(per_cat.values())) == pytest.approx(davies_bouldin_score(X, y))


def test_restricted_metrics_report_the_labelling_they_actually_scored():
    # DBI/CH drop singleton categories and score what is left, but `extra_json` used to
    # be built once from the unrestricted set and attached to every metric. The frontend
    # prints n_categories/n_labels verbatim as the scope line next to the number, so a
    # taxonomic rank with singletons advertised a wider basis than was measured.
    rng = np.random.default_rng(0)
    X = np.vstack(
        [
            rng.normal(0, 0.1, size=(30, 2)),
            rng.normal(5, 0.1, size=(29, 2)),
            np.array([[50.0, 50.0]]),  # the singleton
        ]
    )
    cats = ["a"] * 30 + ["b"] * 29 + ["lonely"]
    ids = [f"p{i}" for i in range(60)]
    outs = AnnotationValidityStatistic().compute(
        StatContext(
            "projection",
            "PCA_2",
            coords=X,
            ids=ids,
            annotations={"grp": dict(zip(ids, cats, strict=True))},
        )
    )
    by_metric = {(r.metric, r.category): r for r in outs}

    # Silhouette saw every point and every category, singleton included.
    unrestricted = by_metric[("silhouette", None)].extra
    assert unrestricted["n_labels"] == 60
    assert unrestricted["n_categories"] == 3

    # DBI and CH saw 59 points across 2 categories, and must say so.
    for metric in ("davies_bouldin", "calinski_harabasz"):
        provenance = by_metric[(metric, None)].extra
        assert provenance["n_labels"] == 59, metric
        assert provenance["n_categories"] == 2, metric
        # Only the two counts are overridden; the rest of the provenance is shared.
        assert provenance["seed"] == unrestricted["seed"]
        assert provenance["sampled"] == unrestricted["sampled"]

    # Per-category DBI rows carry the same restricted scope as their aggregate.
    assert by_metric[("davies_bouldin", "a")].extra["n_categories"] == 2


def test_silhouette_emission_discards_the_whole_attempt_when_decomposition_fails(
    monkeypatch,
):
    """571ecae7 fixed the emission order so a failing per-category decomposition
    discards the whole attempt instead of leaving a bare aggregate row behind (the
    aggregate is now emitted only after the per-category computation succeeds).
    Pin that ordering directly: if `_per_category_silhouette` raises, no silhouette
    row -- aggregate or per-category -- may survive."""
    import protspace.stats.metrics.annotation_validity as mod

    def _boom(*args, **kwargs):
        raise RuntimeError("boom")

    monkeypatch.setattr(mod, "_per_category_silhouette", _boom)

    X, y = _blobs(n=200, centers=4, dim=2, seed=3)
    ids = [f"p{i}" for i in range(200)]
    ann = {"grp": {pid: f"g{int(c)}" for pid, c in zip(ids, y, strict=True)}}
    outs = AnnotationValidityStatistic().compute(
        StatContext("projection", "PCA_2", coords=X, ids=ids, annotations=ann)
    )

    assert [r for r in outs if r.metric == "silhouette"] == []


def test_calinski_harabasz_stays_aggregate_only():
    # CH is a global variance ratio with no accepted per-cluster form.
    X, y = _blobs(n=200, centers=4, dim=2, seed=3)
    ids = [f"p{i}" for i in range(200)]
    ann = {"grp": {pid: f"g{int(c)}" for pid, c in zip(ids, y, strict=True)}}
    outs = AnnotationValidityStatistic().compute(
        StatContext("projection", "PCA_2", coords=X, ids=ids, annotations=ann)
    )
    ch = [r for r in outs if r.metric == "calinski_harabasz"]
    assert len(ch) == 1
    assert ch[0].category is None


def test_per_category_rows_are_emitted_for_the_embedding_pass_too():
    X, y = _blobs(n=120, centers=3, dim=8, seed=4)
    ids = [f"p{i}" for i in range(120)]
    ann = {"grp": {pid: f"g{int(c)}" for pid, c in zip(ids, y, strict=True)}}
    outs = AnnotationValidityStatistic().compute(
        StatContext("embedding", "prot_t5", coords=X, ids=ids, annotations=ann)
    )
    per_cat = [r for r in outs if r.category is not None]
    assert per_cat
    assert all(r.space_kind == "embedding" for r in per_cat)
    # Not just "some per-category row survived": suppressing per-category silhouette
    # alone, while leaving the Davies-Bouldin per-category rows, must also fail here.
    assert any(r.metric == "silhouette" for r in per_cat)


def test_singleton_category_is_dropped_but_the_others_still_score():
    # A one-member category has no spread, so it gets no per-category row of its
    # own -- for silhouette either, where scikit-learn would otherwise hand back a
    # fabricated-looking 0.0. It no longer suppresses Davies-Bouldin and
    # Calinski-Harabasz for every OTHER category: those now run over the
    # categories that do have >= 2 members. `lonely` used to cost `a` and `b`
    # both metrics entirely.
    X, _ = _blobs(n=60, centers=2, dim=2, seed=7)
    ids = [f"p{i}" for i in range(60)]
    cats = ["a"] * 30 + ["b"] * 29 + ["lonely"]
    ann = {"grp": dict(zip(ids, cats, strict=True))}
    outs = AnnotationValidityStatistic().compute(
        StatContext("projection", "P", coords=X, ids=ids, annotations=ann)
    )

    for metric in ("silhouette", "davies_bouldin"):
        scored = {r.category for r in outs if r.metric == metric and r.category}
        assert scored == {"a", "b"}
    assert [r for r in outs if r.metric == "calinski_harabasz"]

    # The silhouette aggregate still covers every point, `lonely` included, and
    # the size-weighted identity still closes EXACTLY because a lone point's
    # silhouette is 0 by definition. Dividing by 60 rather than 59 is the point:
    # re-weighting over just the surviving 59 would not reproduce the aggregate.
    sil_agg = next(r for r in outs if r.metric == "silhouette" and r.category is None)
    sil = {r.category: r.value for r in outs if r.metric == "silhouette" and r.category}
    assert (30 * sil["a"] + 29 * sil["b"]) / 60 == pytest.approx(sil_agg.value)

    # The Davies-Bouldin aggregate, by contrast, is computed over the two scored
    # categories only, so it stays the plain mean of exactly the rows emitted. This
    # is what fails if the singleton is filtered out of the emission but left in
    # the metric's input.
    dbi_agg = next(
        r for r in outs if r.metric == "davies_bouldin" and r.category is None
    )
    dbi = [r.value for r in outs if r.metric == "davies_bouldin" and r.category]
    assert np.mean(dbi) == pytest.approx(dbi_agg.value)


def test_category_is_written_to_the_arrow_table():
    from protspace.stats.base import StatsReport

    report = StatsReport()
    report.add(
        [
            StatRow(
                space_kind="projection",
                space_name="P",
                annotation="grp",
                stat_family="annotation_validity",
                label_kind="annotation",
                metric="silhouette",
                metric_kind="validity",
                value=0.5,
                category="g0",
            )
        ]
    )
    table = report.to_arrow()
    assert "category" in table.column_names
    assert table.column("category").to_pylist() == ["g0"]


def test_subsample_is_row_order_invariant():
    """The id-canonical subsample must pick the SAME proteins regardless of input
    row order, so the score is identical when the same points are shuffled. A
    positional (row-order) draw would select a different subset and drift — the
    guarantee the determinism-by-identical-call test above cannot catch."""
    threshold = 30
    X, y = _blobs(n=200, centers=4, dim=2, seed=9)
    ids = [f"p{i}" for i in range(200)]
    ann = {"grp": {pid: f"g{int(c)}" for pid, c in zip(ids, y, strict=True)}}

    def _sil(coords, order_ids):
        outs = AnnotationValidityStatistic().compute(
            StatContext(
                "projection",
                "P",
                coords=coords,
                ids=order_ids,
                annotations=ann,
                params={"sample_threshold": threshold},
            )
        )
        return next(r for r in outs if r.metric == "silhouette").value

    base = _sil(X, ids)
    perm = np.random.default_rng(0).permutation(200)
    shuffled = _sil(X[perm], [ids[i] for i in perm])
    assert shuffled == base  # same proteins sampled despite the reordering
