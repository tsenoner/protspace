"""Completeness contract shared by both embedding backends.

The rule is `expected = requested - skipped`: a documented capability limit is
skipped and reported, anything else absent from the .h5 fails. Before this
contract the local backend exited 0 on a 90%-complete .h5, which then projected,
bundled and scored normally.
"""

from pathlib import Path

import h5py
import numpy as np
import pytest

from protspace.data.embedding import store
from protspace.data.loaders.fasta import check_fasta_coverage


def _write(h5_path: Path, ids) -> None:
    with h5py.File(h5_path, "a") as f:
        for pid in ids:
            f.create_dataset(pid, data=np.zeros(4, dtype=np.float32))


class TestFinishRun:
    def test_complete_run_succeeds(self, tmp_path):
        h5 = tmp_path / "o.h5"
        _write(h5, ["a", "b"])
        assert store.finish_run(h5, ["a", "b"]) == h5

    def test_missing_sequence_fails(self, tmp_path):
        h5 = tmp_path / "o.h5"
        _write(h5, ["a"])
        with pytest.raises(ValueError, match="Embedding incomplete"):
            store.finish_run(h5, ["a", "b"])

    def test_nothing_embedded_is_distinguished_from_partial(self, tmp_path):
        h5 = tmp_path / "o.h5"
        with pytest.raises(ValueError, match="No new embeddings were produced"):
            store.finish_run(h5, ["a", "b"])

    def test_capability_limit_is_skipped_not_failed(self, tmp_path):
        """The whole point: a sequence we deliberately never attempted must not
        fail the run, but must still be reported."""
        h5 = tmp_path / "o.h5"
        _write(h5, ["a"])
        assert store.finish_run(h5, ["a", "b"], skipped={"b": "too long"}) == h5

    def test_skips_are_named_with_their_reason(self, tmp_path, caplog):
        h5 = tmp_path / "o.h5"
        _write(h5, ["a"])
        with caplog.at_level("WARNING"):
            store.finish_run(h5, ["a", "b", "c"], skipped={"b": "too long", "c": "OOM"})
        text = caplog.text
        assert "too long" in text and "OOM" in text
        assert "b" in text and "c" in text

    def test_skipping_everything_is_still_a_failure(self, tmp_path):
        h5 = tmp_path / "o.h5"
        with pytest.raises(ValueError, match="No new embeddings were produced"):
            store.finish_run(h5, ["a"], skipped={"a": "too long"})

    def test_empty_request_means_resume_covered_it(self, tmp_path):
        """An empty outstanding set is not 'nothing was produced' -- it means a
        previous run already embedded everything."""
        h5 = tmp_path / "o.h5"
        _write(h5, ["a"])
        assert store.finish_run(h5, []) == h5

    def test_gate_reads_the_file_not_the_caller(self, tmp_path):
        """save_embeddings skips IDs already present, so a running total can claim
        sequences the file does not hold. The gate must read the file."""
        h5 = tmp_path / "o.h5"
        store.save_embeddings(h5, {"a": np.zeros(4, dtype=np.float32)})
        store.save_embeddings(h5, {"a": np.ones(4, dtype=np.float32)})  # skipped
        with pytest.raises(ValueError, match="Embedding incomplete"):
            store.finish_run(h5, ["a", "b"])

    def test_message_cannot_be_mistaken_for_a_service_outage(self, tmp_path):
        """The prep service substring-matches stderr to classify a failure as
        BIOCENTRAL_UNAVAILABLE and route the user to Colab. A coverage problem
        must not trip those patterns -- Colab would not fix it."""
        patterns = (
            "connection refused",
            "cannot connect to host",
            "connectionerror",
            "temporary failure in name resolution",
            "name or service not known",
            "503 service unavailable",
            "503 server error",
            "no healthy biocentral",
        )
        h5 = tmp_path / "o.h5"
        _write(h5, ["a"])
        with pytest.raises(ValueError) as exc:
            store.finish_run(h5, ["a", "b"])
        assert not [p for p in patterns if p in str(exc.value).lower()]


