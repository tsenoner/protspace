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
import typer
from typer.testing import CliRunner

from protspace.cli.app import app
from protspace.data.embedding import local
from protspace.data.embedding.biocentral import resolve_embedder
from protspace.data.loaders.fasta import embed_fasta


def _fake_embed(captured, fill_value=1.0):
    """A stand-in for ``embed_sequences`` that records its args and writes a
    minimal valid HDF5 so the surrounding load_h5 machinery still works."""

    def fake(sequences, embedder, h5_path, embed_config=None):
        with h5py.File(h5_path, "a") as f:
            for pid in sequences:
                if pid not in f:
                    f.create_dataset(
                        pid,
                        data=np.full(4, fill_value, dtype=np.float32),
                    )
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


@pytest.mark.parametrize(
    ("second_backend", "expected"),
    [("biocentral", 2.0), ("local", 1.0)],
    ids=["switched-backend-embeds-again", "same-backend-resumes"],
)
def test_notebook_embedding_cache_is_owned_by_its_backend(
    tmp_path, monkeypatch, second_backend, expected
):
    from protspace.data.processors.pipeline import _embedding_cache_path

    fasta = tmp_path / "s.fasta"
    fasta.write_text(">P12345\nMKVLAAG\n")

    def embed(backend, fill_value):
        monkeypatch.setattr(
            f"protspace.data.embedding.{backend}.embed_sequences",
            _fake_embed({}, fill_value=fill_value),
        )
        return embed_fasta(
            fasta,
            "prot_t5",
            backend=backend,
            embedding_cache=_embedding_cache_path(tmp_path, "prot_t5", backend),
        )

    embed("local", 1.0)
    # The second producer writes 2.0, so only reusing the first H5 returns 1.0.
    result = embed(second_backend, 2.0)

    assert result.data.tolist() == [[expected] * 4]


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


def test_prepare_directory_h5_attaches_fasta_to_embedding_set(tmp_path, monkeypatch):
    h5_dir = tmp_path / "embeddings"
    h5_dir.mkdir()
    with h5py.File(h5_dir / "model.h5", "w") as h5_file:
        h5_file.attrs["model_name"] = "prot_t5"
        h5_file.create_dataset("custom_protein", data=np.ones(4, dtype=np.float32))

    fasta = tmp_path / "input.fasta"
    fasta.write_text(">custom_protein\nMPEPTIDE\n")
    captured = {}

    def capture_run(self, embedding_sets):
        captured["fasta_path"] = embedding_sets[0].fasta_path
        return self.config.output_path

    monkeypatch.setattr(
        "protspace.data.processors.pipeline.ReductionPipeline.run", capture_run
    )

    result = CliRunner().invoke(
        app,
        [
            "prepare",
            "-i",
            str(h5_dir),
            "-f",
            str(fasta),
            "-o",
            str(tmp_path / "out"),
            "--no-log",
        ],
    )

    assert result.exit_code == 0, result.output
    assert captured["fasta_path"] == fasta


def test_embed_cli_continues_after_a_failing_model(tmp_path, monkeypatch):
    """One model failing must not abandon the models that follow it.

    Each -e gets its own .h5, so the models are independent; aborting the loop
    on the first failure throws away work the user asked for and would have got.
    """
    fasta = tmp_path / "s.fasta"
    fasta.write_text(">P12345\nMKVLAAG\n")
    attempted = []

    def flaky(sequences, embedder, h5_path, embed_config=None):
        attempted.append(embedder)
        if "prot_t5" in embedder:
            raise ValueError(f"Embedding incomplete for {h5_path}")
        with h5py.File(h5_path, "a") as f:
            for pid in sequences:
                f.create_dataset(pid, data=np.zeros(4, dtype=np.float32))
        return h5_path

    monkeypatch.setattr("protspace.data.embedding.biocentral.embed_sequences", flaky)

    result = CliRunner().invoke(
        app,
        [
            "embed",
            "-i",
            str(fasta),
            "-e",
            "prot_t5",
            "-e",
            "esm2_8m",
            "-o",
            str(tmp_path / "out"),
        ],
    )

    # The failure still decides the exit code...
    assert result.exit_code == 1, result.output
    # ...but the second model was tried and produced its file.
    assert len(attempted) == 2, attempted
    produced = sorted(p.name for p in (tmp_path / "out").glob("*.h5"))
    assert produced == ["esm2_8m.h5"]


def test_embed_cli_does_not_stamp_a_failed_model(tmp_path, monkeypatch):
    """No model_name attr and no "Saved:" line for a model that failed — that
    pair is what made a total failure read as a finished run."""
    fasta = tmp_path / "s.fasta"
    fasta.write_text(">P12345\nMKVLAAG\n")

    def always_fails(sequences, embedder, h5_path, embed_config=None):
        raise ValueError("No new embeddings were produced")

    monkeypatch.setattr(
        "protspace.data.embedding.biocentral.embed_sequences", always_fails
    )

    out = tmp_path / "out"
    result = CliRunner().invoke(
        app, ["embed", "-i", str(fasta), "-e", "prot_t5", "-o", str(out)]
    )

    assert result.exit_code == 1, result.output
    assert "Saved:" not in result.output
    assert not (out / "prot_t5.h5").exists(), "no .h5 may be fabricated on failure"


def test_embed_cli_wires_max_length_to_local_config(tmp_path, monkeypatch):
    """Without a lever, "skipped 3 sequences" is a dead end for the user."""
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
            "--max-length",
            "512",
        ],
    )

    assert result.exit_code == 0, result.output
    assert captured["config"].max_length == 512


def test_embed_cli_rejects_max_length_for_biocentral(tmp_path):
    """The remote backend has no length cap, so silently ignoring the flag would
    let a user believe they had raised a limit that does not exist."""
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
            "--max-length",
            "512",
        ],
    )

    # Only the exit code is asserted here: the message is rendered inside a Rich
    # panel, which rewraps with the terminal width, so matching on it is brittle.
    # The message itself is pinned by the unit test below.
    assert result.exit_code != 0


def test_build_embed_config_rejects_max_length_for_biocentral():
    """Pinned separately from the CLI so the assertion does not depend on how
    Rich happens to wrap the panel at the current terminal width."""
    from protspace.cli.common_options import Backend, build_embed_config

    with pytest.raises(typer.BadParameter, match="backend local"):
        build_embed_config(Backend.biocentral, max_length=512)


def test_build_embed_config_accepts_max_length_for_local():
    from protspace.cli.common_options import Backend, build_embed_config

    cfg = build_embed_config(Backend.local, batch_size=4, max_length=512)
    assert (cfg.batch_size, cfg.max_length) == (4, 512)


def test_embed_cli_rejects_nonpositive_max_length(tmp_path):
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
            "local",
            "--max-length",
            "0",
        ],
    )

    assert result.exit_code != 0
