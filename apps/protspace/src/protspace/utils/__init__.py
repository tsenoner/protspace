"""ProtSpace utilities — reducers, readers, and annotation styling.

Heavy imports (sklearn, umap, pacmap, pandas, pyarrow) are deferred
to first use to keep CLI startup fast (~50ms).
"""

# Lazy-loaded to avoid importing sklearn/umap/pacmap at CLI startup.
_REDUCERS: dict | None = None


def get_reducers() -> dict:
    """Return the reducer name → class mapping, importing classes on first call."""
    global _REDUCERS
    if _REDUCERS is None:
        from .reducers import (
            LOCALMAP_NAME,
            MDS_NAME,
            PACMAP_NAME,
            PCA_NAME,
            TSNE_NAME,
            UMAP_NAME,
            LocalMAPReducer,
            MDSReducer,
            PaCMAPReducer,
            PCAReducer,
            TSNEReducer,
            UMAPReducer,
        )

        _REDUCERS = {
            PCA_NAME: PCAReducer,
            TSNE_NAME: TSNEReducer,
            UMAP_NAME: UMAPReducer,
            PACMAP_NAME: PaCMAPReducer,
            MDS_NAME: MDSReducer,
            LOCALMAP_NAME: LocalMAPReducer,
        }
    return _REDUCERS


def __getattr__(name: str):
    """Lazy attribute access for readers, reducer constants, and config."""
    # Reader (pulls in pandas/pyarrow)
    if name == "ArrowReader":
        from .arrow_reader import ArrowReader

        return ArrowReader

    # Reducer constants and config (pull in sklearn/umap/pacmap)
    _reducer_attrs = {
        "DimensionReductionConfig",
        "REDUCER_METHODS",
        "PCA_NAME",
        "TSNE_NAME",
        "UMAP_NAME",
        "PACMAP_NAME",
        "MDS_NAME",
        "LOCALMAP_NAME",
        "REDUCERS",
    }
    if name in _reducer_attrs:
        if name == "REDUCERS":
            return get_reducers()
        from . import reducers

        return getattr(reducers, name)

    raise AttributeError(f"module {__name__!r} has no attribute {name!r}")


def __dir__():
    """Expose all lazy attributes for IDE autocomplete and dir()."""
    return [
        "ArrowReader",
        "get_reducers",
        "DimensionReductionConfig",
        "REDUCER_METHODS",
        "REDUCERS",
        "PCA_NAME",
        "TSNE_NAME",
        "UMAP_NAME",
        "PACMAP_NAME",
        "MDS_NAME",
        "LOCALMAP_NAME",
    ]


__all__ = __dir__()
