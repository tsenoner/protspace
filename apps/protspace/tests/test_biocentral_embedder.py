"""Tests for Biocentral embedding integration."""

import tempfile
from pathlib import Path
from unittest.mock import MagicMock, patch

import numpy as np
import pytest

from src.protspace.data.embedding.biocentral import (
    EXTRA_SHORT_KEYS,
    MODEL_SHORT_KEYS,
    derive_h5_cache_path,
    load_existing_ids,
    resolve_embedder,
    save_embeddings,
)


class TestResolveEmbedder:
    """Test resolve_embedder function."""

    def test_shortcut_resolution(self):
        result = resolve_embedder("esm2_8m")
        assert result == "facebook/esm2_t6_8M_UR50D"

    def test_prot_t5_shortcut(self):
        result = resolve_embedder("prot_t5")
        assert result == "Rostlab/prot_t5_xl_uniref50"

    def test_enum_member_name(self):
        result = resolve_embedder("ProtT5")
        assert result == "Rostlab/prot_t5_xl_uniref50"

    def test_full_value_passthrough(self):
        result = resolve_embedder("facebook/esm2_t6_8M_UR50D")
        assert result == "facebook/esm2_t6_8M_UR50D"

    def test_unknown_name_exits(self):
        with pytest.raises(SystemExit):
            resolve_embedder("totally_unknown_model")

    def test_all_shortcuts_resolve(self):
        """Verify every shortcut in MODEL_SHORT_KEYS resolves without error."""
        for shortcut in MODEL_SHORT_KEYS:
            result = resolve_embedder(shortcut)
            assert isinstance(result, str)
            assert len(result) > 0

    def test_extra_shortcut_ankh_base(self):
        result = resolve_embedder("ankh_base")
        assert result == "ElnaggarLab/ankh-base"

    def test_extra_shortcut_esmc_300m(self):
        result = resolve_embedder("esmc_300m")
        assert result == "Synthyra/ESMplusplus_small"

    def test_extra_shortcut_esm2_35m(self):
        result = resolve_embedder("esm2_35m")
        assert result == "facebook/esm2_t12_35M_UR50D"

    def test_all_extra_shortcuts_resolve(self):
        """Verify every shortcut in EXTRA_SHORT_KEYS resolves without error."""
        for shortcut, expected in EXTRA_SHORT_KEYS.items():
            result = resolve_embedder(shortcut)
            assert result == expected

    def test_extra_full_value_passthrough(self):
        result = resolve_embedder("ElnaggarLab/ankh-base")
        assert result == "ElnaggarLab/ankh-base"


class TestDeriveH5CachePath:
    """Test derive_h5_cache_path function."""

    def test_known_embedder(self):
        result = derive_h5_cache_path(
            Path("/data/seqs.fasta"),
            "facebook/esm2_t6_8M_UR50D",
        )
        assert result == Path("/data/seqs_esm2_8m.h5")

    def test_prot_t5_embedder(self):
        result = derive_h5_cache_path(
            Path("/data/seqs.fasta"),
            "Rostlab/prot_t5_xl_uniref50",
        )
        assert result == Path("/data/seqs_prot_t5.h5")

    def test_extra_embedder_ankh(self):
        result = derive_h5_cache_path(
            Path("/data/seqs.fasta"),
            "ElnaggarLab/ankh-base",
        )
        assert result == Path("/data/seqs_ankh_base.h5")

    def test_extra_embedder_esmc(self):
        result = derive_h5_cache_path(
            Path("/data/seqs.fasta"),
            "Synthyra/ESMplusplus_small",
        )
        assert result == Path("/data/seqs_esmc_300m.h5")

    def test_unknown_embedder_slashes_replaced(self):
        result = derive_h5_cache_path(
            Path("/data/seqs.fasta"),
            "custom/model_v2",
        )
        assert result == Path("/data/seqs_custom_model_v2.h5")


class TestLoadExistingIds:
    """Test load_existing_ids function."""

    def test_nonexistent_file(self):
        result = load_existing_ids(Path("/nonexistent/file.h5"))
        assert result == set()

    def test_existing_file(self):
        import h5py

        with tempfile.NamedTemporaryFile(suffix=".h5", delete=False) as f:
            with h5py.File(f.name, "w") as hf:
                hf.create_dataset("P01308", data=np.array([1.0, 2.0]))
                hf.create_dataset("P01315", data=np.array([3.0, 4.0]))

            result = load_existing_ids(Path(f.name))
            assert result == {"P01308", "P01315"}


