# ProtSpace Benchmark Module

Benchmark dimensionality reduction (DR) methods on protein embeddings with timing and quality metrics.

## Quick Start

```bash
# From repo root (install plotting extra once)
uv sync --extra benchmark

# Run benchmark on 3ftx dataset + write projections_3ftx.png
uv run python src/protspace/benchmark/run.py --plot

# Re-render figure only (needs prior results + headers.npy or HDF5)
uv run python src/protspace/benchmark/run.py --plot-only
# equivalent:
uv run python src/protspace/benchmark/visualize.py
```

This will:
- Load embeddings from `output_3ftx/tmp/prot_t5.h5` (full run only)
- Run PCA, UMAP, t-SNE, PaCMAP, MDS, LocalMAP
- Calculate trustworthiness and silhouette (when `data.parquetbundle` exists)
- Save projections to `src/protspace/benchmark/results/3ftx/`
- Save metrics to `metrics.csv`
- With `--plot` or `--plot-only`, save `projections_3ftx.png`

## Python API

```python
from protspace.benchmark import benchmark_methods
from protspace.benchmark.metrics import calculate_trustworthiness
from protspace.data.loaders import load_h5
from protspace.utils.constants import DimensionReductionConfig

# Load embeddings
emb_set = load_h5(["path/to/embeddings.h5"])

# Configure DR
config = DimensionReductionConfig(
    n_components=2,
    random_state=42,
    n_neighbors=15,
    perplexity=30,
)

# Define metrics
metrics = {
    "trustworthiness": calculate_trustworthiness,
}

# Run benchmark
results = benchmark_methods(
    embeddings=emb_set.data,
    methods=["pca", "umap", "tsne"],
    config=config,
    normalize=True,  # Ensure comparable projections
    metric_functions=metrics,
)

# Access results
for method, result in results.items():
    print(f"{method}: {result.time_seconds:.3f}s")
    print(f"  Metrics: {result.metrics}")
```

## Available Methods

- `pca` - Principal Component Analysis
- `tsne` - t-SNE
- `umap` - UMAP
- `pacmap` - PaCMAP
- `mds` - Multidimensional Scaling
- `localmap` - LocalMAP

## Available Metrics

Import from `protspace.benchmark.metrics`:

- `calculate_trustworthiness` - Local neighborhood preservation (k-NN based) ✓ **Implemented**
- `calculate_continuity` - Placeholder (not implemented yet)
- `calculate_silhouette_score` / `make_silhouette_metric` - Silhouette on 2D projection with bundle labels ✓ **Implemented** (see ``run.py``)
- `calculate_knn_preservation` - Placeholder (not implemented yet)

All metrics in `AVAILABLE_METRICS` dictionary. Only use implemented metrics to avoid errors.

## Projection Normalization

When `normalize=True`, projections are made comparable by:
1. Centering at origin
2. Fixing sign ambiguity (positive means for x and y)

This ensures projections from different methods can be directly compared.

## Key Functions

### `benchmark_method(embeddings, method, config=None, normalize=True, metric_functions=None)`

Benchmark a single DR method.

**Returns:** `BenchmarkResult` with:
- `method`: Method name
- `projection`: 2D coordinates (n_samples, 2)
- `time_seconds`: Runtime
- `metrics`: Dict of metric values
- `params`: DR parameters used

### `benchmark_methods(embeddings, methods=None, config=None, normalize=True, metric_functions=None)`

Benchmark multiple methods at once.

**Returns:** `dict[str, BenchmarkResult]`

## Directory Structure

```
src/protspace/benchmark/
├── __init__.py                    # Package exports
├── harness.py                     # Core benchmarking functions
├── metrics.py                     # Quality metrics
├── README.md                      # This file
├── run.py                         # Example benchmark script
└── results/                       # Benchmark outputs (created automatically)
    └── <dataset_name>/            # Results organized by dataset
        ├── pca_projection.npy     # PCA 2D projections
        ├── umap_projection.npy    # UMAP 2D projections
        ├── tsne_projection.npy    # t-SNE 2D projections
        └── metrics.csv            # Benchmark metrics (runtime + quality metrics)
```

## Configuration

Use `DimensionReductionConfig` to customize DR parameters:

```python
from protspace.utils.constants import DimensionReductionConfig

config = DimensionReductionConfig(
    n_components=2,           # 2D or 3D output
    random_state=42,          # Reproducibility
    n_neighbors=15,           # For UMAP, PaCMAP, LocalMAP
    min_dist=0.1,             # UMAP minimum distance
    perplexity=30,            # t-SNE perplexity
    metric="euclidean",       # Distance metric
)
```

## Output Files

### Metrics (`metrics.csv`)
Contains per-method runtime and quality metrics.

## Next Steps

To implement additional metrics, edit `src/protspace/benchmark/metrics.py`:

1. Replace placeholder functions with actual implementations
2. Use sklearn, scipy, or custom implementations
3. Add to `AVAILABLE_METRICS` registry
4. Update function signatures to match pattern: `(embeddings, projection) -> float`
