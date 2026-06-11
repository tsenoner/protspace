"""Embedding annotation transfer: kNN -> reliability index -> transferred label.

Implements the goPredSim aggregation (Littmann et al. 2021, Eq. 5):
    RI(p) = (1/k) * sum over neighbours carrying label p of similarity(d).
The transferred label is argmax RI(p); its source is the nearest neighbour
carrying that label.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np

from protlabel.backends import nearest
from protlabel.reliability import similarity


@dataclass(frozen=True)
class Prediction:
    """One transferred annotation for a query protein."""

    query_id: str
    label: str
    source_id: str
    distance: float
    reliability: float
    k: int
    metric: str


def eat(
    query_emb: np.ndarray,
    query_ids: list[str],
    ref_emb: np.ndarray,
    ref_ids: list[str],
    ref_labels: list[str],
    *,
    k: int = 1,
    metric: str = "euclidean",
) -> list[Prediction]:
    """Transfer the best-guess label to each query from its k nearest references."""
    if not (len(ref_ids) == len(ref_labels) == ref_emb.shape[0]):
        raise ValueError("ref_emb, ref_ids and ref_labels must have equal length")
    if ref_emb.shape[0] == 0:
        raise ValueError("No reference embeddings to transfer from")
    if len(query_ids) != query_emb.shape[0]:
        raise ValueError("query_emb and query_ids must have equal length")

    idx, dist = nearest(query_emb, ref_emb, k=k, metric=metric)
    eff_k = idx.shape[1]
    predictions: list[Prediction] = []

    for qi, query_id in enumerate(query_ids):
        neigh_idx = idx[qi]
        neigh_dist = dist[qi]
        # Accumulate RI per label and track the nearest source per label.
        ri_by_label: dict[str, float] = {}
        nearest_src: dict[str, tuple[float, str]] = {}
        for j, ref_i in enumerate(neigh_idx):
            lab = ref_labels[ref_i]
            d = float(neigh_dist[j])
            ri_by_label[lab] = ri_by_label.get(lab, 0.0) + similarity(d, metric)
            if lab not in nearest_src or d < nearest_src[lab][0]:
                nearest_src[lab] = (d, ref_ids[ref_i])
        # Normalise by k (the goPredSim 1/k term).
        # Tie-break: max() over the insertion-ordered dict returns the first label
        # seen while iterating neighbours (which are in ascending distance order),
        # so for distinct distances the nearest neighbour's label wins a tie.
        best_label = max(ri_by_label, key=lambda p: ri_by_label[p])
        ri = ri_by_label[best_label] / eff_k
        src_dist, src_id = nearest_src[best_label]
        predictions.append(
            Prediction(
                query_id=query_id,
                label=best_label,
                source_id=src_id,
                distance=src_dist,
                reliability=ri,
                k=eff_k,
                metric=metric,
            )
        )

    return predictions
