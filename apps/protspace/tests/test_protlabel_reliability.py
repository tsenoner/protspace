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


def test_unknown_metric_raises():
    with pytest.raises(ValueError):
        similarity(0.5, "manhattan")


def test_smoke():
    assert math.isfinite(similarity(0.5, "euclidean"))
