"""Tests for protlabel.lookup.Lookup (the rebuildable sidecar)."""

import numpy as np

from protlabel import Lookup, Prediction


def _lookup():
    emb = np.array([[0.0, 0.0], [10.0, 0.0]], dtype=np.float32)
    return Lookup(embeddings=emb, ids=["R0", "R1"], labels=["a", "b"])


def test_query_returns_predictions():
    lk = _lookup()
    preds = lk.query(np.array([[0.2, 0.0]], dtype=np.float32), ["Q0"], k=1)
    assert isinstance(preds[0], Prediction)
    assert preds[0].label == "a"
    assert preds[0].source_id == "R0"


def test_save_load_roundtrip(tmp_path):
    lk = _lookup()
    path = tmp_path / "lookup.npz"
    lk.save(path)
    assert path.exists()
    loaded = Lookup.load(path)
    assert loaded.ids == lk.ids
    assert loaded.labels == lk.labels
    assert loaded.metric == lk.metric
    assert np.allclose(loaded.embeddings, lk.embeddings)


def test_save_load_preserves_float32_values_exactly(tmp_path):
    # Non-power-of-2 values would be corrupted by a float16 round-trip; the
    # sidecar must preserve the float32 embeddings exactly.
    emb = np.array([[0.123456, 1.9876543], [3.14159, 2.71828]], dtype=np.float32)
    lk = Lookup(embeddings=emb, ids=["P1", "P2"], labels=["x", "y"])
    path = tmp_path / "lk.npz"
    lk.save(path)
    loaded = Lookup.load(path)
    assert loaded.embeddings.dtype == np.float32
    assert np.array_equal(loaded.embeddings, emb)


def test_save_uses_no_object_arrays(tmp_path):
    # ids/labels must be stored as plain unicode (not pickled object arrays), so
    # the sidecar can be loaded with allow_pickle=False (no RCE surface).
    lk = Lookup(embeddings=_lookup().embeddings, ids=["R0", "R1"], labels=["a", "b"])
    path = tmp_path / "lk.npz"
    lk.save(path)
    with np.load(path, allow_pickle=False) as data:
        assert data["ids"].dtype != object
        assert data["labels"].dtype != object
        assert list(data["ids"]) == ["R0", "R1"]
        assert list(data["labels"]) == ["a", "b"]


def test_loaded_lookup_queries_identically(tmp_path):
    lk = _lookup()
    q = np.array([[9.8, 0.0]], dtype=np.float32)
    before = lk.query(q, ["Q"], k=1)
    path = tmp_path / "lk.npz"
    lk.save(path)
    after = Lookup.load(path).query(q, ["Q"], k=1)
    assert before[0].label == after[0].label == "b"
    assert before[0].reliability == after[0].reliability
