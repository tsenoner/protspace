"""Benchmarking harness for dimensionality reduction methods.

This module provides functionality to benchmark different DR methods on embedding datasets,
including timing, quality metrics, and projection normalization for comparability.
"""

import logging
import time
from dataclasses import dataclass
from typing import Any

import numpy as np

from protspace.utils.constants import (
    LOCALMAP_NAME,
    MDS_NAME,
    PACMAP_NAME,
    PCA_NAME,
    REDUCER_METHODS,
    TSNE_NAME,
    UMAP_NAME,
    DimensionReductionConfig,
)
from protspace.utils.reducers import (
    DimensionReducer,
    LocalMAPReducer,
    MDSReducer,
    PaCMAPReducer,
    PCAReducer,
    TSNEReducer,
    UMAPReducer,
)

logger = logging.getLogger(__name__)


@dataclass
class BenchmarkResult:
    """Results from benchmarking a single DR method.

    Attributes:
        method: Name of the DR method used
        projection: 2D projection array (n_samples, 2)
        time_seconds: Time taken to run fit_transform in seconds
        params: Parameters used for the method
        metrics: Dictionary of quality metrics
    """

    method: str
    projection: np.ndarray
    time_seconds: float
    params: dict[str, Any]
    metrics: dict[str, float]


def _get_reducer_class(method: str) -> type[DimensionReducer]:
    """Map method name to reducer class.

    Args:
        method: Name of the DR method

    Returns:
        Reducer class for the specified method

    Raises:
        ValueError: If method is not recognized
    """
    reducer_map = {
        PCA_NAME: PCAReducer,
        TSNE_NAME: TSNEReducer,
        UMAP_NAME: UMAPReducer,
        PACMAP_NAME: PaCMAPReducer,
        MDS_NAME: MDSReducer,
        LOCALMAP_NAME: LocalMAPReducer,
    }

    if method not in reducer_map:
        raise ValueError(
            f"Unknown method '{method}'. Must be one of: {REDUCER_METHODS}"
        )

    return reducer_map[method]


def normalize_projection(projection: np.ndarray) -> np.ndarray:
    """Normalize projection for comparability across methods and runs.

    Applies deterministic orientation conventions:
    1. Center the projection at origin
    2. Scale to unit variance
    3. Orient first principal component along positive x-axis
    4. Orient second principal component to positive y-axis quadrant

    Args:
        projection: Input projection array (n_samples, 2)

    Returns:
        Normalized projection array (n_samples, 2)
    """
    # Center at origin
    centered = projection - projection.mean(axis=0)

    # Scale to unit variance
    std = centered.std()
    if std > 1e-10:  # Avoid division by zero
        scaled = centered / std
    else:
        scaled = centered

    # Compute PCA to get principal axes
    cov = np.cov(scaled.T)
    eigenvalues, eigenvectors = np.linalg.eig(cov)

    # Sort by eigenvalue magnitude
    idx = eigenvalues.argsort()[::-1]
    eigenvectors = eigenvectors[:, idx]

    # Ensure first PC points in positive x direction
    if eigenvectors[0, 0] < 0:
        eigenvectors[:, 0] *= -1

    # Ensure second PC points in positive y direction
    if eigenvectors[1, 1] < 0:
        eigenvectors[:, 1] *= -1

    # Project onto normalized principal axes
    normalized = scaled @ eigenvectors

    return normalized


def benchmark_method(
    embeddings: np.ndarray,
    method: str,
    config: DimensionReductionConfig | None = None,
    normalize: bool = True,
    metric_functions: dict[str, callable] | None = None,
) -> BenchmarkResult:
    """Benchmark a single DR method on the given embeddings.

    Args:
        embeddings: High-dimensional embeddings (n_samples, n_features)
        method: Name of the DR method to benchmark
        config: Configuration for the DR method. If None, uses defaults.
        normalize: Whether to normalize the projection for comparability
        metric_functions: Dictionary of metric name -> metric function.
            Each function should accept (embeddings, projection) and return a float.
            If None, no metrics are calculated.

    Returns:
        BenchmarkResult containing projection, timing, and metrics

    Raises:
        ValueError: If method is not recognized
    """
    if config is None:
        config = DimensionReductionConfig()

    # Get the appropriate reducer class
    reducer_class = _get_reducer_class(method)
    reducer = reducer_class(config)

    # Time the fit_transform
    logger.info(f"Running {method} on {embeddings.shape[0]} samples...")
    start_time = time.perf_counter()

    raw_projection = reducer.fit_transform(embeddings)

    elapsed_time = time.perf_counter() - start_time
    logger.info(f"{method} completed in {elapsed_time:.2f} seconds")

    # Calculate metrics using RAW projection (before normalization)
    metrics = {}
    if metric_functions:
        for metric_name, metric_func in metric_functions.items():
            try:
                metric_value = metric_func(embeddings, raw_projection)
                metrics[metric_name] = float(metric_value)
            except Exception as e:
                logger.warning(f"Failed to calculate metric '{metric_name}': {e}")
                metrics[metric_name] = np.nan

    # Normalize for output/visualization if requested
    if normalize:
        projection = normalize_projection(raw_projection)
    else:
        projection = raw_projection

    # Get parameters used
    params = reducer.get_params()

    return BenchmarkResult(
        method=method,
        projection=projection,
        time_seconds=elapsed_time,
        params=params,
        metrics=metrics,
    )


def benchmark_methods(
    embeddings: np.ndarray,
    methods: list[str] | None = None,
    config: DimensionReductionConfig | None = None,
    normalize: bool = True,
    metric_functions: dict[str, callable] | None = None,
) -> dict[str, BenchmarkResult]:
    """Benchmark multiple DR methods on the same embeddings.

    Args:
        embeddings: High-dimensional embeddings (n_samples, n_features)
        methods: List of DR methods to benchmark. If None, benchmarks all methods.
        config: Configuration for the DR methods. If None, uses defaults.
        normalize: Whether to normalize projections for comparability
        metric_functions: Dictionary of metric name -> metric function.
            Each function should accept (embeddings, projection) and return a float.
            If None, no metrics are calculated.

    Returns:
        Dictionary mapping method names to BenchmarkResult objects

    Raises:
        ValueError: If any method is not recognized
    """
    if methods is None:
        methods = REDUCER_METHODS.copy()

    if config is None:
        config = DimensionReductionConfig()

    results = {}

    logger.info(
        f"Benchmarking {len(methods)} methods on embeddings shape {embeddings.shape}"
    )

    for method in methods:
        try:
            result = benchmark_method(
                embeddings, method, config, normalize, metric_functions
            )
            results[method] = result
        except Exception as e:
            logger.error(f"Failed to benchmark {method}: {e}")
            # Continue with other methods even if one fails

    logger.info(
        f"Benchmarking complete. Successfully ran {len(results)}/{len(methods)} methods"
    )

    return results
