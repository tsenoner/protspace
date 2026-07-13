"""Tests for protlabel.reliability."""

import math

import pytest

from protlabel.reliability import similarity


def test_euclidean_at_zero_distance_is_one():
    assert similarity(0.0, "euclidean") == pytest.approx(1.0)


def test_euclidean_at_half_distance_is_half():
    assert similarity(0.5, "euclidean") == pytest.approx(0.5)


def test_euclidean_decreases_to_zero():
    assert similarity(1e9, "euclidean") == pytest.approx(0.0, abs=1e-6)


def test_cosine_is_one_minus_distance():
    assert similarity(0.2, "cosine") == pytest.approx(0.8)


def test_cosine_clamped_to_unit_interval():
    # cosine distance can be up to 2.0 -> 1 - d would go negative; clamp at 0
    assert similarity(1.7, "cosine") == pytest.approx(0.0)
    assert similarity(-0.1, "cosine") == pytest.approx(1.0)


def test_euclidean_clamped_for_negative_distance():
    # A (spurious) negative distance must not push similarity above 1.0; it is
    # treated as distance 0 -> maximum similarity. Similarity is always in [0, 1].
    s = similarity(-0.25, "euclidean")
    assert 0.0 <= s <= 1.0
    assert s == pytest.approx(1.0)


def test_non_finite_distance_is_zero_confidence():
    # A non-finite distance (NaN/inf) is an invalid neighbour distance; it must
    # map to 0.0 (lowest confidence) for BOTH metrics, never a spuriously high
    # confidence. (Previously euclidean returned 1.0 for NaN.)
    for metric in ("euclidean", "cosine"):
        assert similarity(float("nan"), metric) == 0.0
        assert similarity(float("inf"), metric) == 0.0


def test_unknown_metric_raises():
    with pytest.raises(ValueError):
        similarity(0.5, "manhattan")


def test_smoke():
    assert math.isfinite(similarity(0.5, "euclidean"))
