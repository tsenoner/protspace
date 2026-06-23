"""KMeans + distance-to-chord elbow for choosing the cluster count.

The knee selection reuses the distance-to-chord geometry from the
``ProtSpaceExtractor`` prototype: the elbow is the index of maximum perpendicular
deviation of the (normalised) inertia curve from its first-to-last chord. We take
the chord-deviation *index* and map it to K — not the prototype's returned curve
y-value (which was a distance cutoff). The prototype's median-jump term is
intentionally not used (it targets sorted-distance distributions, not an inertia
curve).

scikit-learn imports are function-local to keep CLI startup fast.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np


@dataclass
class ElbowResult:
    k: int
    labels: np.ndarray
    k_range: list[int]
    inertia: list[float]
    knee_confidence: str  # "high" | "low"
    silhouette_optimal_k: int | None


def chord_deviation(y: np.ndarray) -> np.ndarray:
    """Perpendicular deviation of each point of a curve from its end-to-end chord.

    The curve is normalised (x in [0, 1], y in [0, 1]) so the geometry is scale
    free. Returns an array the same length as ``y``.
    """
    y = np.asarray(y, dtype=float)
    n = len(y)
    if n < 3:
        return np.zeros(n)
    x = np.linspace(0.0, 1.0, n)
    span = max(float(y.max() - y.min()), 1e-12)
    yn = (y - y.min()) / span
    x1, y1 = 0.0, float(yn[0])
    x2, y2 = 1.0, float(yn[-1])
    denom = max(float(np.hypot(x2 - x1, y2 - y1)), 1e-12)
    return np.abs((y2 - y1) * x - (x2 - x1) * yn + (x2 * y1 - y2 * x1)) / denom


def kmeans_elbow(
    X: np.ndarray,
    *,
    rng_seed: int = 42,
    k_max: int | None = None,
    n_init: int = 10,
    knee_min_deviation: float = 0.05,
    silhouette_sample: int = 2000,
) -> ElbowResult | None:
    """Sweep KMeans over K and pick the elbow via max chord deviation.

    Returns ``None`` when there are too few points to cluster (n < 3).
    ``silhouette_sample`` bounds the cost of the silhouette-optimal-K cross-check.
    """
    from sklearn.cluster import KMeans
    from sklearn.metrics import silhouette_score

    X = np.asarray(X, dtype=float)
    n = X.shape[0]
    if n < 3:
        return None

    if k_max is None:
        k_max = int(round(np.sqrt(n)))
    k_max = max(2, min(k_max, 50, n - 1))
    k_range = list(range(2, k_max + 1))

    inertia: list[float] = []
    labels_by_k: dict[int, np.ndarray] = {}
    for k in k_range:
        km = KMeans(n_clusters=k, random_state=rng_seed, n_init=n_init).fit(X)
        inertia.append(float(km.inertia_))
        labels_by_k[k] = km.labels_

    if len(k_range) < 3:
        # Too short to find a chord knee; take the smallest K, flag low confidence.
        k = k_range[0]
        return ElbowResult(k, labels_by_k[k], k_range, inertia, "low", None)

    dev = chord_deviation(np.asarray(inertia, dtype=float))
    k_idx = int(np.argmax(dev))
    k = k_range[k_idx]
    # With only 3 swept points the chord knee is structurally pinned to the middle
    # K; require a wider sweep before claiming high confidence.
    knee_confidence = (
        "high" if len(k_range) >= 4 and float(dev.max()) >= knee_min_deviation else "low"
    )

    # Silhouette-optimal K over the sweep, for cross-checking (bounded by sampling).
    sil_kwargs = {}
    if n > silhouette_sample:
        sil_kwargs = {"sample_size": silhouette_sample, "random_state": rng_seed}
    silhouette_optimal_k: int | None = None
    best_sil = -np.inf
    for kk in k_range:
        try:
            s = float(silhouette_score(X, labels_by_k[kk], **sil_kwargs))
        except Exception:
            continue
        if s > best_sil:
            best_sil = s
            silhouette_optimal_k = kk

    return ElbowResult(
        k, labels_by_k[k], k_range, inertia, knee_confidence, silhouette_optimal_k
    )
