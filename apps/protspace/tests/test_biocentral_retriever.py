"""Tests for Biocentral prediction retriever."""

import re
from pathlib import Path
from unittest.mock import MagicMock, patch

import pandas as pd
import pytest

from protspace.core.constants import standardize_missing
from src.protspace.data.annotations.retrievers.biocentral_retriever import (
    BIOCENTRAL_ANNOTATIONS,
    BiocentralPredictionRetriever,
)

REPO_ROOT = Path(__file__).resolve().parents[3]
WEB_MISSING_VALUES = (
    REPO_ROOT / "packages" / "utils" / "src" / "visualization" / "missing-values.ts"
)


def _make_prediction(model_name, value):
    """Build a mock Prediction object."""
    pred = MagicMock()
    pred.model_name = model_name
    pred.value = value
    return pred


class TestBiocentralConstants:
    def test_biocentral_annotations(self):
        expected = [
            "predicted_subcellular_location",
            "predicted_membrane",
            "predicted_signal_peptide",
            "predicted_transmembrane",
        ]
        assert BIOCENTRAL_ANNOTATIONS == expected


class TestSignalPeptideExtraction:
    """Test TMbed → signal peptide derivation."""

    def test_signal_peptide_present(self):
        preds = [_make_prediction("TMbed", "ooooSSSSSooooiiiiiii")]
        result = BiocentralPredictionRetriever._extract_signal_peptide(preds)
        assert result == "True"

    def test_signal_peptide_absent(self):
        preds = [_make_prediction("TMbed", "ooooHHHHHHHHHHHHooooo")]
        result = BiocentralPredictionRetriever._extract_signal_peptide(preds)
        assert result == "False"

    def test_no_tmbed_prediction(self):
        preds = [_make_prediction("OtherModel", "something")]
        result = BiocentralPredictionRetriever._extract_signal_peptide(preds)
        assert result == ""


class TestTransmembraneExtraction:
    """Test TMbed → transmembrane type derivation."""

    def test_alpha_helical(self):
        preds = [_make_prediction("TMbed", "ooooHHHHHHHHHHHHooooo")]
        result = BiocentralPredictionRetriever._extract_transmembrane(preds)
        assert result == "alpha-helical"

    def test_beta_barrel(self):
        preds = [_make_prediction("TMbed", "ooooBBBBBBBBBBBBooooo")]
        result = BiocentralPredictionRetriever._extract_transmembrane(preds)
        assert result == "beta-barrel"

    def test_both_types(self):
        preds = [_make_prediction("TMbed", "ooHHHHHHoooBBBBBBBooo")]
        result = BiocentralPredictionRetriever._extract_transmembrane(preds)
        assert result == "alpha-helical;beta-barrel"

    def test_no_transmembrane(self):
        preds = [_make_prediction("TMbed", "oooooooooiiiiiiiiiii")]
        result = BiocentralPredictionRetriever._extract_transmembrane(preds)
        assert result == "non-transmembrane"

    def test_lowercase_labels(self):
        """TMbed uses lowercase h/b for non-TM side of helix/strand."""
        preds = [_make_prediction("TMbed", "ooohhHHHHHhhoooo")]
        result = BiocentralPredictionRetriever._extract_transmembrane(preds)
        assert result == "alpha-helical"

    def test_no_tmbed_prediction(self):
        preds = [_make_prediction("OtherModel", "something")]
        result = BiocentralPredictionRetriever._extract_transmembrane(preds)
        assert result == ""

    @pytest.mark.parametrize("value", ["", None], ids=["empty", "none"])
    def test_an_empty_payload_is_missing_not_negative(self, value):
        """A TMbed entry with no topology predicted nothing.

        Before the negative got a name it came out as `none`, which displays as
        N/A; `non-transmembrane` would turn it into a confident negative.
        """
        preds = [_make_prediction("TMbed", value)]
        result = BiocentralPredictionRetriever._extract_transmembrane(preds)
        assert result == ""


