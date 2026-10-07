"""
Tests for dimensionality reduction methods.

Verifies that all six DR methods (PCA, t-SNE, UMAP, PaCMAP, MDS, LocalMAP)
produce correct output shapes, handle edge cases, and work end-to-end
through the processor pipeline.
"""

import numpy as np
import pytest

from protspace.utils.reducers import (
    DimensionReductionConfig,
    LocalMAPReducer,
    MDSReducer,
    PaCMAPReducer,
    PCAReducer,
    TSNEReducer,
    UMAPReducer,
)

# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

# Deterministic data large enough for all methods (t-SNE needs n > perplexity)
SEED = 42
N_SAMPLES = 50
N_FEATURES = 20


@pytest.fixture
def rng():
    return np.random.default_rng(SEED)


@pytest.fixture
def data(rng):
    """Float32 embeddings shared by the 2- and 3-component tests."""
    return rng.standard_normal((N_SAMPLES, N_FEATURES)).astype(np.float32)


@pytest.fixture
def config_2d():
    return DimensionReductionConfig(n_components=2, random_state=SEED)


@pytest.fixture
def config_3d():
    return DimensionReductionConfig(n_components=3, random_state=SEED)


# ---------------------------------------------------------------------------
# Per-method tests
# ---------------------------------------------------------------------------


class TestPCAReducer:
    def test_output_shape_3d(self, data, config_3d):
        result = PCAReducer(config_3d).fit_transform(data)
        assert result.shape == (N_SAMPLES, 3)

    def test_deterministic(self, data, config_2d):
        r1 = PCAReducer(config_2d).fit_transform(data)
        r2 = PCAReducer(config_2d).fit_transform(data)
        np.testing.assert_array_equal(r1, r2)

    def test_get_params(self, config_2d):
        reducer = PCAReducer(config_2d)
        reducer.fit_transform(np.random.randn(10, 5).astype(np.float32))
        params = reducer.get_params()
        assert params["n_components"] == 2
        assert params["random_state"] == SEED
        assert "explained_variance_ratio" in params


class TestTSNEReducer:
    def test_get_params(self, config_2d):
        params = TSNEReducer(config_2d).get_params()
        assert params["n_components"] == 2
        assert "perplexity" in params


class TestUMAPReducer:
    def test_output_shape_3d(self, data, config_3d):
        result = UMAPReducer(config_3d).fit_transform(data)
        assert result.shape == (N_SAMPLES, 3)

    def test_get_params(self, config_2d):
        params = UMAPReducer(config_2d).get_params()
        assert params["n_components"] == 2
        assert "n_neighbors" in params
        assert "min_dist" in params


class TestPaCMAPReducer:
    def test_get_params(self, config_2d):
        params = PaCMAPReducer(config_2d).get_params()
        assert params["n_components"] == 2
        assert "MN_ratio" in params
        assert "FP_ratio" in params


class TestMDSReducer:
    def test_get_params(self, config_2d):
        params = MDSReducer(config_2d).get_params()
        assert params["n_components"] == 2
        assert "n_init" in params


class TestLocalMAPReducer:
    def test_get_params(self, config_2d):
        params = LocalMAPReducer(config_2d).get_params()
        assert params["n_components"] == 2
        assert "MN_ratio" in params
        assert "FP_ratio" in params


# ---------------------------------------------------------------------------
# Cross-cutting tests
# ---------------------------------------------------------------------------

ALL_REDUCERS = [
    ("pca", PCAReducer),
    ("tsne", TSNEReducer),
    ("umap", UMAPReducer),
    ("pacmap", PaCMAPReducer),
    ("mds", MDSReducer),
    ("localmap", LocalMAPReducer),
]


@pytest.mark.parametrize("name,cls", ALL_REDUCERS, ids=[r[0] for r in ALL_REDUCERS])
class TestAllReducers:
    """Tests that apply to every reducer."""

    def test_fit_returns_finite_float_coordinates(self, name, cls, data, config_2d):
        """One fit per reducer: (n, 2) shape, a float dtype, no NaN or inf."""
        result = cls(config_2d).fit_transform(data)
        assert result.shape == (N_SAMPLES, 2)
        assert result.dtype in (np.float32, np.float64)
        assert np.isfinite(result).all()


class TestFloat16Handling:
    """float16 embeddings are upcast by the processor before any reducer sees them."""

    @pytest.mark.parametrize("name,cls", [("pca", PCAReducer), ("umap", UMAPReducer)])
    def test_processor_upcasts_float16_before_reducing(self, name, cls, rng):
        from protspace.data.processors.base_processor import BaseProcessor

        seen_dtypes = []

        class Recording(cls):
            def fit_transform(self, data):
                seen_dtypes.append(data.dtype)
                return super().fit_transform(data)

        # Small values typical of pLM embeddings stored in float16
        data = (rng.standard_normal((N_SAMPLES, N_FEATURES)) * 0.04).astype(np.float16)
        processor = BaseProcessor({"random_state": SEED}, {name: Recording})

        result = processor.process_reduction(data, name, 2)

        # float16 overflows in the reducers' matrix operations (e.g. sklearn's
        # randomized SVD), so the reducer must only ever see float32.
        assert seen_dtypes == [np.float32]
        assert result["data"].shape == (N_SAMPLES, 2)
        assert np.isfinite(result["data"]).all()


# ---------------------------------------------------------------------------
# DimensionReductionConfig validation
# ---------------------------------------------------------------------------


class TestDimensionReductionConfig:
    def test_default_values(self):
        config = DimensionReductionConfig()
        assert config.n_components == 2
        assert config.metric == "euclidean"
        assert config.random_state == 42

    def test_custom_values(self):
        config = DimensionReductionConfig(
            n_components=3, metric="cosine", n_neighbors=10
        )
        assert config.n_components == 3
        assert config.metric == "cosine"
        assert config.n_neighbors == 10

    def test_invalid_metric_raises(self):
        with pytest.raises(ValueError):
            DimensionReductionConfig(metric="invalid")

    def test_invalid_n_components_raises(self):
        with pytest.raises(ValueError):
            DimensionReductionConfig(n_components=0)

    def test_invalid_perplexity_raises(self):
        with pytest.raises(ValueError):
            DimensionReductionConfig(perplexity=3)  # min is 5


# ---------------------------------------------------------------------------
# End-to-end through BaseProcessor
# ---------------------------------------------------------------------------


class TestProcessorReduction:
    """Test DR methods through the BaseProcessor.process_reduction pipeline."""

    def test_all_methods_through_processor(self, data):
        from protspace.data.processors.base_processor import BaseProcessor
        from protspace.utils import get_reducers

        REDUCERS = get_reducers()

        processor = BaseProcessor({"random_state": SEED}, REDUCERS)

        for method in ["pca", "tsne", "umap", "pacmap", "mds", "localmap"]:
            result = processor.process_reduction(data, method, 2)
            assert result["data"].shape == (N_SAMPLES, 2), f"{method} shape mismatch"
            assert np.isfinite(result["data"]).all(), f"{method} produced non-finite"
            assert result["dimensions"] == 2
            assert isinstance(result["name"], str)
            assert isinstance(result["info"], dict)
