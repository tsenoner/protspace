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
    # Alternative K maximising the (sampled) silhouette over the sweep, and its
    # full-coverage labels — populated only when ``silhouette_selection`` is set.
    silhouette_k: int | None = None
    silhouette_labels: np.ndarray | None = None


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
    max_fit_sample: int = 50_000,
    silhouette_selection: bool = False,
    silhouette_sample: int = 5000,
) -> ElbowResult | None:
    """Sweep KMeans over K and pick the elbow via max chord deviation.

    Returns ``None`` when there are too few points to cluster (n < 3).

    Above ``max_fit_sample`` points the per-K fit runs on a deterministic random
    subsample with ``MiniBatchKMeans`` (so sweep cost is bounded independent of n),
    then labels for *all* n points are recovered with a single ``predict`` pass.
    At or below the threshold the full-batch ``KMeans`` is used, so small/medium
    inputs are unchanged.

    When ``silhouette_selection`` is set, the K maximising the (sampled) silhouette
    over the sweep is also returned (``silhouette_k`` / ``silhouette_labels``) as an
    alternative to the elbow K. This costs one silhouette pass per K, so it is
    computed only on request; ``silhouette_sample`` bounds that cost.
    """
    from sklearn.cluster import KMeans, MiniBatchKMeans

    X = np.asarray(X, dtype=float)
    n = X.shape[0]
    if n < 3:
        return None

    if k_max is None:
        k_max = int(round(np.sqrt(n)))
    k_max = max(2, min(k_max, 50, n - 1))
    k_range = list(range(2, k_max + 1))

    # Bound the fit cost: sweep a subsample at large n; keep full-batch below.
    subsample = n > max_fit_sample
    if subsample:
        idx = np.random.default_rng(rng_seed).choice(n, max_fit_sample, replace=False)
        x_fit = X[idx]
    else:
        x_fit = X

    inertia: list[float] = []
    models_by_k: dict[int, object] = {}
    for k in k_range:
        if subsample:
            km = MiniBatchKMeans(
                n_clusters=k, random_state=rng_seed, n_init=3, batch_size=4096
            ).fit(x_fit)
        else:
            km = KMeans(n_clusters=k, random_state=rng_seed, n_init=n_init).fit(x_fit)
        inertia.append(float(km.inertia_))
        models_by_k[k] = km

    def _labels_full(k: int) -> np.ndarray:
        # Full-coverage labels: fitted labels below the threshold, one O(n*k*d)
        # nearest-centroid predict pass when the fit used a subsample.
        km = models_by_k[k]
        return km.predict(X) if subsample else km.labels_

    def _silhouette_k():
        # K maximising the (sampled) silhouette over the sweep, scored on x_fit
        # with each K's fitted labels. Returns (k, full-coverage labels) or (None, None).
        from sklearn.metrics import silhouette_score

        kw = {}
        if x_fit.shape[0] > silhouette_sample:
            kw = {"sample_size": silhouette_sample, "random_state": rng_seed}
        best_k, best_s = None, -np.inf
        for kk in k_range:
            try:
                s = float(silhouette_score(x_fit, models_by_k[kk].labels_, **kw))
            except Exception:  # noqa: BLE001 - a degenerate K is skipped
                continue
            if s > best_s:
                best_s, best_k = s, kk
        if best_k is None:
            return None, None
        return best_k, _labels_full(best_k)

    sil_k, sil_labels = _silhouette_k() if silhouette_selection else (None, None)

    if len(k_range) < 3:
        # Too short to find a chord knee; take the smallest K, flag low confidence.
        k = k_range[0]
        knee_confidence = "low"
    else:
        dev = chord_deviation(np.asarray(inertia, dtype=float))
        k = k_range[int(np.argmax(dev))]
        # With only 3 swept points the chord knee is structurally pinned to the middle
        # K; require a wider sweep before claiming high confidence.
        knee_confidence = (
            "high"
            if len(k_range) >= 4 and float(dev.max()) >= knee_min_deviation
            else "low"
        )

    return ElbowResult(
        k,
        _labels_full(k),
        k_range,
        inertia,
        knee_confidence,
        silhouette_k=sil_k,
        silhouette_labels=sil_labels,
    )
