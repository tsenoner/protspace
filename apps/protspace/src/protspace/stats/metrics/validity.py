"""Auto-clustering (KMeans) on projection coordinates + agreement with annotations.

KMeans labels the projection. The K can be chosen by the inertia **elbow**
and/or by **max silhouette** (``ctx.params["cluster_selection"]`` = ``elbow`` |
``silhouette`` | ``both``); each selection is emitted with its own
``label_kind`` (``kmeans_elbow`` / ``kmeans_silhouette``). The chosen K is
emitted as a ``metric_kind="meta"`` row (``n_clusters``).

Each auto-clustering is also scored as if it were an annotation: its membership
labels are handed to ``AnnotationValidityStatistic`` (``label_kind`` naming the
K-selection rather than ``"annotation"``), giving silhouette / Davies-Bouldin /
Calinski-Harabasz, aggregate and per-category, filed under the membership
column's own name. These are descriptive, not a verdict: KMeans drew the
boundaries being graded, and a ``kmeans_silhouette`` K was chosen by maximising
the silhouette itself. The per-category values are the useful part, saying which
cluster is tight and which is mush, which no aggregate can.

Separately, when ``ctx.annotations`` are supplied, each auto-clustering is compared
against every annotation's category labels via **ARI** (``adjusted_rand``) and
**NMI** (``normalized_mutual_info``) — ``stat_family="cluster_agreement"``,
``metric_kind="agreement"`` — reusing the KMeans labels already computed (no
second sweep). Annotation-based *validity* (silhouette/DBI/CH scored on the
annotation's own categories) lives in ``AnnotationValidityStatistic``.

Each labelling also becomes a per-protein ``cluster_*`` membership column holding a
plain ``cluster N`` label, the same shape as a curated categorical annotation. It
formerly attached each point's own silhouette as a ``value|score`` confidence; the
per-cluster rows above report that separation on the scale the rest of the app reads,
so the point-level value is no longer computed.

scikit-learn imports are function-local to keep CLI startup fast.
"""

from __future__ import annotations

from dataclasses import replace
from typing import NamedTuple

import numpy as np

from protspace.stats.annotation_select import pair_by_id
from protspace.stats.base import (
    CLUSTER_COLUMN_PREFIX,
    DEFAULT_SAMPLE_THRESHOLD,
    AnnotationColumn,
    StatContext,
    StatRow,
)
from protspace.stats.cluster.kmeans_elbow import kmeans_elbow
from protspace.stats.metrics.annotation_validity import AnnotationValidityStatistic

# Above this many points the KMeans elbow sweep fits on a random subsample (+predict)
# rather than the full projection, bounding cost at 570k+ scale.
DEFAULT_MAX_FIT_SAMPLE = 50_000


class _Labeling(NamedTuple):
    """One K-selection's clustering: how it was chosen + its column and labels."""

    label_kind: str  # "kmeans_elbow" | "kmeans_silhouette" (statistics.parquet tag)
    col_name: str  # "cluster_elbow_<proj>" | "cluster_silhouette_<proj>"
    selection_name: str  # "elbow" | "silhouette"
    requested_k: int
    labels: np.ndarray


