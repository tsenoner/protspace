"""Benchmarking tools for dimensionality reduction methods.

This package provides tools for benchmarking and evaluating dimensionality
reduction methods, including timing, quality metrics, and comparative analysis.
"""

from protspace.benchmark.harness import (
    BenchmarkResult,
    benchmark_method,
    benchmark_methods,
    normalize_projection,
)
from protspace.benchmark.labels import (
    first_functional_keyword,
    label_summary,
    load_labels_from_bundle,
)
from protspace.benchmark.metrics import (
    AVAILABLE_METRICS,
    calculate_silhouette_score,
    calculate_trustworthiness,
    make_silhouette_metric,
)

__all__ = [
    "AVAILABLE_METRICS",
    "BenchmarkResult",
    "benchmark_method",
    "benchmark_methods",
    "calculate_silhouette_score",
    "calculate_trustworthiness",
    "first_functional_keyword",
    "label_summary",
    "load_labels_from_bundle",
    "make_silhouette_metric",
    "normalize_projection",
]