def _web_missing_tokens() -> set[str]:
    """The web app's MISSING_VALUE_TOKENS, read from its source."""
    source = WEB_MISSING_VALUES.read_text()
    block = re.search(
        r"MISSING_VALUE_TOKENS[^=]*=\s*new Set\(\[(.*?)\]\)", source, re.S
    )
    assert block, f"MISSING_VALUE_TOKENS not found in {WEB_MISSING_VALUES}"
    return set(re.findall(r"'([^']*)'", block.group(1)))


class TestNoTransmembraneIsACategory:
    """A protein without a TM segment is a prediction, not a missing value.

    Both readers turn a set of literal tokens into N/A: the CLI's
    `standardize_missing` (exact match) and the web app's `normalizeMissingValue`
    (trimmed, case-insensitive). `none` was one of them, so every negative
    prediction displayed as N/A.
    """

    LABEL = BiocentralPredictionRetriever._extract_transmembrane(
        [_make_prediction("TMbed", "ooooooiiiiii")]
    )

    def test_the_cli_keeps_it(self):
        assert standardize_missing(pd.Series([self.LABEL])).tolist() == [self.LABEL]

    def test_the_web_app_keeps_it(self):
        tokens = _web_missing_tokens()

        assert "none" in tokens  # the list was read, and still has the old label
        assert self.LABEL.strip() and self.LABEL.strip().lower() not in tokens


class TestPerSequenceExtraction:
    """Test per-sequence prediction extraction."""

    def test_subcellular_location(self):
        preds = [
            _make_prediction("LightAttentionSubcellularLocalization", "Nucleus"),
        ]
        result = BiocentralPredictionRetriever._extract_per_sequence(
            preds, "LightAttentionSubcellularLocalization"
        )
        assert result == "Nucleus"

    def test_membrane(self):
        preds = [_make_prediction("LightAttentionMembrane", "Membrane")]
        result = BiocentralPredictionRetriever._extract_per_sequence(
            preds, "LightAttentionMembrane"
        )
        assert result == "Membrane"

    def test_model_not_found(self):
        preds = [_make_prediction("OtherModel", "value")]
        result = BiocentralPredictionRetriever._extract_per_sequence(
            preds, "LightAttentionMembrane"
        )
        assert result == ""


class TestBiocentralRetrieverNoSequences:
    """Test retriever behavior when no sequences are provided."""

    def test_no_sequences_returns_empty(self):
        retriever = BiocentralPredictionRetriever(
            headers=["P01308"],
            annotations=BIOCENTRAL_ANNOTATIONS,
            sequences={},
        )
        result = retriever.fetch_annotations()

        assert len(result) == 1
        assert result[0].identifier == "P01308"
        assert all(v == "" for v in result[0].annotations.values())


# The substrings the prep service matches (apps/prep/.../pipeline.py) to
# classify a failure as BIOCENTRAL_UNAVAILABLE and send the user to Colab.
# Copied, not imported: protspace must not depend on protspace_prep.
_BIOCENTRAL_DOWN_PATTERNS = (
    "connection refused",
    "cannot connect to host",
    "connectionerror",
    "temporary failure in name resolution",
    "name or service not known",
    "503 service unavailable",
    "503 server error",
    "no healthy biocentral",
)


def _seq(i: int, length: int = 30) -> str:
    """A distinct protein sequence for index *i*."""
    alphabet = "ACDEFGHIKLMNPQRSTVWY"
    tag = "".join(alphabet[int(d)] for d in f"{i:05d}")
    return ("M" + tag + "G" * length)[: max(length, 6)]


