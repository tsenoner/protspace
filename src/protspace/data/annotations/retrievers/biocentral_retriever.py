"""Biocentral API prediction retriever for per-protein annotations."""

import logging
import re

from protspace.data.annotations.retrievers.base_retriever import BaseAnnotationRetriever

logger = logging.getLogger(__name__)

BIOCENTRAL_ANNOTATIONS = [
    "predicted_subcellular_location",
    "predicted_membrane",
    "predicted_signal_peptide",
    "predicted_transmembrane",
]

# Biocentral prediction models used for each annotation
_PREDICTION_MODELS = {
    "predicted_subcellular_location": "LIGHTATTENTIONSUBCELLULARLOCALIZATION",
    "predicted_membrane": "LIGHTATTENTIONMEMBRANE",
    "predicted_signal_peptide": "TMBED",
    "predicted_transmembrane": "TMBED",
}

_BATCH_SIZE = 1000


class BiocentralPredictionRetriever(BaseAnnotationRetriever):
    """Retrieves prediction annotations from the Biocentral API."""

    def __init__(
        self,
        headers: list[str] = None,
        annotations: list = None,
        sequences: dict[str, str] = None,
    ):
        # Don't call super().__init__() — custom initialization
        self.headers = headers or []
        self.annotations = annotations or BIOCENTRAL_ANNOTATIONS
        self.sequences = sequences or {}

    def fetch_annotations(self) -> list[tuple]:
        """Fetch prediction annotations for all proteins."""
        from protspace.data.annotations.retrievers.uniprot_retriever import (
            ProteinAnnotations,
        )

        if not self.sequences or not any(self.sequences.values()):
            logger.debug("No sequences available for Biocentral predictions")
            return [
                ProteinAnnotations(
                    identifier=h,
                    annotations=dict.fromkeys(self.annotations, ""),
                )
                for h in self.headers
            ]

        # Determine which models we need
        models_needed = set()
        for ann in self.annotations:
            model = _PREDICTION_MODELS.get(ann)
            if model:
                models_needed.add(model)

        if not models_needed:
            return []

        # Run predictions via Biocentral API
        predictions = self._run_predictions(models_needed)

        # Build results
        result = []
        for header in self.headers:
            ann_dict = {}
            for ann_name in self.annotations:
                ann_dict[ann_name] = self._extract_annotation(
                    ann_name, header, predictions
                )
            result.append(ProteinAnnotations(identifier=header, annotations=ann_dict))

        return result

    def _run_predictions(self, models_needed: set[str]) -> dict:
        """Run Biocentral predictions and return raw results.

        Returns:
            Dict keyed by sequence hash, values are lists of Prediction objects.
        """
        from biocentral_api import BiocentralAPI, BiocentralPredictionModel

        try:
            api = BiocentralAPI(fixed_server_url="https://biocentral.rostlab.org")
            api = api.wait_until_healthy(max_wait_seconds=30)
        except Exception as e:
            logger.warning(f"Biocentral API not available: {e}")
            return {}

        # Map model names to enum values
        model_enums = []
        for model_name in models_needed:
            try:
                model_enums.append(BiocentralPredictionModel[model_name])
            except KeyError:
                logger.warning(f"Unknown Biocentral model: {model_name}")

        if not model_enums:
            return {}

        # Prepare sequence data — deduplicate (API rejects duplicate sequences)
        # Filter out empty sequences
        all_seqs = {
            h: self.sequences[h]
            for h in self.headers
            if h in self.sequences and self.sequences[h]
        }
        seen_seqs: dict[str, str] = {}  # seq → first header
        seq_data: dict[str, str] = {}  # header → seq (unique only)
        self._seq_duplicates: dict[str, str] = {}  # header → representative header

        for header, seq in all_seqs.items():
            if seq in seen_seqs:
                self._seq_duplicates[header] = seen_seqs[seq]
            else:
                seen_seqs[seq] = header
                seq_data[header] = seq

        if len(all_seqs) != len(seq_data):
            logger.info(
                f"Deduplicated {len(all_seqs)} → {len(seq_data)} unique sequences"
            )

        logger.info(
            f"Running Biocentral predictions ({', '.join(m.name for m in model_enums)}) "
            f"for {len(seq_data)} proteins..."
        )

        try:
            result = api.predict(
                model_names=model_enums,
                sequence_data=seq_data,
            ).run_with_progress()
            return result
        except Exception as e:
            logger.warning(f"Biocentral prediction failed: {e}")
            return {}

    def _extract_annotation(self, ann_name: str, header: str, predictions: dict) -> str:
        """Extract a specific annotation value for a protein from predictions."""
        if not predictions:
            return ""

        # For deduplicated sequences, use the representative header
        lookup_header = getattr(self, "_seq_duplicates", {}).get(header, header)

        seq = self.sequences.get(lookup_header, "")
        if not seq:
            return ""

        # Biocentral keys predictions by sequence hash
        import hashlib

        seq_hash = hashlib.sha256(seq.encode()).hexdigest()

        protein_preds = predictions.get(seq_hash, [])
        if not protein_preds:
            protein_preds = predictions.get(lookup_header, [])

        if not protein_preds:
            return ""

        if ann_name == "predicted_subcellular_location":
            return self._extract_per_sequence(
                protein_preds, "LightAttentionSubcellularLocalization"
            )
        elif ann_name == "predicted_membrane":
            return self._extract_per_sequence(protein_preds, "LightAttentionMembrane")
        elif ann_name == "predicted_signal_peptide":
            return self._extract_signal_peptide(protein_preds)
        elif ann_name == "predicted_transmembrane":
            return self._extract_transmembrane(protein_preds)

        return ""

    @staticmethod
    def _extract_per_sequence(predictions: list, model_name: str) -> str:
        """Extract a per-sequence prediction value."""
        for pred in predictions:
            if pred.model_name == model_name:
                return str(pred.value) if pred.value else ""
        return ""

    @staticmethod
    def _extract_signal_peptide(predictions: list) -> str:
        """Derive signal peptide presence from TMbed per-residue output.

        TMbed labels: S = signal peptide, H/h = TM helix, B/b = TM beta, i/o = non-TM
        """
        for pred in predictions:
            if pred.model_name == "TMbed":
                topology = str(pred.value) if pred.value else ""
                return "True" if "S" in topology else "False"
        return ""

    @staticmethod
    def _extract_transmembrane(predictions: list) -> str:
        """Derive transmembrane type from TMbed per-residue output.

        Returns: 'alpha-helical', 'beta-barrel', or 'none'
        """
        for pred in predictions:
            if pred.model_name == "TMbed":
                topology = str(pred.value) if pred.value else ""
                has_helix = bool(re.search(r"[Hh]", topology))
                has_beta = bool(re.search(r"[Bb]", topology))
                if has_helix and has_beta:
                    return "alpha-helical;beta-barrel"
                elif has_helix:
                    return "alpha-helical"
                elif has_beta:
                    return "beta-barrel"
                return "none"
        return ""