class TestProducerOwnership:
    """A cache belongs to the backend and model that wrote it.

    Both backends resume by identifier alone, so without a recorded producer a
    Local-written vector satisfies a Biocentral run's resume check and the two
    models end up mixed in one dataset.
    """

    @staticmethod
    def _owned(h5_path, *, backend="local", model="prot_t5", ids=("a",)):
        store.save_embeddings(
            h5_path,
            {pid: np.zeros(4, dtype=np.float32) for pid in ids},
            sequences=dict.fromkeys(ids, "MKV"),
            backend=backend,
            model=model,
        )
        return h5_path

    def test_another_backend_is_refused_and_named_with_the_remedies(self, tmp_path):
        h5 = self._owned(tmp_path / "local-prot_t5.h5")
        with pytest.raises(ValueError) as exc:
            store.begin_run(
                h5,
                {"a": "MKV"},
                backend="biocentral",
                model="Rostlab/prot_t5_xl_uniref50",
            )
        msg = str(exc.value)
        assert str(h5) in msg
        assert "local" in msg and "prot_t5" in msg
        # The three ways forward, or the message is a dead end.
        assert "--refetch embed" in msg
        assert "backend" in msg and "path" in msg

    def test_another_model_on_the_same_backend_is_refused(self, tmp_path):
        """Two models' vectors are as unmixable as two backends'."""
        h5 = self._owned(tmp_path / "c.h5")
        with pytest.raises(ValueError, match="prot_t5"):
            store.begin_run(h5, {"a": "MKV"}, backend="local", model="esm2_8m")

    def test_a_refused_file_is_left_untouched(self, tmp_path):
        h5 = self._owned(tmp_path / "c.h5")
        before = h5.read_bytes()
        with pytest.raises(ValueError):
            store.begin_run(h5, {"b": "MKW"}, backend="biocentral", model="m")
        assert h5.exists(), "a refused cache must not be deleted"
        assert h5.read_bytes() == before, "a refused cache must not be extended"

    def test_the_same_producer_resumes(self, tmp_path):
        h5 = self._owned(tmp_path / "c.h5", ids=("a",))
        outstanding = store.begin_run(
            h5, {"a": "MKV", "b": "MKW"}, backend="local", model="prot_t5"
        )
        assert outstanding == {"b": "MKW"}

    def test_a_file_predating_producers_is_adopted_and_reported(self, tmp_path, caplog):
        """Refusing legacy files would force a full re-embed of every existing
        cache on upgrade, so they are adopted -- audibly."""
        h5 = tmp_path / "legacy.h5"
        _write(h5, ["a"])
        with caplog.at_level("INFO"):
            outstanding = store.begin_run(
                h5, {"a": "MKV"}, backend="local", model="prot_t5"
            )
        assert outstanding == {}
        assert "local" in caplog.text and "prot_t5" in caplog.text
        with h5py.File(h5, "r") as f:
            assert f.attrs["protspace_backend"] == "local"
            assert f.attrs["protspace_model"] == "prot_t5"

    def test_an_adopted_file_is_owned_from_then_on(self, tmp_path):
        h5 = tmp_path / "legacy.h5"
        _write(h5, ["a"])
        store.begin_run(h5, {"a": "MKV"}, backend="local", model="prot_t5")
        with pytest.raises(ValueError, match="--refetch embed"):
            store.begin_run(h5, {"a": "MKV"}, backend="biocentral", model="prot_t5")