class _FakeBiocentral:
    """Stands in for ``BiocentralAPI``: records each ``predict`` request and
    answers with a membrane prediction per sequence, keyed like the live server
    (v1.2.1) by the submitted identifier. Batches listed in *failing* raise."""

    def __init__(self, failing=(), error=None, rejects=(), failing_ids=()):
        self.failing = set(failing)
        # Identifiers whose every request fails (a batch split and resent
        # still fails while it holds one of them).
        self.failing_ids = set(failing_ids)
        self.error = error or RuntimeError("prediction task failed")
        # Identifiers the server refuses on length, failing the whole request
        # the way biocentral.rostlab.org v1.2.1 answers with 422.
        self.rejects = set(rejects)
        self.requests: list[dict[str, str]] = []
        self.health_checks = 0

    def __call__(self, *args, **kwargs):  # BiocentralAPI(fixed_server_url=...)
        return self

    def wait_until_healthy(self, *args, **kwargs):
        self.health_checks += 1
        return self

    def predict(self, model_names, sequence_data):
        self.requests.append(dict(sequence_data))
        batch_number = len(self.requests)
        result = {
            seq_id: [_make_prediction("LightAttentionMembrane", f"membrane:{seq}")]
            for seq_id, seq in sequence_data.items()
        }
        task = MagicMock()
        rejected = sorted(self.rejects & set(sequence_data))
        if rejected:
            error = RuntimeError(
                "(422)\nHTTP response body: detail=[ValidationError(msg='Value error, "
                f"{rejected[0]} is too short, min_seq_length=7, max_seq_length=5000')]"
            )
            task.run.side_effect = error
            task.run_with_progress.side_effect = error
        elif batch_number in self.failing or self.failing_ids & set(sequence_data):
            task.run.side_effect = self.error
            task.run_with_progress.side_effect = self.error
        else:
            task.run.return_value = result
            task.run_with_progress.return_value = result
        return task


def _predict(sequences: dict[str, str], fake: _FakeBiocentral):
    retriever = BiocentralPredictionRetriever(
        headers=list(sequences),
        annotations=["predicted_membrane"],
        sequences=sequences,
    )
    with patch("biocentral_api.BiocentralAPI", fake):
        rows = retriever.fetch_annotations()
    return retriever, {r.identifier: r.annotations["predicted_membrane"] for r in rows}


class TestBatchedPredictions:
    """Every unique sequence in one request is untested beyond a few thousand
    sequences; an example-scale run would be 100,000-485,000 in one call."""

    def test_sequences_are_sent_in_batches_of_at_most_1000(self):
        sequences = {f"P{i}": _seq(i) for i in range(2500)}
        fake = _FakeBiocentral()

        retriever, values = _predict(sequences, fake)

        assert [len(r) for r in fake.requests] == [1000, 1000, 500]
        assert fake.health_checks == 1
        assert not retriever.prediction_failed
        assert values == {pid: f"membrane:{seq}" for pid, seq in sequences.items()}

    def test_duplicates_are_submitted_once_and_fanned_out(self, monkeypatch):
        import sys

        monkeypatch.setattr(
            sys.modules[BiocentralPredictionRetriever.__module__], "_BATCH_SIZE", 2
        )
        a, b, c = _seq(1), _seq(2), _seq(3)
        # Duplicates of a and b land in later batches than their first copy.
        sequences = {"P0": a, "P1": b, "P2": c, "P3": a, "P4": b, "P5": a}
        fake = _FakeBiocentral()

        _, values = _predict(sequences, fake)

        submitted = [seq for r in fake.requests for seq in r.values()]
        assert sorted(submitted) == sorted([a, b, c])
        assert all(len(r) <= 2 for r in fake.requests)
        assert values == {pid: f"membrane:{seq}" for pid, seq in sequences.items()}

    def test_a_sequence_longer_than_2000_residues_is_submitted(self):
        long_seq = _seq(7, length=2500)
        sequences = {"SHORT": _seq(1), "LONG": long_seq}
        fake = _FakeBiocentral()

        retriever, values = _predict(sequences, fake)

        assert long_seq in fake.requests[0].values()
        assert values["LONG"] == f"membrane:{long_seq}"
        assert not retriever.prediction_failed


