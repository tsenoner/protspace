"""Annotation-based cluster-validity: how well an annotation's categories
separate in a given space (embedding or projection).

silhouette / Davies-Bouldin / Calinski-Harabasz are computed with the
annotation's category labels (not auto-KMeans labels), on ``ctx.coords``: the
driver hands us the embedding for the once-per-embedding pass and the 2D
projection for the per-projection pass. silhouette and Davies-Bouldin are
additionally emitted per category (rows carrying ``category``). The
silhouette aggregate is the size-weighted mean of its per-category parts (a
mean over points, not categories); the Davies-Bouldin aggregate is the
unweighted mean of its per-cluster values. Calinski-Harabasz stays
aggregate-only. scikit-learn imports are function-local.

``ClusterValidityStatistic`` reuses this statistic to score its own KMeans
membership labels (``label_kind`` names the K-selection instead of
``"annotation"``), so an auto-clustering's separation is measured by exactly the
code that measures a curated annotation's -- there is no second implementation
that could drift from it.
"""

from __future__ import annotations

import numpy as np

from protspace.stats._sampling import id_seed, sorted_subsample
from protspace.stats.base import DEFAULT_SAMPLE_THRESHOLD, StatContext, StatRow


def _per_category_silhouette(
    sample_values: np.ndarray,
    labels: np.ndarray,
    cat_names: list[str],
    scorable: np.ndarray,
) -> dict[str, float]:
    """Mean silhouette per category, for the categories with >= 2 members.

    ``silhouette_score`` is ``silhouette_samples(...).mean()``, a mean over POINTS,
    so the aggregate is the size-weighted mean of these per-category values, not
    their plain mean. No extra work is done either way: the per-point array is
    retained instead of being collapsed and discarded.

    Dropping the singleton categories leaves that identity exact rather than
    approximate: scikit-learn defines a lone point's silhouette as 0, so each one
    contributes ``1 * 0`` to the weighted sum. The aggregate therefore stays the
    standard ``silhouette_score`` over every point, singletons included, while the
    rows report only the categories the number can actually describe.
    """
    return {
        name: float(sample_values[labels == j].mean())
        for j, name in enumerate(cat_names)
        if scorable[j]
    }


def _per_category_davies_bouldin(
    Xa: np.ndarray, labels: np.ndarray, cat_names: list[str]
) -> dict[str, float]:
    """Per-cluster Davies-Bouldin ``R_i``: overlap with the single worst rival.

    ``R_i = max over j != i of (s_i + s_j) / ||c_i - c_j||`` for centroids ``c``
    and mean intra-cluster distances ``s``. scikit-learn's ``davies_bouldin_score``
    is the mean of exactly these, and exposes only that mean.

    ``Xa``/``labels`` must already be restricted to the categories with >= 2
    members, and ``labels`` renumbered contiguously. A singleton is its own
    centroid, so its ``s_i`` is 0 and its ``R_i`` measures the rival's radius over
    the gap instead of anything about itself. Unlike the silhouette that is not a
    harmless zero: the index is a mean over CATEGORIES, so one singleton takes a
    full ``1/k`` share of the aggregate no matter how few proteins it holds.
    """
    from sklearn.metrics import pairwise_distances

    k = len(cat_names)
    centroids = np.array([Xa[labels == j].mean(axis=0) for j in range(k)])
    intra = np.array(
        [
            float(np.linalg.norm(Xa[labels == j] - centroids[j], axis=1).mean())
            for j in range(k)
        ]
    )
    # k x k, not k x k x d: a broadcast (centroids[:, None] - centroids[None])
    # norm materialises a k x k x d tensor, which is unbounded on both axes (d is
    # the full pLM dim, k is unbounded for an explicit --stats-annotation).
    separation = pairwise_distances(centroids)
    # Mirrors sklearn's own short-circuit, which fires BEFORE the substitution below and
    # uses `isclose` (atol 1e-8), not `== 0`. Without it, categories that share a centroid
    # to within floating-point noise -- concentric rings, any symmetric arrangement -- have
    # their ratios divided by a ~1e-16 separation instead of being recognised as degenerate,
    # and the index explodes to ~1e16 rather than collapsing to 0. Returning zeros for every
    # part rather than a bare 0.0 aggregate keeps "aggregate == mean of the parts" exact.
    if np.allclose(intra, 0) or np.allclose(separation, 0):
        return dict.fromkeys(cat_names, 0.0)
    # Coincident centroids (and the whole diagonal) become inf so their ratio is 0 and
    # cannot win the row max. Without this the diagonal would divide by zero.
    separation[separation == 0] = np.inf
    per_cluster = ((intra[:, None] + intra[None, :]) / separation).max(axis=1)
    return {name: float(per_cluster[j]) for j, name in enumerate(cat_names)}


