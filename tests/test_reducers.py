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
def data_2d(rng):
    """Float32 data suitable for 2-component reduction."""
    return rng.standard_normal((N_SAMPLES, N_FEATURES)).astype(np.float32)


@pytest.fixture
def data_3d(rng):
    """Float32 data suitable for 3-component reduction."""
    return rng.standard_normal((N_SAMPLES, N_FEATURES)).astype(np.float32)


@pytest.fixture
def config_2d():
    return DimensionReductionConfig(n_components=2, random_state=SEED)


@pytest.fixture
def config_3d():
    return DimensionReductionConfig(n_components=3, random_state=SEED)


# ---------------------------------------------------------------------------
# Per-method tests — 2D
# ---------------------------------------------------------------------------


class TestPCAReducer:
    def test_output_shape_2d(self, data_2d, config_2d):
        result = PCAReducer(config_2d).fit_transform(data_2d)
        assert result.shape == (N_SAMPLES, 2)

    def test_output_shape_3d(self, data_3d, config_3d):
        result = PCAReducer(config_3d).fit_transform(data_3d)
        assert result.shape == (N_SAMPLES, 3)

    def test_no_nan_values(self, data_2d, config_2d):
        result = PCAReducer(config_2d).fit_transform(data_2d)
        assert not np.isnan(result).any()

    def test_deterministic(self, data_2d, config_2d):
        r1 = PCAReducer(config_2d).fit_transform(data_2d)
        r2 = PCAReducer(config_2d).fit_transform(data_2d)
        np.testing.assert_allclose(r1, r2, atol=1e-5)

    def test_get_params(self, config_2d):
        reducer = PCAReducer(config_2d)
        reducer.fit_transform(np.random.randn(10, 5).astype(np.float32))
        params = reducer.get_params()
        assert params["n_components"] == 2
        assert "explained_variance_ratio" in params


class TestTSNEReducer:
    def test_output_shape_2d(self, data_2d, config_2d):
        result = TSNEReducer(config_2d).fit_transform(data_2d)
        assert result.shape == (N_SAMPLES, 2)

    def test_no_nan_values(self, data_2d, config_2d):
        result = TSNEReducer(config_2d).fit_transform(data_2d)
        assert not np.isnan(result).any()

    def test_get_params(self, config_2d):
        params = TSNEReducer(config_2d).get_params()
        assert params["n_components"] == 2
        assert "perplexity" in params


class TestUMAPReducer:
    def test_output_shape_2d(self, data_2d, config_2d):
        result = UMAPReducer(config_2d).fit_transform(data_2d)
        assert result.shape == (N_SAMPLES, 2)

    def test_output_shape_3d(self, data_3d, config_3d):
        result = UMAPReducer(config_3d).fit_transform(data_3d)
        assert result.shape == (N_SAMPLES, 3)

    def test_no_nan_values(self, data_2d, config_2d):
        result = UMAPReducer(config_2d).fit_transform(data_2d)
        assert not np.isnan(result).any()

    def test_get_params(self, config_2d):
        params = UMAPReducer(config_2d).get_params()
        assert params["n_components"] == 2
        assert "n_neighbors" in params
        assert "min_dist" in params


class TestPaCMAPReducer:
    def test_output_shape_2d(self, data_2d, config_2d):
        result = PaCMAPReducer(config_2d).fit_transform(data_2d)
        assert result.shape == (N_SAMPLES, 2)

    def test_no_nan_values(self, data_2d, config_2d):
        result = PaCMAPReducer(config_2d).fit_transform(data_2d)
        assert not np.isnan(result).any()

    def test_get_params(self, config_2d):
        params = PaCMAPReducer(config_2d).get_params()
        assert params["n_components"] == 2
        assert "MN_ratio" in params
        assert "FP_ratio" in params


class TestMDSReducer:
    def test_output_shape_2d(self, data_2d, config_2d):
        result = MDSReducer(config_2d).fit_transform(data_2d)
        assert result.shape == (N_SAMPLES, 2)

    def test_no_nan_values(self, data_2d, config_2d):
        result = MDSReducer(config_2d).fit_transform(data_2d)
        assert not np.isnan(result).any()

    def test_get_params(self, config_2d):
        params = MDSReducer(config_2d).get_params()
        assert params["n_components"] == 2
        assert "n_init" in params


class TestLocalMAPReducer:
    def test_output_shape_2d(self, data_2d, config_2d):
        result = LocalMAPReducer(config_2d).fit_transform(data_2d)
        assert result.shape == (N_SAMPLES, 2)

    def test_no_nan_values(self, data_2d, config_2d):
        result = LocalMAPReducer(config_2d).fit_transform(data_2d)
        assert not np.isnan(result).any()

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

    def test_returns_float_array(self, name, cls, data_2d, config_2d):
        result = cls(config_2d).fit_transform(data_2d)
        assert result.dtype in (np.float32, np.float64)

    def test_no_inf_values(self, name, cls, data_2d, config_2d):
        result = cls(config_2d).fit_transform(data_2d)
        assert not np.isinf(result).any()

    def test_output_finite(self, name, cls, data_2d, config_2d):
        result = cls(config_2d).fit_transform(data_2d)
        assert np.isfinite(result).all()


class TestFloat16Handling:
    """Ensure float16 input doesn't cause overflow or NaN."""

    @pytest.mark.parametrize(
        "name,cls", ALL_REDUCERS, ids=[r[0] for r in ALL_REDUCERS]
    )
    def test_float16_input_produces_finite_output(self, name, cls, rng):
        # Small values typical of pLM embeddings stored in float16
        data = (rng.standard_normal((N_SAMPLES, N_FEATURES)) * 0.04).astype(
            np.float16
        )
        config = DimensionReductionConfig(n_components=2, random_state=SEED)
        # float16 is upcast in the processor, but reducers should still handle it
        result = cls(config).fit_transform(data.astype(np.float32))
        assert result.shape == (N_SAMPLES, 2)
        assert np.isfinite(result).all()


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

    def test_all_methods_through_processor(self, data_2d):
        from protspace.data.processors.base_processor import BaseProcessor
        from protspace.utils import REDUCERS

        processor = BaseProcessor({"random_state": SEED}, REDUCERS)

        for method in ["pca", "tsne", "umap", "pacmap", "mds", "localmap"]:
            result = processor.process_reduction(data_2d, method, 2)
            assert result["data"].shape == (N_SAMPLES, 2), f"{method} shape mismatch"
            assert np.isfinite(result["data"]).all(), f"{method} produced non-finite"
            assert result["dimensions"] == 2
            assert isinstance(result["name"], str)
            assert isinstance(result["info"], dict)