class ClusterValidityStatistic:
    """Elbow / silhouette auto-clustering + ARI/NMI agreement vs annotations."""

    family = "cluster_validity"
    requires_embedding = False
    embedding_space = False  # projection-only (auto-clustering + agreement)

    def compute(self, ctx: StatContext) -> list:
        X = np.asarray(ctx.coords, dtype=float)
        n = X.shape[0]
        params = ctx.params
        sample_threshold = int(params.get("sample_threshold", DEFAULT_SAMPLE_THRESHOLD))
        selection = str(params.get("cluster_selection", "elbow")).lower()
        # The CLI validates this via a Typer enum; guard the raw stats API too so an
        # unrecognised value falls back to the default rather than silently emitting
        # no labelling at all (best-effort: never drop a projection's whole output).
        if selection not in ("elbow", "silhouette", "both"):
            selection = "elbow"

        res = kmeans_elbow(
            X,
            ids=ctx.ids if len(ctx.ids) == n else None,
            rng_seed=ctx.rng_seed,
            k_max=params.get("k_max"),
            max_fit_sample=int(params.get("max_fit_sample", DEFAULT_MAX_FIT_SAMPLE)),
            silhouette_selection=selection in ("silhouette", "both"),
            silhouette_sample=sample_threshold,
        )
        if res is None:  # n < 3
            return []

        # Which labelling(s) to emit. Each K-selection method is named explicitly
        # (cluster_elbow_<proj> / cluster_silhouette_<proj>) so the column name — the
        # only signal that survives to the frontend — carries the provenance.
        def _elbow_labeling() -> _Labeling:
            return _Labeling(
                "kmeans_elbow",
                f"{CLUSTER_COLUMN_PREFIX}elbow_{ctx.space_name}",
                "elbow",
                res.k,
                res.labels,
            )

        labelings: list[_Labeling] = []
        if selection in ("elbow", "both"):
            labelings.append(_elbow_labeling())
        if selection in ("silhouette", "both") and res.silhouette_labels is not None:
            labelings.append(
                _Labeling(
                    "kmeans_silhouette",
                    f"{CLUSTER_COLUMN_PREFIX}silhouette_{ctx.space_name}",
                    "silhouette",
                    int(res.silhouette_k),
                    res.silhouette_labels,
                )
            )

        # `--cluster-selection silhouette` on a degenerate/coincident projection
        # can leave `silhouette_labels` None (silhouette_score raises for every K),
        # emptying `labelings` — fall back to the elbow clustering (always computed)
        # so the projection still emits membership/agreement rows rather than
        # vanishing silently from the report.
        if not labelings:
            labelings.append(_elbow_labeling())

        out: list = []
        for labeling in labelings:
            out.extend(self._emit_labeling(ctx, X, n, res, labeling))
        return out

    def _emit_labeling(self, ctx, X, n, res, labeling: _Labeling) -> list:
        """Rows + membership column for one labelling (elbow or silhouette-K)."""
        rng_seed = ctx.rng_seed
        params = ctx.params
        label_kind = labeling.label_kind
        col_name = labeling.col_name
        selection_name = labeling.selection_name
        labels = labeling.labels
        k = int(labeling.requested_k)

        # Report the ACHIEVED number of distinct clusters (KMeans can collapse on
        # coincident points), keeping the requested K in extra.
        unique_labels = np.unique(labels)
        achieved = int(len(unique_labels))

        want_per_point = (
            params.get("cluster_annotations", True)
            and achieved >= 2
            and len(ctx.ids) == n
        )

        meta_extra = {
            "requested_k": k,
            "selection": selection_name,
            "k_range": [res.k_range[0], res.k_range[-1]],
            "inertia": res.inertia,
            "seed": rng_seed,
        }
        if selection_name == "elbow":
            meta_extra["knee_confidence"] = res.knee_confidence

        rows: list = [
            StatRow(
                space_kind=ctx.space_kind,
                space_name=ctx.space_name,
                annotation="",
                stat_family=self.family,
                label_kind=label_kind,
                metric="n_clusters",
                metric_kind="meta",
                value=float(achieved),
                extra=meta_extra,
            )
        ]

        # Per-protein membership: a plain categorical `cluster N` label, exactly the
        # shape of a curated annotation. It used to carry each point's own silhouette
        # as a `value|score` confidence, which was the only per-point separation score
        # anywhere in the app; the per-cluster rows emitted below say the same thing on
        # the scale every other annotation is read on, so the point-level value is no
        # longer computed (silhouette_samples is O(n^2) and had to be ceiling-capped).
        if want_per_point:
            labels_by_id = {
                pid: f"cluster {int(lbl)}"
                for pid, lbl in zip(ctx.ids, labels, strict=False)
            }

            rows.append(
                AnnotationColumn(
                    name=col_name,
                    kind="categorical",
                    values=dict(labels_by_id),
                    extra={
                        "projection": ctx.space_name,
                        "selection": selection_name,
                        "k": k,
                        "seed": rng_seed,
                        "computed": True,
                    },
                )
            )

            # How well this clustering separates in the projection it was found in,
            # scored by the very statistic that scores curated annotations, so the
            # frontend reads a cluster column through the same rows as any other
            # annotation (strips, per-row scores, the metadata panel) with no
            # special case. Gated on `want_per_point`: without a membership column
            # the clustering can never be selected in the UI, so its scores would
            # be orphan rows.
            #
            # These are optimistic by construction -- KMeans drew the boundaries
            # being graded, and for `kmeans_silhouette` K was chosen by maximising
            # this very number. The frontend states that caveat; the rows are still
            # worth emitting because the per-category values say which cluster is
            # tight and which is mush, which no aggregate can.
            #
            # `replace` keeps every other context field (coords, ids, seed, params)
            # so the scoring conditions match a real annotation's exactly, including
            # the subsample at DEFAULT_SAMPLE_THRESHOLD. Scoring the same
            # `labels_by_id` the column above was built from means the column and its
            # scores can never describe different labellings.
            rows.extend(
                AnnotationValidityStatistic(label_kind=label_kind).compute(
                    replace(ctx, annotations={col_name: labels_by_id})
                )
            )

        # ARI/NMI: does this auto-clustering recover each annotation? Reuses the
        # KMeans labels already computed (no second sweep). Compared over the
        # id-intersection of clustered points and annotated points.
        if ctx.annotations:
            from sklearn.metrics import (
                adjusted_rand_score,
                normalized_mutual_info_score,
            )

            label_by_id = dict(zip(ctx.ids, labels, strict=False))
            for name, mapping in ctx.annotations.items():
                # ``paired_clu`` holds numpy ints straight from the KMeans labels;
                # sklearn's ARI/NMI accept them as-is (no per-element cast needed).
                paired_clu, paired_ann = pair_by_id(mapping, label_by_id)
                if len(set(paired_ann)) < 2 or len(paired_ann) < 3:
                    continue
                for metric_name, fn in (
                    ("adjusted_rand", adjusted_rand_score),
                    ("normalized_mutual_info", normalized_mutual_info_score),
                ):
                    try:
                        rows.append(
                            StatRow(
                                space_kind=ctx.space_kind,
                                space_name=ctx.space_name,
                                annotation=name,
                                stat_family="cluster_agreement",
                                label_kind=label_kind,
                                metric=metric_name,
                                metric_kind="agreement",
                                value=float(fn(paired_ann, paired_clu)),
                                extra={"seed": rng_seed, "n_labels": len(paired_ann)},
                            )
                        )
                    except Exception:  # noqa: BLE001 - best-effort
                        pass

        return rows