class TestSequenceIdentity:
    """A vector belongs to the residues it was computed from."""

    @staticmethod
    def _save(h5_path, sequences, fill=1.0):
        store.save_embeddings(
            h5_path,
            {pid: np.full(4, fill, dtype=np.float32) for pid in sequences},
            sequences=sequences,
            backend="local",
            model="prot_t5",
        )

    def test_a_changed_sequence_is_outstanding_again(self, tmp_path):
        h5 = tmp_path / "c.h5"
        self._save(h5, {"a": "MKV", "b": "MKW"})
        outstanding = store.begin_run(
            h5, {"a": "MKV", "b": "EDITED"}, backend="local", model="prot_t5"
        )
        assert outstanding == {"b": "EDITED"}

    def test_re_embedding_replaces_the_vector_and_the_digest(self, tmp_path):
        """save_embeddings skips identifiers already present, so without this the
        re-embed is computed and then thrown away."""
        h5 = tmp_path / "c.h5"
        self._save(h5, {"a": "MKV"}, fill=1.0)
        self._save(h5, {"a": "EDITED"}, fill=2.0)
        with h5py.File(h5, "r") as f:
            assert f["a"][:].tolist() == [2.0] * 4
            assert f["a"].attrs["protspace_sequence_sha256"] == store.sequence_digest(
                "EDITED"
            )

    def test_an_unchanged_sequence_keeps_its_vector(self, tmp_path):
        h5 = tmp_path / "c.h5"
        self._save(h5, {"a": "MKV"}, fill=1.0)
        self._save(h5, {"a": "MKV"}, fill=2.0)
        with h5py.File(h5, "r") as f:
            assert f["a"][:].tolist() == [1.0] * 4

    def test_a_protein_without_a_digest_is_trusted(self, tmp_path):
        h5 = tmp_path / "legacy.h5"
        _write(h5, ["a"])
        assert (
            store.begin_run(h5, {"a": "ANYTHING"}, backend="local", model="prot_t5")
            == {}
        )

    def test_finish_run_fails_when_a_stale_protein_was_not_re_embedded(self, tmp_path):
        """Its old vector is still on disk under its old residues, so a presence
        check alone reports the run complete."""
        h5 = tmp_path / "c.h5"
        self._save(h5, {"a": "MKV", "b": "MKW"})
        with pytest.raises(ValueError, match="Embedding incomplete"):
            store.finish_run(h5, ["a", "b"], sequences={"a": "EDITED", "b": "MKW"})

    def test_finish_run_accepts_a_stale_protein_that_was_re_embedded(self, tmp_path):
        h5 = tmp_path / "c.h5"
        self._save(h5, {"a": "MKV"}, fill=1.0)
        self._save(h5, {"a": "EDITED"}, fill=2.0)
        assert store.finish_run(h5, ["a"], sequences={"a": "EDITED"}) == h5

    def test_resume_reads_the_digests_in_one_pass(self, tmp_path, monkeypatch):
        """The digest is per protein at up to 570K of them: one open for the file,
        not one per protein."""
        h5 = tmp_path / "c.h5"
        sequences = {f"p{i}": "MKV" for i in range(50)}
        self._save(h5, sequences)

        opens = []
        real_file = h5py.File
        monkeypatch.setattr(
            h5py, "File", lambda *a, **kw: opens.append(1) or real_file(*a, **kw)
        )
        store.begin_run(h5, sequences, backend="local", model="prot_t5")

        assert len(opens) == 1, f"{len(opens)} opens for {len(sequences)} proteins"


class TestValidateHeaders:
    def test_rejects_slash(self):
        with pytest.raises(ValueError, match="invalid for HDF5 dataset names"):
            store.validate_headers(["A/B"])

    def test_accepts_ordinary_ids(self):
        store.validate_headers(["P12345", "sp|P12345|NAME"])


class TestFastaCoverage:
    @staticmethod
    def _fasta(tmp_path, ids):
        p = tmp_path / "s.fasta"
        p.write_text("".join(f">{i}\nMKV\n" for i in ids))
        return p

    def test_uncovered_embeddings_block_similarity(self, tmp_path):
        """One uncovered protein zero-fills its diagonal, which suppresses the
        similarity-to-distance conversion for the WHOLE matrix and inverts MDS."""
        fasta = self._fasta(tmp_path, ["P1", "P2"])
        with pytest.raises(ValueError, match="absent from"):
            check_fasta_coverage(fasta, ["P1", "P2", "P3"], required=True)

    def test_uncovered_embeddings_only_warn_without_similarity(self, tmp_path, caplog):
        fasta = self._fasta(tmp_path, ["P1"])
        with caplog.at_level("WARNING"):
            check_fasta_coverage(fasta, ["P1", "P2"], required=False)
        assert "absent from" in caplog.text

    def test_fasta_superset_is_silent(self, tmp_path, caplog):
        """A resumed embedding cache legitimately covers fewer proteins than the
        FASTA it was built from."""
        fasta = self._fasta(tmp_path, ["P1", "P2", "P3"])
        with caplog.at_level("WARNING"):
            check_fasta_coverage(fasta, ["P1"], required=True)
        assert caplog.text == ""

    def test_identifier_styles_are_reconciled(self, tmp_path, caplog):
        """load_h5 keeps raw HDF5 keys while FASTA ids are parsed, so comparing
        them raw would report every protein uncovered."""
        fasta = self._fasta(tmp_path, ["sp|P12345|NAME_HUMAN"])
        with caplog.at_level("WARNING"):
            check_fasta_coverage(fasta, ["P12345"], required=True)
        assert caplog.text == ""


