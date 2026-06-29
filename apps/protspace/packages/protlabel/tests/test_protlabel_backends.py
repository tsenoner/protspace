"""Tests for protlabel.backends.nearest."""

import numpy as np
import pytest

from protlabel.backends import nearest


def _toy():
    # 3 references on a line; queries close to ref 0 and ref 2
    refs = np.array([[0.0, 0.0], [10.0, 0.0], [20.0, 0.0]], dtype=np.float32)
    queries = np.array([[0.1, 0.0], [19.5, 0.0]], dtype=np.float32)
    return queries, refs


def test_returns_shapes():
    queries, refs = _toy()
    idx, dist = nearest(queries, refs, k=2, metric="euclidean")
    assert idx.shape == (2, 2)
    assert dist.shape == (2, 2)


def test_nearest_index_euclidean():
    queries, refs = _toy()
    idx, dist = nearest(queries, refs, k=1, metric="euclidean")
    assert idx[0, 0] == 0  # first query nearest to ref 0
    assert idx[1, 0] == 2  # second query nearest to ref 2
    assert dist[0, 0] == pytest.approx(0.1, abs=1e-4)


def test_neighbours_sorted_by_distance():
    queries, refs = _toy()
    idx, dist = nearest(queries, refs, k=3, metric="euclidean")
    assert np.all(np.diff(dist, axis=1) >= -1e-6)  # non-decreasing per row


def test_cosine_metric_runs_and_orders():
    refs = np.array([[1.0, 0.0], [0.0, 1.0]], dtype=np.float32)
    queries = np.array([[1.0, 0.1]], dtype=np.float32)  # closest in angle to ref 0
    idx, dist = nearest(queries, refs, k=1, metric="cosine")
    assert idx[0, 0] == 0


def test_k_capped_to_num_refs():
    queries, refs = _toy()
    idx, dist = nearest(queries, refs, k=10, metric="euclidean")
    assert idx.shape == (2, 3)  # only 3 refs available
    assert np.all(np.diff(dist, axis=1) >= -1e-6)
    assert idx[0, 0] == 0 and idx[1, 0] == 2


def test_chunking_matches_unchunked():
    rng = np.random.default_rng(0)
    refs = rng.standard_normal((50, 8)).astype(np.float32)
    queries = rng.standard_normal((7, 8)).astype(np.float32)
    a_idx, a_dist = nearest(queries, refs, k=3, metric="euclidean", chunk=1000)
    b_idx, b_dist = nearest(queries, refs, k=3, metric="euclidean", chunk=3)
    assert np.array_equal(a_idx, b_idx)
    assert np.allclose(a_dist, b_dist, atol=1e-5)


def test_unknown_metric_raises():
    queries, refs = _toy()
    with pytest.raises(ValueError):
        nearest(queries, refs, k=1, metric="manhattan")


def test_tiny_memory_budget_matches_default():
    rng = np.random.default_rng(1)
    refs = rng.standard_normal((40, 6)).astype(np.float32)
    queries = rng.standard_normal((9, 6)).astype(np.float32)
    a_idx, a_dist = nearest(queries, refs, k=3, metric="euclidean")
    b_idx, b_dist = nearest(queries, refs, k=3, metric="euclidean", max_block_bytes=1)
    assert np.array_equal(a_idx, b_idx)
    assert np.allclose(a_dist, b_dist, atol=1e-5)


def test_k_less_than_one_raises():
    queries, refs = _toy()
    with pytest.raises(ValueError):
        nearest(queries, refs, k=0, metric="euclidean")


def test_cosine_zero_vector_query_is_finite():
    # A zero-magnitude query must not produce NaN cosine distances (scipy.cdist
    # returns NaN here); the result must stay finite and deterministic.
    refs = np.array([[1.0, 0.0], [0.0, 1.0]], dtype=np.float32)
    queries = np.array([[0.0, 0.0]], dtype=np.float32)
    idx, dist = nearest(queries, refs, k=2, metric="cosine")
    assert idx.shape == (1, 2)
    assert np.all(np.isfinite(dist))


def test_cosine_zero_vector_reference_is_finite():
    # A zero-magnitude reference must not poison the distance block with NaN.
    refs = np.array([[0.0, 0.0], [0.0, 1.0]], dtype=np.float32)
    queries = np.array([[1.0, 0.1]], dtype=np.float32)
    idx, dist = nearest(queries, refs, k=2, metric="cosine")
    assert np.all(np.isfinite(dist))


def test_euclidean_matches_reference_distances():
    # The (BLAS) euclidean path must agree with a direct distance computation.
    rng = np.random.default_rng(7)
    refs = rng.standard_normal((30, 12)).astype(np.float32)
    queries = rng.standard_normal((5, 12)).astype(np.float32)
    idx, dist = nearest(queries, refs, k=4, metric="euclidean")
    for qi in range(queries.shape[0]):
        full = np.linalg.norm(refs - queries[qi], axis=1)
        expected = np.sort(full)[:4]
        assert np.allclose(dist[qi], expected, atol=1e-4)


def test_euclidean_precise_for_near_identical_high_dim():
    # Near-identical high-dimensional vectors are the catastrophic-cancellation
    # regime for the GEMM expansion; the reported distance must stay precise
    # (not collapse to 0) by matching a direct float64 norm.
    rng = np.random.default_rng(3)
    base = rng.standard_normal(1024).astype(np.float32)
    other = rng.standard_normal(1024).astype(np.float32)
    refs = np.stack([base, base + np.float32(1e-3), other])
    query = (base + np.float32(2e-4))[None, :]
    idx, dist = nearest(query, refs, k=2, metric="euclidean")
    assert idx[0, 0] == 0  # nearest is the near-duplicate of base
    expected = np.linalg.norm(refs[0].astype(np.float64) - query[0].astype(np.float64))
    assert dist[0, 0] > 0.0  # not clipped to zero
    assert dist[0, 0] == pytest.approx(expected, rel=1e-3)


def test_cosine_matches_reference_distances():
    rng = np.random.default_rng(8)
    refs = rng.standard_normal((25, 10)).astype(np.float32)
    queries = rng.standard_normal((4, 10)).astype(np.float32)
    idx, dist = nearest(queries, refs, k=3, metric="cosine")
    rn = refs / np.linalg.norm(refs, axis=1, keepdims=True)
    for qi in range(queries.shape[0]):
        qn = queries[qi] / np.linalg.norm(queries[qi])
        full = 1.0 - rn @ qn
        expected = np.sort(full)[:3]
        assert np.allclose(dist[qi], expected, atol=1e-4)
