"""Tests for the local (Colab-GPU) embedding backend.

The pure helpers (checkpoint resolution, sequence preprocessing, residue
pooling, header validation) are torch-free and always run. The end-to-end
``embed_sequences`` test needs the optional ``[local]`` extra (torch +
transformers) and downloads a small ESM2 model, so it is marked ``slow``.
"""

import numpy as np
import pytest

from protspace.data.embedding import local
from protspace.data.embedding.biocentral import ALL_SHORT_KEYS

# ---------------------------------------------------------------------------
# resolve_local_checkpoint
# ---------------------------------------------------------------------------


def test_resolve_prot_t5_uses_half_encoder_checkpoint():
    checkpoint, mod_type = local.resolve_local_checkpoint("prot_t5")
    assert checkpoint == "Rostlab/prot_t5_xl_half_uniref50-enc"
    assert mod_type == "prot_t5"


def test_resolve_esmc_uses_synthyra_not_native():
    checkpoint, mod_type = local.resolve_local_checkpoint("esmc_300m")
    assert checkpoint == "Synthyra/ESMplusplus_small"
    assert mod_type == "esmc"


def test_resolve_covers_every_cli_short_key():
    """The local backend must support the same 12 shortcuts as Biocentral."""
    for key in ALL_SHORT_KEYS:
        checkpoint, mod_type = local.resolve_local_checkpoint(key)
        assert checkpoint, f"no checkpoint for {key}"
        assert mod_type in {"prot_t5", "prost_t5", "esm", "ankh", "esmc"}


def test_resolve_unknown_raises_with_suggestion():
    with pytest.raises(ValueError, match="esm2_8m"):
        local.resolve_local_checkpoint("esm2_8")


# ---------------------------------------------------------------------------
# preprocess_sequence
# ---------------------------------------------------------------------------


def test_preprocess_maps_rare_residues_to_x():
    # B, J, O, U, Z -> X; standard residues untouched.
    assert local.preprocess_sequence("ABJOUZ", "esm") == "AXXXXX"


def test_preprocess_t5_inserts_spaces_between_residues():
    assert local.preprocess_sequence("MKV", "prot_t5") == "M K V"


def test_preprocess_prostt5_prefixes_control_token_and_spaces():
    assert local.preprocess_sequence("MKV", "prost_t5") == "<AA2fold> M K V"


def test_preprocess_esm_leaves_sequence_unspaced():
    assert local.preprocess_sequence("MKV", "esm") == "MKV"


def test_preprocess_ankh_leaves_sequence_unspaced():
    assert local.preprocess_sequence("MKV", "ankh") == "MKV"


# ---------------------------------------------------------------------------
# pool_residues
# ---------------------------------------------------------------------------


def test_pool_esm_strips_cls_and_eos_then_means():
    # rows: [CLS, r1, r2, r3, EOS]
    hidden = np.array([[9, 9], [1, 1], [2, 2], [3, 3], [9, 9]], dtype=np.float32)
    pooled = local.pool_residues(hidden, seq_len=5, mod_type="esm")
    np.testing.assert_allclose(pooled, [2, 2])


def test_pool_prot_t5_strips_only_trailing_eos():
    # rows: [r1, r2, r3, EOS]  (T5 has no leading special token)
    hidden = np.array([[1, 1], [2, 2], [3, 3], [9, 9]], dtype=np.float32)
    pooled = local.pool_residues(hidden, seq_len=4, mod_type="prot_t5")
    np.testing.assert_allclose(pooled, [2, 2])


def test_pool_esmc_strips_both_ends_like_esm():
    hidden = np.array([[9, 9], [1, 1], [3, 3], [9, 9]], dtype=np.float32)
    pooled = local.pool_residues(hidden, seq_len=4, mod_type="esmc")
    np.testing.assert_allclose(pooled, [2, 2])


def test_pool_ignores_right_padding_beyond_seq_len():
    # rows: [CLS, r1, r2, EOS, PAD, PAD]; seq_len counts real tokens only.
    hidden = np.array(
        [[9, 9], [1, 1], [3, 3], [9, 9], [0, 0], [0, 0]], dtype=np.float32
    )
    pooled = local.pool_residues(hidden, seq_len=4, mod_type="esm")
    np.testing.assert_allclose(pooled, [2, 2])


def test_pool_returns_float32():
    hidden = np.ones((4, 3), dtype=np.float32)
    assert local.pool_residues(hidden, 4, "esm").dtype == np.float32


# ---------------------------------------------------------------------------
# validate_headers  (HDF5 dataset names cannot contain '/')
# ---------------------------------------------------------------------------


def test_validate_headers_rejects_slash():
    with pytest.raises(ValueError, match="/"):
        local.validate_headers(["P12345", "bad/name"])


def test_validate_headers_accepts_clean_ids():
    local.validate_headers(["P12345", "A0A2P1BSS8"])  # no raise


# ---------------------------------------------------------------------------
# embed_sequences guards (torch-free: return before any model is loaded)
# ---------------------------------------------------------------------------


def test_local_embed_config_rejects_nonpositive_batch_size():
    with pytest.raises(ValueError, match="batch_size"):
        local.LocalEmbedConfig(batch_size=0)


def test_local_embed_config_rejects_nonpositive_max_length():
    with pytest.raises(ValueError, match="max_length"):
        local.LocalEmbedConfig(max_length=0)


def test_embed_sequences_raises_when_all_sequences_dropped(tmp_path):
    """All sequences over max_length → no embeddings → a clear error, not a
    silently-empty/absent .h5 that later crashes load_h5."""
    out = tmp_path / "emb.h5"
    with pytest.raises(ValueError, match="No embeddings"):
        local.embed_sequences(
            {"p1": "MKVLAAGILT"},
            "esm2_8m",
            out,
            local.LocalEmbedConfig(max_length=3),
        )


# ---------------------------------------------------------------------------
# End-to-end (needs [local] extra; downloads esm2_8m ~30 MB)
# ---------------------------------------------------------------------------


@pytest.mark.slow
def test_embed_sequences_esm2_8m_end_to_end(tmp_path):
    pytest.importorskip("torch")
    pytest.importorskip("transformers")
    import h5py

    sequences = {"prot1": "MKVLAAG", "prot2": "MSEQWENCE"}
    out = tmp_path / "emb.h5"

    result = local.embed_sequences(sequences, "esm2_8m", out)

    assert result == out and out.exists()
    with h5py.File(out, "r") as f:
        assert set(f.keys()) == {"prot1", "prot2"}
        vec = f["prot1"][:]
        assert vec.shape == (320,)  # esm2_8m hidden dim
        assert vec.dtype == np.float32
        assert np.isfinite(vec).all()


@pytest.mark.slow
def test_embed_sequences_resumes_and_skips_existing(tmp_path):
    pytest.importorskip("torch")
    pytest.importorskip("transformers")
    import h5py

    sequences = {"prot1": "MKVLAAG"}
    out = tmp_path / "emb.h5"

    local.embed_sequences(sequences, "esm2_8m", out)
    with h5py.File(out, "r") as f:
        first = f["prot1"][:].copy()

    # Second run must not fail and must not alter the existing embedding.
    local.embed_sequences({"prot1": "MKVLAAG", "prot2": "MSEQWENCE"}, "esm2_8m", out)
    with h5py.File(out, "r") as f:
        assert set(f.keys()) == {"prot1", "prot2"}
        np.testing.assert_array_equal(f["prot1"][:], first)
