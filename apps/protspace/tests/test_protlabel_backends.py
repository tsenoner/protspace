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
