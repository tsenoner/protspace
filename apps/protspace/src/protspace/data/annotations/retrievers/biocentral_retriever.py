"""Biocentral API prediction retriever for per-protein annotations."""

import logging
import re
import warnings

from tqdm import tqdm

from protspace.data.annotations.retrievers.base_retriever import BaseAnnotationRetriever
from protspace.data.biocentral_connection import BIOCENTRAL_URL, wait_for_server

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

# Unique sequences per prediction request. One request with every sequence is
# untested beyond a few thousand, and an example-scale run is 100K-485K.
_BATCH_SIZE = 1000

# The server's per-sequence length limits (the same on v1.2.1 and v2.0.1). It
# answers a request holding any sequence outside them with 422 for the whole
# request, so such sequences are never sent: they cannot be predicted at all.
_MIN_SEQUENCE_LENGTH = 7
_MAX_SEQUENCE_LENGTH = 5000
# How a 422 names the offending sequence, should the server's limits change.
_REFUSED_SEQUENCE = re.compile(r"(\S+) is too (?:short|long)\b")
# Resends of one batch after the server names a refused sequence.
_MAX_REFUSAL_RESENDS = 5
# Total residues per request. The models fail on ~500K (820 phosphatases) and
# succeed on the same sequences as two requests of ~250K each.
_MAX_BATCH_RESIDUES = 200_000
# A batch that fails for no stated reason is split in half and resent, at most
# this many levels deep (1 + 2 + 4 requests), so an outage is not hammered.
_MAX_SPLIT_DEPTH = 2


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
        # Set when any predictions could not be produced (no healthy server, or
        # a failed batch), so empty predictions are not mistaken for negative
        # ones and the source is kept out of the cache.
        self.prediction_failed = False

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
            Dict of Prediction lists keyed by the submitted (representative)
            identifier, as the server returns them; ``_extract_annotation`` also
            accepts a sequence-hash key.
        """
        from biocentral_api import BiocentralAPI, BiocentralPredictionModel

        try:
            api = wait_for_server(BiocentralAPI(fixed_server_url=BIOCENTRAL_URL))
        except Exception as e:
            self.prediction_failed = True
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

        # Representatives the server cannot predict: never a fetch failure,
        # so their empty columns are genuine absences and stay cacheable.
        unpredictable = {
            header
            for header, seq in seq_data.items()
            if not _MIN_SEQUENCE_LENGTH <= len(seq) <= _MAX_SEQUENCE_LENGTH
        }
        for header in unpredictable:
            del seq_data[header]

        batches = self._batches(seq_data)
        logger.info(
            f"Running Biocentral predictions ({', '.join(m.name for m in model_enums)}) "
            f"for {len(seq_data)} proteins in {len(batches)} batch(es)..."
        )

        predictions: dict = {}
        failed_representatives: set[str] = set()
        failed_batches = 0
        with tqdm(
            total=len(seq_data), desc="Fetching Biocentral predictions", unit="seq"
        ) as pbar:
            for number, batch in enumerate(batches, 1):
                label = (
                    f"Biocentral prediction batch {number} of {len(batches)} "
                    f"({len(batch)} sequences)"
                )
                batch_predictions, batch_failed = self._predict_with_fallbacks(
                    api, model_enums, batch, unpredictable, label
                )
                # Keyed by the batch's own representative identifiers, which
                # are unique across batches, so merging cannot clash.
                predictions.update(batch_predictions)
                if batch_failed:
                    failed_batches += 1
                    failed_representatives.update(batch_failed)
                pbar.update(len(batch))

        if unpredictable:
            skipped = sum(
                1
                for header in all_seqs
                if self._seq_duplicates.get(header, header) in unpredictable
            )
            # A length limit, not a shortfall: these are left empty and cached.
            logger.warning(
                f"Biocentral cannot predict {skipped:,} of {len(all_seqs):,} "
                f"proteins (shorter than {_MIN_SEQUENCE_LENGTH} or longer than "
                f"{_MAX_SEQUENCE_LENGTH:,} residues); their predictions stay empty"
            )

        if failed_batches:
            self.prediction_failed = True
            missing = sum(
                1
                for header in all_seqs
                if self._seq_duplicates.get(header, header) in failed_representatives
            )
            # Worded as a coverage shortfall on purpose: the prep service reads
            # outage phrases on stderr as "Biocentral is down", and this is not.
            logger.warning(
                f"Biocentral predictions missing for {missing:,} of "
                f"{len(all_seqs):,} proteins ({failed_batches} of {len(batches)} "
                "batches failed); they are not cached and will be requested again"
            )
        return predictions

    @staticmethod
    def _batches(seq_data: dict[str, str]) -> list[dict[str, str]]:
        """Split unique sequences into consecutive batches of at most
        ``_BATCH_SIZE`` sequences and ``_MAX_BATCH_RESIDUES`` residues (a longer
        sequence gets a batch of its own)."""
        batches: list[dict[str, str]] = []
        current: dict[str, str] = {}
        residues = 0
        for header, seq in seq_data.items():
            if current and (
                len(current) >= _BATCH_SIZE or residues + len(seq) > _MAX_BATCH_RESIDUES
            ):
                batches.append(current)
                current, residues = {}, 0
            current[header] = seq
            residues += len(seq)
        if current:
            batches.append(current)
        return batches

    @classmethod
    def _predict_with_fallbacks(
        cls,
        api,
        model_enums: list,
        batch: dict[str, str],
        unpredictable: set[str],
        label: str,
        depth: int = 0,
    ) -> tuple[dict, set[str]]:
        """Predict one batch; return its predictions and the representatives
        left without any.

        A sequence the server refuses on length is added to *unpredictable* and
        the batch resent without it. A batch that fails otherwise, or comes back
        empty, is split in half and each half resent, ``_MAX_SPLIT_DEPTH`` levels
        deep, so one bad request loses as few proteins as possible.
        """
        remaining = dict(batch)
        for _ in range(_MAX_REFUSAL_RESENDS + 1):
            if not remaining:
                return {}, set()
            try:
                result = cls._predict_batch(api, model_enums, remaining)
            except Exception as e:
                refused = set(_REFUSED_SEQUENCE.findall(str(e))) & set(remaining)
                if refused:
                    unpredictable.update(refused)
                    for header in refused:
                        del remaining[header]
                    continue
                reason = f"failed: {e}"
            else:
                if result:
                    return result, set()
                reason = "returned no predictions"
            break
        else:
            reason = f"was refused {_MAX_REFUSAL_RESENDS + 1} times"

        if depth < _MAX_SPLIT_DEPTH and len(remaining) > 1:
            items = list(remaining.items())
            half = len(items) // 2
            predictions: dict = {}
            failed: set[str] = set()
            for part in (dict(items[:half]), dict(items[half:])):
                part_predictions, part_failed = cls._predict_with_fallbacks(
                    api, model_enums, part, unpredictable, label, depth + 1
                )
                predictions.update(part_predictions)
                failed |= part_failed
            return predictions, failed

        scope = f"{label}" if depth == 0 else f"{label}, a part of {len(remaining)}"
        logger.warning(f"{scope} {reason}")
        return {}, set(remaining)

    @staticmethod
    def _predict_batch(api, model_enums: list, batch: dict[str, str]) -> dict | None:
        """Run one prediction request; results are keyed by submitted identifier."""
        with warnings.catch_warnings():
            # Long sequences are predicted like any other: their length alone
            # must never make the source fail.
            warnings.filterwarnings(
                "ignore",
                message=".*longer than the recommended.*",
                category=UserWarning,
            )
            # .run(), not .run_with_progress(): one bar covers the whole source.
            return api.predict(model_names=model_enums, sequence_data=batch).run()

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

        Returns: 'alpha-helical', 'beta-barrel', or 'non-transmembrane', and
        '' when TMbed predicted nothing
        """
        for pred in predictions:
            if pred.model_name == "TMbed":
                topology = str(pred.value) if pred.value else ""
                if not topology:
                    # No topology is no prediction, not a negative one.
                    return ""
                has_helix = bool(re.search(r"[Hh]", topology))
                has_beta = bool(re.search(r"[Bb]", topology))
                if has_helix and has_beta:
                    return "alpha-helical;beta-barrel"
                elif has_helix:
                    return "alpha-helical"
                elif has_beta:
                    return "beta-barrel"
                # Not "none": the CLI and the web app both read that as a
                # missing value, which showed every negative prediction as N/A.
                return "non-transmembrane"
        return ""
