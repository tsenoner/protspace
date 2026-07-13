"""Lightweight constants and config — no heavy dependencies (sklearn, umap, pacmap).

Import this module freely without triggering numba/pynndescent compilation.
"""

from dataclasses import dataclass, field, fields
from typing import Literal, get_args

# Method name constants
PCA_NAME = "pca"
TSNE_NAME = "tsne"
UMAP_NAME = "umap"
PACMAP_NAME = "pacmap"
MDS_NAME = "mds"
LOCALMAP_NAME = "localmap"

REDUCER_METHODS = [PCA_NAME, TSNE_NAME, UMAP_NAME, PACMAP_NAME, MDS_NAME, LOCALMAP_NAME]

# Metric types
METRIC_TYPES = Literal["euclidean", "cosine"]


@dataclass(frozen=True)
class DimensionReductionConfig:
    """Configuration for dimension reduction methods.

    Parameters:
        n_components: Number of dimensions in reduced space (2 or 3)
        n_neighbors: Number of neighbors for manifold learning (>0)
        metric: Distance metric to use
        precomputed: Whether distances are precomputed
        min_dist: Minimum distance for UMAP (0-1)
        perplexity: Perplexity for t-SNE (5-50)
        learning_rate: Learning rate for t-SNE optimization (>0)
        mn_ratio: Ratio for PaCMAP (0-1)
        fp_ratio: Ratio for PaCMAP (>0)
        n_init: Number of initializations for MDS (>0)
        max_iter: Maximum iterations (>0)
        eps: Convergence tolerance (>0)
        random_state: Random seed for reproducibility (>= 0)
    """

    n_components: int = field(default=2, metadata={"allowed": [2, 3]})
    n_neighbors: int = field(default=15, metadata={"gt": 0})
    metric: METRIC_TYPES = field(
        default="euclidean", metadata={"allowed": list(get_args(METRIC_TYPES))}
    )
    precomputed: bool = field(default=False)
    min_dist: float = field(default=0.1, metadata={"gte": 0, "lte": 1})
    perplexity: int = field(default=30, metadata={"gte": 5, "lte": 50})
    learning_rate: int = field(default=200, metadata={"gt": 0})
    mn_ratio: float = field(default=0.5, metadata={"gte": 0, "lte": 1})
    fp_ratio: float = field(default=2.0, metadata={"gt": 0})
    n_init: int = field(default=4, metadata={"gt": 0})
    max_iter: int = field(default=300, metadata={"gt": 0})
    eps: float = field(default=1e-3, metadata={"gt": 0})
    random_state: int = field(default=42, metadata={"gte": 0})

    def __post_init__(self):
        """Validate configuration parameters."""
        for data_field in fields(self):
            value = getattr(self, data_field.name)
            metadata = data_field.metadata

            if "allowed" in metadata:
                if value not in metadata["allowed"]:
                    raise ValueError(
                        f"{data_field.name} must be one of {metadata['allowed']}"
                    )

            if "gt" in metadata:
                if value <= metadata["gt"]:
                    raise ValueError(
                        f"{data_field.name} must be greater than {metadata['gt']}"
                    )

            if "lt" in metadata:
                if value >= metadata["lt"]:
                    raise ValueError(
                        f"{data_field.name} must be less than {metadata['lt']}"
                    )

            if "gte" in metadata:
                if value < metadata["gte"]:
                    raise ValueError(
                        f"{data_field.name} must be greater than or equal to {metadata['gte']}"
                    )

            if "lte" in metadata:
                if value > metadata["lte"]:
                    raise ValueError(
                        f"{data_field.name} must be less than or equal to {metadata['lte']}"
                    )
