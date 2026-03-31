"""Tests for Biocentral prediction retriever."""

from unittest.mock import MagicMock, patch

from src.protspace.data.annotations.retrievers.biocentral_retriever import (
    BIOCENTRAL_ANNOTATIONS,
    BiocentralPredictionRetriever,
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
        assert result == "none"

    def test_lowercase_labels(self):
        """TMbed uses lowercase h/b for non-TM side of helix/strand."""
        preds = [_make_prediction("TMbed", "ooohhHHHHHhhoooo")]
        result = BiocentralPredictionRetriever._extract_transmembrane(preds)
        assert result == "alpha-helical"

    def test_no_tmbed_prediction(self):
        preds = [_make_prediction("OtherModel", "something")]
        result = BiocentralPredictionRetriever._extract_transmembrane(preds)
        assert result == ""


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
