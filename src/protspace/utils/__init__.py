from .arrow_reader import ArrowReader
from .json_reader import JsonReader
from .reducers import (
    LOCALMAP_NAME,
    MDS_NAME,
    PACMAP_NAME,
    PCA_NAME,
    REDUCER_METHODS,
    TSNE_NAME,
    UMAP_NAME,
    DimensionReductionConfig,
    LocalMAPReducer,
    MDSReducer,
    PaCMAPReducer,
    PCAReducer,
    TSNEReducer,
    UMAPReducer,
)

# Create a mapping of method names to reducer classes
REDUCERS = {
    PCA_NAME: PCAReducer,
    TSNE_NAME: TSNEReducer,
    UMAP_NAME: UMAPReducer,
    PACMAP_NAME: PaCMAPReducer,
    MDS_NAME: MDSReducer,
    LOCALMAP_NAME: LocalMAPReducer,
}

__all__ = [
    "JsonReader",
    "ArrowReader",
    "REDUCER_METHODS",
    "DimensionReductionConfig",
    "REDUCERS",
]
