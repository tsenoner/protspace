"""Tests for the embedding-backend switch (local vs biocentral) — PR2.

Covers ``resolve_default_backend``, the ``backend`` dispatch in
``embed_fasta``, and the ``--backend`` CLI wiring — all without loading a
real model (the backend ``embed_sequences`` is replaced by a fake that writes
a tiny HDF5).
"""

import sys
import types
from pathlib import Path

import h5py
import numpy as np
import pytest
from typer.testing import CliRunner

from protspace.cli.app import app
from protspace.data.embedding import local
from protspace.data.embedding.biocentral import resolve_embedder
from protspace.data.loaders.fasta import embed_fasta


def _fake_embed(captured):
    """A stand-in for ``embed_sequences`` that records its args and writes a
    minimal valid HDF5 so the surrounding load_h5 machinery still works."""

    def fake(sequences, embedder, h5_path, embed_config=None):
        with h5py.File(h5_path, "a") as f:
            for pid in sequences:
                if pid not in f:
                    f.create_dataset(pid, data=np.ones(4, dtype=np.float32))
        captured["embedder"] = embedder
        captured["ids"] = list(sequences)
        captured["config"] = embed_config
        return Path(h5_path)

    return fake


# ---------------------------------------------------------------------------
# resolve_default_backend
# ---------------------------------------------------------------------------


def test_default_backend_is_biocentral_outside_colab(monkeypatch):
    monkeypatch.delitem(sys.modules, "google.colab", raising=False)
    assert local.resolve_default_backend() == "biocentral"


def test_default_backend_is_biocentral_in_colab_without_gpu(monkeypatch):
    monkeypatch.setitem(sys.modules, "google.colab", types.ModuleType("google.colab"))
    import torch

    monkeypatch.setattr(torch.cuda, "is_available", lambda: False)
    assert local.resolve_default_backend() == "biocentral"


def test_default_backend_is_local_in_colab_with_gpu(monkeypatch):
    monkeypatch.setitem(sys.modules, "google.colab", types.ModuleType("google.colab"))
    import torch

    monkeypatch.setattr(torch.cuda, "is_available", lambda: True)
    assert local.resolve_default_backend() == "local"


# ---------------------------------------------------------------------------
# embed_fasta dispatch
# ---------------------------------------------------------------------------


def test_embed_fasta_local_passes_short_key_and_remapped_ids(tmp_path, monkeypatch):
    fasta = tmp_path / "s.fasta"
    fasta.write_text(">sp|P12345|SOME_NAME\nMKVLAAG\n")
    captured = {}
    monkeypatch.setattr(
        "protspace.data.embedding.local.embed_sequences", _fake_embed(captured)
    )

    result = embed_fasta(
        fasta, "prot_t5", backend="local", embedding_cache=tmp_path / "e.h5"
    )

    assert captured["embedder"] == "prot_t5"  # SHORT key, resolved locally
    assert captured["ids"] == ["P12345"]  # header remapped to bare accession
    assert result is not None


def test_embed_fasta_biocentral_passes_resolved_full_name(tmp_path, monkeypatch):
    fasta = tmp_path / "s.fasta"
    fasta.write_text(">P12345\nMKVLAAG\n")
    captured = {}
    monkeypatch.setattr(
        "protspace.data.embedding.biocentral.embed_sequences", _fake_embed(captured)
    )

    embed_fasta(
        fasta, "prot_t5", backend="biocentral", embedding_cache=tmp_path / "e.h5"
    )

    assert captured["embedder"] == resolve_embedder("prot_t5")  # full model name


def test_embed_fasta_defaults_to_biocentral(tmp_path, monkeypatch):
    fasta = tmp_path / "s.fasta"
    fasta.write_text(">P12345\nMKVLAAG\n")
    captured = {}
    monkeypatch.setattr(
        "protspace.data.embedding.biocentral.embed_sequences", _fake_embed(captured)
    )

    embed_fasta(fasta, "prot_t5", embedding_cache=tmp_path / "e.h5")  # no backend arg

    assert captured["embedder"] == resolve_embedder("prot_t5")


def test_embed_fasta_unknown_backend_raises(tmp_path):
    fasta = tmp_path / "s.fasta"
    fasta.write_text(">P12345\nMKVLAAG\n")
    with pytest.raises(ValueError, match="backend"):
        embed_fasta(fasta, "prot_t5", backend="nope", embedding_cache=tmp_path / "e.h5")


# ---------------------------------------------------------------------------
# CLI wiring
# ---------------------------------------------------------------------------


def test_embed_cli_backend_local_dispatches_to_local(tmp_path, monkeypatch):
    fasta = tmp_path / "s.fasta"
    fasta.write_text(">P12345\nMKVLAAG\n")
    captured = {}
    monkeypatch.setattr(
        "protspace.data.embedding.local.embed_sequences", _fake_embed(captured)
    )

    result = CliRunner().invoke(
        app,
        [
            "embed",
            "-i",
            str(fasta),
            "-e",
            "prot_t5",
            "-o",
            str(tmp_path / "out"),
            "--backend",
            "local",
        ],
    )

    assert result.exit_code == 0, result.output
    assert captured["embedder"] == "prot_t5"  # local gets the short key
    # local backend must build a LocalEmbedConfig, not a Biocentral EmbedConfig
    assert type(captured["config"]).__name__ == "LocalEmbedConfig"


def test_embed_cli_rejects_nonpositive_batch_size(tmp_path, monkeypatch):
    """--batch-size 0 must be rejected up front (it would otherwise infinite-loop
    the local backend after loading the model)."""
    fasta = tmp_path / "s.fasta"
    fasta.write_text(">P12345\nMKVLAAG\n")
    # Guard against regressions: even if validation were skipped, don't let a
    # real model load / hang.
    monkeypatch.setattr(
        "protspace.data.embedding.local.embed_sequences", _fake_embed({})
    )

    result = CliRunner().invoke(
        app,
        [
            "embed",
            "-i",
            str(fasta),
            "-e",
            "prot_t5",
            "-o",
            str(tmp_path / "out"),
            "--backend",
            "local",
            "--batch-size",
            "0",
        ],
    )

    assert result.exit_code != 0


def test_embed_cli_rejects_unknown_backend(tmp_path):
    fasta = tmp_path / "s.fasta"
    fasta.write_text(">P12345\nMKVLAAG\n")

    result = CliRunner().invoke(
        app,
        [
            "embed",
            "-i",
            str(fasta),
            "-e",
            "prot_t5",
            "-o",
            str(tmp_path / "out"),
            "--backend",
            "bogus",
        ],
    )

    assert result.exit_code != 0
