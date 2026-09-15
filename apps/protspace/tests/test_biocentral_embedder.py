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


class TestEmbedSequencesCompleteness:
    """An incomplete embedding must raise, and the bar must not claim 100%.

    Every scenario below exits 0 with a full progress bar on the pre-fix code,
    which is how a 0/832 run was mistaken for an 832/832 one.
    """

    N = 6  # 3 batches of 2 with batch_size=2

    @staticmethod
    def _fake_api(to_dict=None, *, result_none=False, exc=None):
        from unittest.mock import MagicMock

        api = MagicMock()
        api.wait_until_healthy.return_value = api

        def embed(embedder_name, sequence_data, reduce):
            task = MagicMock()
            if exc is not None:
                task.run.side_effect = exc
            elif result_none:
                task.run.return_value = None
            else:
                result = MagicMock()
                result.to_dict.return_value = to_dict(sequence_data)
                task.run.return_value = result
            return task

        api.embed.side_effect = embed
        return api

    def _run(self, monkeypatch, tmp_path, **api_kwargs):
        """Drive embed_sequences against a stubbed API; return (h5_path, bar)."""
        from src.protspace.data.embedding import biocentral as bc

        seqs = {f"P{i:04d}": "A" * (10 + i) for i in range(self.N)}
        bar = {}
        real_tqdm = bc.tqdm

        class Bar(real_tqdm):
            def close(self):
                bar["n"], bar["total"] = self.n, self.total
                super().close()

        monkeypatch.setattr(
            bc, "BiocentralAPI", lambda **kw: self._fake_api(**api_kwargs)
        )
        monkeypatch.setattr(bc, "tqdm", Bar)
        monkeypatch.setattr(bc.time, "sleep", lambda s: None)

        h5_path = tmp_path / "out.h5"
        return seqs, h5_path, bar, bc

    @staticmethod
    def _embeddings(ids):
        return {pid: np.array([1.0, 2.0, 3.0], dtype=np.float32) for pid in ids}

    def test_result_none_raises(self, monkeypatch, tmp_path):
        seqs, h5_path, bar, bc = self._run(monkeypatch, tmp_path, result_none=True)

        with pytest.raises(ValueError, match="No new embeddings were produced"):
            bc.embed_sequences(seqs, "m", h5_path, embed_config=bc.EmbedConfig(2))

        assert bar["n"] == 0, "bar must not advance for a batch that wrote nothing"

    def test_empty_dict_raises(self, monkeypatch, tmp_path):
        """A non-None result carrying an empty dict used to be entirely silent."""
        seqs, h5_path, bar, bc = self._run(monkeypatch, tmp_path, to_dict=lambda s: {})

        with pytest.raises(ValueError, match="No new embeddings were produced"):
            bc.embed_sequences(seqs, "m", h5_path, embed_config=bc.EmbedConfig(2))

        assert bar["n"] == 0

    def test_batch_exception_raises(self, monkeypatch, tmp_path):
        seqs, h5_path, bar, bc = self._run(
            monkeypatch, tmp_path, exc=RuntimeError("HTTP 403")
        )

        with pytest.raises(ValueError, match="No new embeddings were produced"):
            bc.embed_sequences(seqs, "m", h5_path, embed_config=bc.EmbedConfig(2))

        assert bar["n"] == 0

    def test_short_response_raises_and_keeps_partial(self, monkeypatch, tmp_path):
        """The dangerous case: the API answers, but with fewer sequences."""
        import h5py

        seqs, h5_path, bar, bc = self._run(
            # one of every two requested sequences comes back
            monkeypatch,
            tmp_path,
            to_dict=lambda s: self._embeddings(list(s)[:1]),
        )

        with pytest.raises(ValueError, match="Embedding incomplete"):
            bc.embed_sequences(seqs, "m", h5_path, embed_config=bc.EmbedConfig(2))

        # Partial output is kept so a rerun only embeds what is missing...
        with h5py.File(h5_path, "r") as f:
            assert len(f.keys()) == self.N // 2
        # ...and the bar reports what was written, not the batch size.
        assert bar["n"] == self.N // 2
        assert bar["total"] == self.N

    def test_complete_run_does_not_raise(self, monkeypatch, tmp_path):
        seqs, h5_path, bar, bc = self._run(
            monkeypatch, tmp_path, to_dict=lambda s: self._embeddings(s)
        )

        assert (
            bc.embed_sequences(seqs, "m", h5_path, embed_config=bc.EmbedConfig(2))
            == h5_path
        )
        assert bar["n"] == bar["total"] == self.N

    def test_slash_in_id_is_rejected_before_any_api_call(self, monkeypatch, tmp_path):
        """h5py turns an ID containing "/" into a group, so it can never become the
        requested dataset. Both backends refuse up front rather than paying for a
        full embedding run and then reporting a shortfall they cannot explain."""
        from src.protspace.data.embedding import biocentral as bc

        called = []
        monkeypatch.setattr(
            bc,
            "BiocentralAPI",
            lambda **kw: called.append(1) or self._fake_api(to_dict=self._embeddings),
        )

        h5_path = tmp_path / "collide.h5"
        with pytest.raises(ValueError, match=r"Header\(s\) contain '/'"):
            bc.embed_sequences({"A/B": "MKV", "A": "MKW"}, "m", h5_path)

        assert not called, "must reject before connecting to the API"
        assert not h5_path.exists()

    def test_both_backends_reject_the_same_id(self, tmp_path):
        """Both backends raise the same error for the same invalid identifier,
        because the rejection lives in the shared layer rather than in either."""
        from src.protspace.data.embedding import biocentral as bc
        from src.protspace.data.embedding import local

        bad = {"A/B": "MKV"}
        messages = []
        for backend in (bc, local):
            with pytest.raises(ValueError) as exc:
                backend.embed_sequences(bad, "esm2_8m", tmp_path / "x.h5")
            messages.append(str(exc.value))

        assert messages[0] == messages[1], messages
        assert "invalid for HDF5 dataset names" in messages[0]

    def test_gate_reads_the_file_not_a_counter(self, monkeypatch, tmp_path):
        """The completeness gate reads the .h5, never a running total. A writer
        that under-delivers -- save_embeddings skips IDs already present -- must
        still be caught."""
        from src.protspace.data.embedding import biocentral as bc

        seqs, h5_path, _, bc_mod = self._run(
            monkeypatch, tmp_path, to_dict=lambda s: self._embeddings(s)
        )

        real_save = bc.save_embeddings
        dropped = sorted(seqs)[0]

        def lossy_save(path, embeddings):
            real_save(path, {k: v for k, v in embeddings.items() if k != dropped})

        monkeypatch.setattr(bc, "save_embeddings", lossy_save)

        with pytest.raises(ValueError, match="Embedding incomplete"):
            bc_mod.embed_sequences(seqs, "m", h5_path, embed_config=bc.EmbedConfig(2))

    def test_rerun_embeds_only_what_is_missing(self, monkeypatch, tmp_path):
        """A failed run must leave the pipeline able to converge on a retry."""
        import h5py

        seqs, h5_path, _, bc = self._run(
            monkeypatch, tmp_path, to_dict=lambda s: self._embeddings(list(s)[:1])
        )
        with pytest.raises(ValueError, match="Embedding incomplete"):
            bc.embed_sequences(seqs, "m", h5_path, embed_config=bc.EmbedConfig(2))

        # Server recovers: the rerun must succeed and touch only the missing IDs.
        seen = []

        def full(sequence_data):
            seen.extend(sequence_data)
            return self._embeddings(sequence_data)

        monkeypatch.setattr(
            bc, "BiocentralAPI", lambda **kw: self._fake_api(to_dict=full)
        )
        bc.embed_sequences(seqs, "m", h5_path, embed_config=bc.EmbedConfig(2))

        assert len(seen) == self.N // 2, "rerun must not re-embed what is on disk"
        with h5py.File(h5_path, "r") as f:
            assert set(f.keys()) == set(seqs)