class TestFastaOptionWiring:
    """`-f/--fasta` reaches the pipeline, and a path that is not there says so.

    Both sit upstream of the coverage check: sequences that never get attached
    cannot be checked, and a typo'd path used to be swallowed silently by the
    ``.exists()`` guard in ``ReductionPipeline._extract_sequences``.
    """

    @staticmethod
    def _inputs(tmp_path):
        """A directory of embeddings plus the FASTA they came from."""
        d = tmp_path / "embs"
        d.mkdir()
        _write(d / "prot_t5.h5", ["P1", "P2"])
        with h5py.File(d / "prot_t5.h5", "a") as f:
            f.attrs["model_name"] = "prot_t5"
        fasta = tmp_path / "seqs.fasta"
        fasta.write_text(">P1\nAAAA\n>P2\nCCCC\n")
        return d, fasta

    @staticmethod
    def _stub_pipeline(monkeypatch, captured):
        """Capture the embedding sets instead of reducing and annotating them.

        Also keeps a regression here off the network: without it, a lost
        ``exists=True`` would let the run reach the real annotation fetch.
        """
        import protspace.data.processors.pipeline as pipeline_mod

        class _Capture:
            def __init__(self, config):
                pass

            def run(self, embedding_sets):
                captured["sets"] = embedding_sets

        monkeypatch.setattr(pipeline_mod, "ReductionPipeline", _Capture)

    @staticmethod
    def _prepare(d, fasta, tmp_path):
        return [
            "prepare",
            "-i",
            str(d),
            "-f",
            str(fasta),
            "-m",
            "pca2",
            "-o",
            str(tmp_path / "out"),
            "--no-scores",
            "--no-log",
        ]

    def test_fasta_reaches_a_directory_input(self, tmp_path, monkeypatch):
        """``-i <dir> -f x.fasta`` must attach the FASTA, as ``-i <file>`` does.

        Only the single-file branch attached it, so a directory of embeddings
        got similarity but shipped a bundle carrying no sequences.
        """
        from typer.testing import CliRunner

        from protspace.cli.app import app

        d, fasta = self._inputs(tmp_path)
        captured: dict = {}
        self._stub_pipeline(monkeypatch, captured)

        result = CliRunner().invoke(app, self._prepare(d, fasta, tmp_path))

        assert result.exit_code == 0, result.output
        assert [s.fasta_path for s in captured["sets"]] == [fasta]

    def test_prepare_rejects_a_fasta_that_is_not_there(self, tmp_path, monkeypatch):
        """Same invocation as above, only the FASTA path is a typo.

        Pinned on exit code 2 -- the usage error typer raises for a path that
        does not exist -- rather than merely non-zero: the coverage check would
        also fail this run, at exit 1, from `parse_fasta` deep in the pipeline.
        The point is that the typo is caught as a bad argument. Exit codes are
        immune to the terminal width that reflows the message in its panel.
        """
        from typer.testing import CliRunner

        from protspace.cli.app import app

        d, _ = self._inputs(tmp_path)
        self._stub_pipeline(monkeypatch, {})

        result = CliRunner().invoke(
            app, self._prepare(d, tmp_path / "typo.fasta", tmp_path)
        )

        assert result.exit_code == 2, result.output

    def test_project_rejects_a_fasta_that_is_not_there(self, tmp_path):
        """`project` swallowed it whole: without -s the FASTA is never read, so
        a typo'd -f exited 0 having quietly done nothing with it."""
        from typer.testing import CliRunner

        from protspace.cli.app import app

        d, _ = self._inputs(tmp_path)
        result = CliRunner().invoke(
            app,
            [
                "project",
                "-i",
                str(d / "prot_t5.h5"),
                "-f",
                str(tmp_path / "typo.fasta"),
                "-m",
                "pca2",
                "-o",
                str(tmp_path / "out"),
            ],
        )

        assert result.exit_code == 2, result.output
