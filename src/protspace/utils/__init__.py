from .json_reader import JsonReader
from .arrow_reader import ArrowReader
from .reducers import (
    REDUCER_METHODS,
    DimensionReductionConfig,
    PCAReducer,
    TSNEReducer,
    UMAPReducer,
    PaCMAPReducer,
    MDSReducer,
    LocalMAPReducer,
    PCA_NAME,
    TSNE_NAME,
    UMAP_NAME,
    PACMAP_NAME,
    MDS_NAME,
    LOCALMAP_NAME,
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
