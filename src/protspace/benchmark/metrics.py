"""Quality metrics for dimensionality reduction evaluation.

Each metric follows the harness pattern ``(embeddings, projection) -> float``
so it can be plugged into ``benchmark_methods(metric_functions=...)``.

Two flavours of metric:
- **Geometric metrics** (``calculate_trustworthiness``): only need the
  high-D embeddings and the 2D projection.
- **Label-based metrics** (``calculate_silhouette_score``): also need a
  categorical label per protein. Use the factory ``make_silhouette_metric``
  to bind labels into a closure that matches the harness signature.
"""

from __future__ import annotations

import warnings
from collections.abc import Callable

import numpy as np
from sklearn.manifold import trustworthiness as sklearn_trustworthiness
from sklearn.metrics import silhouette_score as sklearn_silhouette


def calculate_trustworthiness(
    embeddings: np.ndarray, projection: np.ndarray, n_neighbors: int = 15
) -> float:
    """Trustworthiness: how well the local k-NN structure of the
    high-dimensional embeddings is preserved in the 2D projection.

    Range ``[0, 1]``, higher = better. ``1`` = neighbourhoods perfectly
    preserved. Reference: Venna & Kaski, 2001.
    """
    n_samples = embeddings.shape[0]
    if n_samples < 3:
        return float("nan")

    k = min(n_neighbors, n_samples // 2)

    try:
        score = sklearn_trustworthiness(
            X=embeddings, X_embedded=projection, n_neighbors=k, metric="euclidean"
        )
        return float(score)
    except ValueError as e:
        warnings.warn(f"Trustworthiness calculation failed: {e}", stacklevel=2)
        return float("nan")


def calculate_silhouette_score(
    embeddings: np.ndarray,  # noqa: ARG001  # signature kept for harness compat
    projection: np.ndarray,
    labels: np.ndarray | None = None,
    metric: str = "euclidean",
) -> float:
    """Silhouette score on the 2D projection coordinates.

    Measures how well same-label points are clustered together AND
    separated from other-label points in the projection. Range
    ``[-1, 1]``, higher = better.

    Notes
    -----
    The harness signature is ``(embeddings, projection) -> float``, but
    silhouette needs labels. Two ways to use this:

    1. Pass labels directly (only works if you call this function manually):

       >>> calculate_silhouette_score(emb, proj, labels=labels)

    2. Use the factory ``make_silhouette_metric`` to bind labels into a
       closure with the harness-compatible signature:

       >>> metric_fn = make_silhouette_metric(labels)
       >>> benchmark_methods(..., metric_functions={"silhouette": metric_fn})

    Returns ``NaN`` if no labels are provided, fewer than two distinct
    classes survive filtering, or fewer than two points remain.
    """
    if labels is None:
        return float("nan")

    if projection.shape[0] != labels.shape[0]:
        raise ValueError(
            f"projection and labels must have same length, "
            f"got {projection.shape[0]} vs {labels.shape[0]}"
        )

    valid_mask = np.array(
        [
            lbl is not None
            and not (isinstance(lbl, float) and np.isnan(lbl))
            and str(lbl).strip() != ""
            for lbl in labels
        ]
    )
    coords = projection[valid_mask]
    valid_labels = labels[valid_mask]

    if len(coords) < 2 or len(np.unique(valid_labels)) < 2:
        return float("nan")

    return float(
        sklearn_silhouette(coords, valid_labels, metric=metric)
    )


def make_silhouette_metric(
    labels: np.ndarray, metric: str = "euclidean"
) -> Callable[[np.ndarray, np.ndarray], float]:
    """Factory that binds labels into a harness-compatible silhouette metric.

    The returned callable has signature ``(embeddings, projection) -> float``
    so it slots into ``benchmark_methods(metric_functions=...)``. Labels must
    already be aligned with the embedding row order.
    """

    def silhouette_metric(embeddings: np.ndarray, projection: np.ndarray) -> float:
        return calculate_silhouette_score(
            embeddings, projection, labels=labels, metric=metric
        )

    silhouette_metric.__name__ = "silhouette"
    return silhouette_metric


AVAILABLE_METRICS: dict[str, Callable] = {
    "trustworthiness": calculate_trustworthiness,
    "silhouette": calculate_silhouette_score,
}