class TestSequenceLengthLimits:
    """The server refuses a whole request when any one sequence is shorter than
    7 or longer than 5,000 residues (422). Venom peptides and titin-sized
    proteins are real inputs, so one of them must not cost 999 neighbours
    their predictions, and cannot be predicted by retrying either."""

    def test_sequences_outside_the_limits_are_not_submitted(self, caplog):
        short, long_ = _seq(1, length=6), _seq(2, length=5001)
        edge_short, edge_long = _seq(3, length=7), _seq(4, length=5000)
        sequences = {
            "SHORT": short,
            "LONG": long_,
            "EDGE7": edge_short,
            "EDGE5000": edge_long,
            "DUP_SHORT": short,
        }
        fake = _FakeBiocentral()

        with caplog.at_level("WARNING"):
            retriever, values = _predict(sequences, fake)

        submitted = {seq for r in fake.requests for seq in r.values()}
        assert submitted == {edge_short, edge_long}
        assert values == {
            "SHORT": "",
            "LONG": "",
            "EDGE7": f"membrane:{edge_short}",
            "EDGE5000": f"membrane:{edge_long}",
            "DUP_SHORT": "",
        }
        # A length the server cannot predict is a genuine absence, not a
        # fetch failure: the source stays cacheable.
        assert not retriever.prediction_failed

        notes = [r for r in caplog.records if "cannot predict" in r.getMessage()]
        assert len(notes) == 1
        assert notes[0].levelname == "WARNING"
        assert "3 of 5 proteins" in notes[0].getMessage()
        text = notes[0].getMessage().lower()
        assert not [p for p in _BIOCENTRAL_DOWN_PATTERNS if p in text]

    def test_a_batch_refused_for_a_named_sequence_is_resent_without_it(self):
        """Should the server's limits differ from ours, the 422 names the
        sequence; the batch is sent again without it."""
        sequences = {f"P{i}": _seq(i) for i in range(5)}
        fake = _FakeBiocentral(rejects={"P2"})

        retriever, values = _predict(sequences, fake)

        assert len(fake.requests) == 2
        assert "P2" not in fake.requests[1]
        assert values["P2"] == ""
        for pid in ("P0", "P1", "P3", "P4"):
            assert values[pid] == f"membrane:{sequences[pid]}"
        assert not retriever.prediction_failed

    def test_refusal_resends_are_bounded_then_the_batch_is_split(self):
        """Each refusal removes one sequence and resends; after five resends a
        batch still refused is split like any other failure, so refusals add
        to the seven requests the split alone may send."""
        sequences = {f"P{i}": _seq(i) for i in range(8)}
        fake = _FakeBiocentral(rejects={f"P{i}" for i in range(7)})

        retriever, values = _predict(sequences, fake)

        assert [len(r) for r in fake.requests] == [8, 7, 6, 5, 4, 3, 1, 1]
        assert values["P7"] == f"membrane:{sequences['P7']}"
        assert all(values[f"P{i}"] == "" for i in range(7))
        assert not retriever.prediction_failed

    def test_an_unexplained_rejection_still_fails_the_batch(self):
        sequences = {f"P{i}": _seq(i) for i in range(3)}
        fake = _FakeBiocentral(failing={1, 2, 3, 4, 5, 6, 7}, error=RuntimeError("x"))

        retriever, values = _predict(sequences, fake)

        assert retriever.prediction_failed
        assert set(values.values()) == {""}