class AnnotationValidityStatistic:
    """silhouette / DBI / CH of each annotation's categories on ``ctx.coords``."""

    family = "annotation_validity"
    requires_embedding = False
    embedding_space = True  # also run by the driver's once-per-embedding pass

    def __init__(self, label_kind: str = "annotation") -> None:
        """``label_kind`` tags every emitted row with the labelling that was scored.

        The default names the ordinary case (a curated annotation's own categories).
        ``ClusterValidityStatistic`` reuses this statistic to score its own KMeans
        membership labels and passes ``kmeans_elbow`` / ``kmeans_silhouette``, so the
        tidy table records which K-selection produced the score rather than claiming
        an annotation did.
        """
        self._label_kind = label_kind

    def compute(self, ctx: StatContext) -> list[StatRow]:
        if not ctx.annotations:
            return []
        from sklearn.metrics import calinski_harabasz_score

        coords = np.asarray(ctx.coords)
        threshold = int(ctx.params.get("sample_threshold", DEFAULT_SAMPLE_THRESHOLD))
        id_to_row = {pid: i for i, pid in enumerate(ctx.ids)}
        rows: list[StatRow] = []

        for name, mapping in ctx.annotations.items():
            # Annotated points present in this space, in canonical id order — so the
            # subsample below is reproducible and picks the *same* proteins across
            # spaces (embedding vs projection) whenever the annotated id-set matches;
            # otherwise the "separability ceiling" would compare two different draws.
            present = sorted(
                (pid, id_to_row[pid], cat)
                for pid, cat in mapping.items()
                if pid in id_to_row
            )
            if len(present) < 3 or len({c for _, _, c in present}) < 2:
                continue  # need >= 3 points, >= 2 categories

            # Bound cost: subsample (id-seeded) BEFORE gathering + upcasting, so at
            # 570k scale we materialise ~threshold float64 rows, not all of them
            # (label integers are arbitrary, so renumbering post-subsample is
            # metric-invariant). Shared across all three metrics.
            rng = np.random.default_rng(id_seed(ctx.rng_seed, [p[0] for p in present]))
            sub = sorted_subsample(len(present), threshold, rng)
            if sub is not None:
                present = [present[i] for i in sub]
            row_idx = [r for _, r, _ in present]
            cats = [c for _, _, c in present]
            cat_to_int = {c: j for j, c in enumerate(sorted(set(cats)))}
            Xa = np.asarray(coords[row_idx], dtype=float)
            labels = np.asarray([cat_to_int[c] for c in cats])
            n = Xa.shape[0]
            _, counts = np.unique(labels, return_counts=True)
            achieved = len(counts)
            if achieved < 2:  # a category vanished under subsampling
                continue
            base = {
                "space_kind": ctx.space_kind,
                "space_name": ctx.space_name,
                "annotation": name,
                "stat_family": self.family,
                "label_kind": self._label_kind,
            }
            extra = {
                "seed": ctx.rng_seed,
                "n_labels": int(n),
                "n_categories": int(achieved),
                "sampled": sub is not None,
            }

            cat_names = sorted(cat_to_int, key=cat_to_int.get)

            def _emit(
                metric_name: str,
                value: float,
                category: str | None = None,
                provenance: dict | None = None,
            ):
                # extra/base are reassigned each outer-loop iteration, but _emit is
                # always called within the same iteration that defines it, before
                # the next reassignment, so the closure never sees a stale value.
                #
                # `provenance` overrides `extra` for metrics scored on a restricted
                # subset of the labelling; see the DBI/CH block below.
                rows.append(
                    StatRow(
                        metric=metric_name,
                        metric_kind="validity",
                        value=float(value),
                        category=category,
                        extra=provenance or extra,  # noqa: B023
                        **base,  # noqa: B023
                    )
                )

            # A one-member category has no spread, so any score for it describes its
            # neighbours rather than itself. It gets no per-category row, and it is
            # kept out of the metrics whose aggregate it would distort.
            scorable = counts >= 2

            # silhouette needs 2 <= k <= n-1.
            if 2 <= achieved <= n - 1:
                try:
                    from sklearn.metrics import silhouette_samples

                    samples = silhouette_samples(Xa, labels)
                    # Compute the parts BEFORE emitting the aggregate: if the
                    # decomposition raises, the except below must discard the
                    # whole attempt, not leave an aggregate row with zero parts.
                    per_cat = _per_category_silhouette(
                        samples, labels, cat_names, scorable
                    )
                    _emit("silhouette", samples.mean())
                    for cat, value in per_cat.items():
                        _emit("silhouette", value, cat)
                except Exception:  # noqa: BLE001 - best-effort
                    pass

            # DBI and CH run over the scorable categories only. Restricting the
            # input, rather than suppressing the metrics whenever any singleton
            # exists, is what makes them available for annotations like a taxonomic
            # rank, where a handful of one-member categories used to hide the score
            # of every other category. It also keeps each aggregate the plain mean
            # of the per-category rows actually emitted.
            if int(scorable.sum()) >= 2:
                keep = np.flatnonzero(scorable)
                point_mask = scorable[labels]
                Xs = Xa[point_mask]
                # sklearn wants contiguous 0..k'-1 labels once categories drop out.
                renumber = np.full(achieved, -1)
                renumber[keep] = np.arange(len(keep))
                ls = renumber[labels[point_mask]]
                scored_names = [cat_names[j] for j in keep]
                # These two metrics saw a smaller labelling than the silhouette did, so
                # they must not inherit the unrestricted counts: the frontend prints
                # n_labels/n_categories verbatim as the scope line beside the number
                # ("Computed over N categories, M proteins"). With one singleton dropped
                # that line claimed the full set for a mean taken over fewer.
                scored_extra = {
                    **extra,
                    "n_labels": int(Xs.shape[0]),
                    "n_categories": int(len(keep)),
                }
                try:
                    # Same ordering constraint as the silhouette block above.
                    per_cat = _per_category_davies_bouldin(Xs, ls, scored_names)
                    # The aggregate is the mean of these parts by construction, as the
                    # silhouette block derives its own from `silhouette_samples`.
                    # `davies_bouldin_score` would recompute the centroids and their
                    # pairwise distances to return exactly this number, and an
                    # independently computed aggregate could drift from its own rows.
                    _emit(
                        "davies_bouldin",
                        float(np.mean(list(per_cat.values()))),
                        provenance=scored_extra,
                    )
                    for cat, value in per_cat.items():
                        _emit("davies_bouldin", value, cat, provenance=scored_extra)
                except Exception:  # noqa: BLE001 - best-effort
                    pass

                try:
                    # Aggregate only: CH is a global variance ratio with no
                    # accepted per-cluster decomposition.
                    _emit(
                        "calinski_harabasz",
                        calinski_harabasz_score(Xs, ls),
                        provenance=scored_extra,
                    )
                except Exception:  # noqa: BLE001 - best-effort
                    pass
        return rows