class TestSaveEmbeddings:
    """Test save_embeddings function."""

    def test_save_new_embeddings(self):
        import h5py

        with tempfile.NamedTemporaryFile(suffix=".h5", delete=False) as f:
            embeddings = {
                "P01308": np.array([1.0, 2.0, 3.0]),
                "P01315": np.array([4.0, 5.0, 6.0]),
            }
            save_embeddings(Path(f.name), embeddings)

            with h5py.File(f.name, "r") as hf:
                assert set(hf.keys()) == {"P01308", "P01315"}
                np.testing.assert_array_equal(hf["P01308"][:], [1.0, 2.0, 3.0])

    def test_save_skips_existing(self):
        import h5py

        with tempfile.NamedTemporaryFile(suffix=".h5", delete=False) as f:
            # Pre-populate
            with h5py.File(f.name, "w") as hf:
                hf.create_dataset("P01308", data=np.array([1.0, 2.0]))

            # Save with overlap
            save_embeddings(
                Path(f.name),
                {
                    "P01308": np.array([9.0, 9.0]),  # should be skipped
                    "P01315": np.array([3.0, 4.0]),
                },
            )

            with h5py.File(f.name, "r") as hf:
                assert set(hf.keys()) == {"P01308", "P01315"}
                np.testing.assert_array_equal(hf["P01308"][:], [1.0, 2.0])  # unchanged


class TestEmbedSequences:
    """Test embed_sequences orchestrator."""

    def test_all_already_embedded(self):
        """If all sequences exist in HDF5, return immediately."""
        import h5py

        from src.protspace.data.embedding.biocentral import embed_sequences

        with tempfile.NamedTemporaryFile(suffix=".h5", delete=False) as f:
            with h5py.File(f.name, "w") as hf:
                hf.create_dataset("P01308", data=np.array([1.0, 2.0]))

            result = embed_sequences(
                sequences={"P01308": "AAAA"},
                embedder="facebook/esm2_t6_8M_UR50D",
                h5_path=Path(f.name),
            )
            assert result == Path(f.name)

    @patch("src.protspace.data.embedding.biocentral.BiocentralAPI")
    @patch("src.protspace.data.embedding.biocentral.batched")
    def test_embedding_flow(self, mock_batched, mock_api_cls):
        """Test the full embedding flow with mocked API."""
        import h5py

        from src.protspace.data.embedding.biocentral import embed_sequences

        # Setup fake BiocentralAPI
        fake_api = MagicMock()
        fake_api.wait_until_healthy.return_value = fake_api
        mock_api_cls.return_value = fake_api

        # Mock embed result
        fake_result = MagicMock()
        fake_result.to_dict.return_value = {
            "P01308": np.array([1.0, 2.0, 3.0]),
            "P01315": np.array([4.0, 5.0, 6.0]),
        }
        fake_embed_task = MagicMock()
        fake_embed_task.run.return_value = fake_result
        fake_api.embed.return_value = fake_embed_task

        mock_batched.return_value = [["P01308", "P01315"]]

        with tempfile.TemporaryDirectory() as tmpdir:
            h5_path = Path(tmpdir) / "output.h5"

            result = embed_sequences(
                sequences={"P01308": "AAAA", "P01315": "BBBB"},
                embedder="facebook/esm2_t6_8M_UR50D",
                h5_path=h5_path,
            )

            assert result == h5_path

            with h5py.File(h5_path, "r") as hf:
                assert "P01308" in hf
                assert "P01315" in hf

    @patch("src.protspace.data.embedding.biocentral.BiocentralAPI")
    @patch("src.protspace.data.embedding.biocentral.batched")
    def test_deduplication(self, mock_batched, mock_api_cls):
        """Test that duplicate sequences are deduplicated for API calls."""
        import h5py

        from src.protspace.data.embedding.biocentral import embed_sequences

        fake_api = MagicMock()
        fake_api.wait_until_healthy.return_value = fake_api
        mock_api_cls.return_value = fake_api

        fake_result = MagicMock()
        # Only one representative returned (P01308 is the rep for "AAAA")
        fake_result.to_dict.return_value = {
            "P01308": np.array([1.0, 2.0]),
        }
        fake_embed_task = MagicMock()
        fake_embed_task.run.return_value = fake_result
        fake_api.embed.return_value = fake_embed_task

        mock_batched.return_value = [["P01308"]]

        with tempfile.TemporaryDirectory() as tmpdir:
            h5_path = Path(tmpdir) / "output.h5"

            embed_sequences(
                sequences={
                    "P01308": "AAAA",
                    "P01315": "AAAA",  # same sequence
                },
                embedder="facebook/esm2_t6_8M_UR50D",
                h5_path=h5_path,
            )

            # Both IDs should have embeddings (expanded from representative)
            with h5py.File(h5_path, "r") as hf:
                assert "P01308" in hf
                assert "P01315" in hf
                np.testing.assert_array_equal(hf["P01308"][:], hf["P01315"][:])