class TestResidueBudget:
    """The server's models fail on a request of about 500K residues (820
    phosphatases) that succeeds as two halves of 250K, so batches are bounded
    by total residues as well as by count, and a failed batch is split."""

    def test_batches_stay_under_the_residue_budget(self, monkeypatch):
        import sys

        module = sys.modules[BiocentralPredictionRetriever.__module__]
        monkeypatch.setattr(module, "_MAX_BATCH_RESIDUES", 100)
        sequences = {f"P{i}": _seq(i, length=30) for i in range(10)}
        fake = _FakeBiocentral()

        retriever, values = _predict(sequences, fake)

        assert [len(r) for r in fake.requests] == [3, 3, 3, 1]
        assert all(sum(map(len, r.values())) <= 100 for r in fake.requests)
        assert not retriever.prediction_failed
        assert values == {pid: f"membrane:{seq}" for pid, seq in sequences.items()}

    def test_a_sequence_over_the_budget_is_sent_on_its_own(self, monkeypatch):
        import sys

        module = sys.modules[BiocentralPredictionRetriever.__module__]
        monkeypatch.setattr(module, "_MAX_BATCH_RESIDUES", 100)
        sequences = {"A": _seq(1, 30), "BIG": _seq(2, 150), "C": _seq(3, 30)}
        fake = _FakeBiocentral()

        _, values = _predict(sequences, fake)

        assert [sorted(r) for r in fake.requests] == [["A"], ["BIG"], ["C"]]
        assert values["BIG"] == f"membrane:{sequences['BIG']}"

    def test_a_failed_batch_is_split_and_its_halves_resent(self):
        sequences = {f"P{i}": _seq(i) for i in range(8)}
        fake = _FakeBiocentral(failing={1})

        retriever, values = _predict(sequences, fake)

        assert [len(r) for r in fake.requests] == [8, 4, 4]
        assert not retriever.prediction_failed
        assert values == {pid: f"membrane:{seq}" for pid, seq in sequences.items()}

    def test_splitting_stops_after_two_levels(self):
        sequences = {f"P{i}": _seq(i) for i in range(8)}
        fake = _FakeBiocentral(failing=set(range(1, 20)))

        retriever, _ = _predict(sequences, fake)

        # 1 whole batch + 2 halves + 4 quarters, then it gives up.
        assert len(fake.requests) == 7
        assert retriever.prediction_failed


class TestFailedBatch:
    """A failed batch loses only its own proteins, and says so without
    reading as a service outage."""

    def test_the_other_batches_keep_their_predictions(self, caplog):
        sequences = {f"P{i}": _seq(i) for i in range(2500)}
        fake = _FakeBiocentral(failing_ids={f"P{i}" for i in range(1000, 2000)})

        with caplog.at_level("WARNING"):
            retriever, values = _predict(sequences, fake)

        failed_ids = set(fake.requests[1])
        assert len(failed_ids) == 1000
        for pid, seq in sequences.items():
            expected = "" if pid in failed_ids else f"membrane:{seq}"
            assert values[pid] == expected
        assert retriever.prediction_failed

        summary = [r for r in caplog.records if "missing for" in r.getMessage()]
        assert len(summary) == 1
        assert summary[0].levelname == "WARNING"
        assert "1,000 of 2,500 proteins" in summary[0].getMessage()
        assert "1 of 3 batches" in summary[0].getMessage()

    def test_a_duplicate_of_a_failed_sequence_is_counted_missing(self, caplog):
        import sys

        module = sys.modules[BiocentralPredictionRetriever.__module__]
        a, b = _seq(1), _seq(2)
        sequences = {"P0": a, "P1": b, "P2": a}
        fake = _FakeBiocentral(failing={1})

        with (
            patch.object(module, "_BATCH_SIZE", 1),
            caplog.at_level("WARNING"),
        ):
            _, values = _predict(sequences, fake)

        assert values == {"P0": "", "P1": f"membrane:{b}", "P2": ""}
        summary = [r for r in caplog.records if "missing for" in r.getMessage()]
        assert "2 of 3 proteins" in summary[0].getMessage()

    def test_the_shortfall_report_cannot_be_mistaken_for_an_outage(self, caplog):
        """The prep service substring-matches stderr to classify a failure as
        BIOCENTRAL_UNAVAILABLE. A coverage shortfall is not an outage, even
        when the batch itself failed with an outage-looking error."""
        sequences = {f"P{i}": _seq(i) for i in range(1500)}
        fake = _FakeBiocentral(
            failing_ids={f"P{i}" for i in range(1000)},
            error=ConnectionError("503 Server Error: connection refused"),
        )

        with caplog.at_level("WARNING"):
            _predict(sequences, fake)

        summary = [r for r in caplog.records if "missing for" in r.getMessage()]
        assert len(summary) == 1
        text = summary[0].getMessage().lower()
        assert not [p for p in _BIOCENTRAL_DOWN_PATTERNS if p in text]

    def test_every_batch_failing_marks_the_source_failed(self):
        sequences = {f"P{i}": _seq(i) for i in range(3)}
        fake = _FakeBiocentral(failing_ids=set(sequences))

        retriever, values = _predict(sequences, fake)

        assert retriever.prediction_failed
        assert set(values.values()) == {""}
