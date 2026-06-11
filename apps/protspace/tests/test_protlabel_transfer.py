"""Tests for protlabel.transfer."""

import numpy as np
import pytest

from protlabel.transfer import Prediction, eat


def _setup():
    ref_emb = np.array([[0.0, 0.0], [10.0, 0.0], [20.0, 0.0]], dtype=np.float32)
    ref_ids = ["R0", "R1", "R2"]
    ref_labels = ["toxin", "enzyme", "toxin"]
    query_emb = np.array([[0.0, 0.0], [19.7, 0.0]], dtype=np.float32)
    query_ids = ["Q0", "Q1"]
    return ref_emb, ref_ids, ref_labels, query_emb, query_ids


def test_k1_transfers_nearest_label_and_source():
    ref_emb, ref_ids, ref_labels, query_emb, query_ids = _setup()
    preds = eat(query_emb, query_ids, ref_emb, ref_ids, ref_labels, k=1)
    assert isinstance(preds[0], Prediction)
    assert preds[0].query_id == "Q0"
    assert preds[0].label == "toxin"
    assert preds[0].source_id == "R0"
    assert preds[0].reliability == pytest.approx(1.0)  # distance 0 -> RI 1.0


def test_k1_reliability_uses_gopredsim_transform():
    ref_emb, ref_ids, ref_labels, query_emb, query_ids = _setup()
    preds = eat(query_emb, query_ids, ref_emb, ref_ids, ref_labels, k=1)
    # Q1 distance to R2 is 0.3 -> RI = 0.5/(0.5+0.3)
    assert preds[1].label == "toxin"
    assert preds[1].source_id == "R2"
    assert preds[1].reliability == pytest.approx(0.5 / 0.8, abs=1e-4)


def test_k3_vote_picks_majority_label():
    # Query equidistant-ish but two of three nearest are "toxin"
    ref_emb = np.array(
        [[0.0, 0.0], [1.0, 0.0], [2.0, 0.0], [3.0, 0.0]], dtype=np.float32
    )
    ref_ids = ["R0", "R1", "R2", "R3"]
    ref_labels = ["toxin", "enzyme", "toxin", "toxin"]
    query_emb = np.array([[1.4, 0.0]], dtype=np.float32)
    preds = eat(query_emb, ["Q"], ref_emb, ref_ids, ref_labels, k=3)
    assert preds[0].label == "toxin"  # toxin RI sum beats lone enzyme neighbour
    assert 0.0 < preds[0].reliability <= 1.0


def test_cosine_metric():
    ref_emb = np.array([[1.0, 0.0], [0.0, 1.0]], dtype=np.float32)
    preds = eat(
        np.array([[1.0, 0.05]], dtype=np.float32),
        ["Q"],
        ref_emb,
        ["R0", "R1"],
        ["a", "b"],
        k=1,
        metric="cosine",
    )
    assert preds[0].label == "a"


def test_length_mismatch_raises():
    ref_emb, ref_ids, ref_labels, query_emb, query_ids = _setup()
    with pytest.raises(ValueError):
        eat(query_emb, query_ids, ref_emb, ref_ids, ref_labels[:-1], k=1)


def test_empty_references_raises():
    with pytest.raises(ValueError):
        eat(
            np.zeros((1, 2), dtype=np.float32),
            ["Q"],
            np.zeros((0, 2), dtype=np.float32),
            [],
            [],
            k=1,
        )


def test_source_is_nearest_neighbour_with_winning_label():
    # Two neighbours share the winning label at distinct distances; the source
    # must be the closer one.
    ref_emb = np.array([[0.0, 0.0], [0.5, 0.0], [10.0, 0.0]], dtype=np.float32)
    ref_ids = ["R_far", "R_near", "R_other"]
    ref_labels = ["toxin", "toxin", "enzyme"]
    query_emb = np.array([[0.4, 0.0]], dtype=np.float32)  # R_near at 0.1, R_far at 0.4
    preds = eat(query_emb, ["Q"], ref_emb, ref_ids, ref_labels, k=2)
    assert preds[0].label == "toxin"
    assert preds[0].source_id == "R_near"
