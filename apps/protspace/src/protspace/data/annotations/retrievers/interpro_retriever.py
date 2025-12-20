import hashlib
import logging
from collections import namedtuple
from typing import NamedTuple

import requests
from tqdm import tqdm

from protspace.data.annotations.retrievers.base_retriever import BaseAnnotationRetriever

logging.basicConfig(format="%(levelname)s: %(message)s")
logger = logging.getLogger(__name__)

# InterPro annotations - supported databases
# Keys are used for CLI naming and dataset creation
# Values are used when accessing the JSON output from the InterPro API
INTERPRO_MAPPING = {
    "pfam": "pfam",
    "superfamily": "superfamily",
    "cath": "cath-gene3d",
    "signal_peptide": "phobius",
}

# List of supported InterPro annotations for easy access
INTERPRO_ANNOTATIONS = list(INTERPRO_MAPPING.keys())

# API Configuration
BASE_URL = "https://www.ebi.ac.uk/interpro/matches/api"
CHUNK_SIZE = 100  # As per API documentation for batch requests

ProteinAnnotations = namedtuple("ProteinAnnotations", ["identifier", "annotations"])


class InterProRetriever(BaseAnnotationRetriever):
    """
    Retrieves InterPro domain annotations for proteins using the InterPro API.

    Supports fetching annotations from:
    - Pfam (key: pfam)
    - SUPERFAMILY (key: superfamily)
    - CATH-Gene3D (key: cath)
    - Phobius signal peptides (key: signal_peptide)

    Annotations are stored with confidence scores in a pipe-separated format:
    - Format: accession(name)|score1,score2,score3;accession2|score1
    - Name (if available) is included in parentheses after the accession
    - | separates accession from scores
    - , separates multiple scores for the same accession (when it appears multiple times)
    - ; separates different accessions
    - Count is inferred from the number of comma-separated scores

    Example: 'pfam': 'PF00001 (7tm_1)|50.2,52.1,51.0;PF00002 (7tm_2)|60.5'
    """

    def __init__(
        self,
        headers: list[str] = None,
        annotations: list[str] = None,
        sequences: dict[str, str] = None,
    ):
        """
        Initialize the InterPro annotation retriever.

        Args:
            headers: List of protein identifiers
            annotations: List of InterPro database annotations to fetch (pfam, superfamily, cath, signal_peptide)
            sequences: Dictionary mapping protein identifiers to their sequences (needed for MD5 calculation)
        """
        super().__init__(headers, annotations)
        self.headers = self._manage_headers(self.headers) if self.headers else []
        self.annotations = (
            self.annotations if self.annotations else INTERPRO_ANNOTATIONS
        )
        self.sequences = sequences if sequences else {}

        # Validate annotations
        invalid_annotations = [
            f for f in self.annotations if f not in INTERPRO_ANNOTATIONS
        ]
        if invalid_annotations:
            logger.warning(
                f"Invalid InterPro annotations: {invalid_annotations}. Supported: {INTERPRO_ANNOTATIONS}"
            )
            self.annotations = [
                f for f in self.annotations if f in INTERPRO_ANNOTATIONS
            ]

    def fetch_annotations(self) -> list[NamedTuple]:
        """
        Fetch InterPro annotations for all proteins.

        Returns:
            List of ProteinAnnotations namedtuples containing identifier and annotations
        """
        if not self.headers:
            logger.warning("No headers provided for InterPro annotation retrieval")
            return []

        if not self.sequences:
            logger.warning(
                "No sequences provided for InterPro annotation retrieval. MD5 calculation requires sequences."
            )
            return []

        # Calculate MD5 hashes for sequences
        md5_to_identifier = {}
        missing_sequences = []

        for header in self.headers:
            if header in self.sequences:
                sequence = self.sequences[header]
                md5_hash = hashlib.md5(sequence.encode("utf-8")).hexdigest().upper()
                md5_to_identifier[md5_hash] = header
            else:
                missing_sequences.append(header)

        if missing_sequences:
            logger.warning(
                f"Missing sequences for {len(missing_sequences)} proteins: {missing_sequences[:5]}..."
            )

        if not md5_to_identifier:
            logger.error("No valid sequences found for MD5 calculation")
            return []

        # Fetch InterPro matches
        md5s = list(md5_to_identifier.keys())
        api_results = self._get_matches_in_batches(md5s)

        if not api_results:
            logger.warning("No results returned from InterPro API")
            return []

        # Parse results and create annotations
        return self._parse_interpro_results(api_results, md5_to_identifier)

    def _get_matches_in_batches(self, md5s: list[str]) -> list[dict]:
        """
        Submit MD5 hashes to InterPro API in batches.

        Args:
            md5s: List of MD5 hashes to query

        Returns:
            List of API result dictionaries
        """
        all_results = []
        chunks = [md5s[i : i + CHUNK_SIZE] for i in range(0, len(md5s), CHUNK_SIZE)]

        logger.info(
            f"Submitting {len(md5s)} sequences to InterPro API in {len(chunks)} batch(es)..."
        )

        with tqdm(
            total=len(md5s), desc="Fetching InterPro annotations", unit="seq"
        ) as pbar:
            for i, chunk in enumerate(chunks, 1):
                post_url = f"{BASE_URL}/matches"
                payload = {"md5": chunk}

                try:
                    response = requests.post(
                        post_url,
                        json=payload,
                        headers={"Accept": "application/json"},
                        timeout=30,
                    )

                    if response.status_code == 200:
                        batch_results = response.json().get("results", [])
                        all_results.extend(batch_results)
                        logger.debug(
                            f"Batch {i}/{len(chunks)} successful. Received {len(batch_results)} results."
                        )
                    else:
                        logger.error(
                            f"Error processing batch {i}: {response.status_code} - {response.text}"
                        )

                except requests.exceptions.RequestException as e:
                    logger.error(f"Request error for batch {i}: {e}")

                pbar.update(len(chunk))

        logger.info(f"Retrieved {len(all_results)} total results from InterPro API")
        return all_results

    def _parse_interpro_results(
        self, api_results: list[dict], md5_to_identifier: dict[str, str]
    ) -> list[NamedTuple]:
        """
        Parse InterPro API results and extract relevant annotations with confidence scores.

        Args:
            api_results: Raw API results from InterPro
            md5_to_identifier: Mapping from MD5 hash to protein identifier

        Returns:
            List of ProteinAnnotations with parsed InterPro data in pipe-separated format:
            - Format: accession(name)|score1,score2,score3;accession2|score1
            - Example: 'pfam': 'PF00001 (7tm_1)|50.2,52.1,51.0;PF00002 (7tm_2)|60.5'

            All scores for each accession are collected and stored together.
            Names (if available) are included in parentheses after the accession.
        """
        # Create reverse mapping from API database names to our keys
        api_to_key = {v: k for k, v in INTERPRO_MAPPING.items()}

        # Initialize annotation dictionary for each protein
        # Store accessions, names, and scores separately to maintain correspondence
        protein_annotations = {}
        for identifier in md5_to_identifier.values():
            protein_annotations[identifier] = {
                annotation: {"accessions": [], "names": [], "scores": []}
                for annotation in self.annotations
            }

        # Parse API results
        for result in api_results:
            sequence_md5 = result.get("md5")
            if not result.get("found") or sequence_md5 not in md5_to_identifier:
                continue

            protein_id = md5_to_identifier[sequence_md5]

            for match in result.get("matches", []):
                signature = match.get("signature", {})
                sig_lib = signature.get("signatureLibraryRelease", {})
                source_db = sig_lib.get("library", "").lower()

                # Map API database name to our key and check if we're interested in it
                if source_db in api_to_key:
                    annotation_key = api_to_key[source_db]
                    if annotation_key in self.annotations:
                        signature_accession = signature.get("accession", "")
                        if signature_accession:
                            # Extract name and confidence score from match
                            signature_name = signature.get("name", "")
                            score = match.get("score")

                            protein_annotations[protein_id][annotation_key][
                                "accessions"
                            ].append(signature_accession)
                            # Store name, using empty string if not available
                            protein_annotations[protein_id][annotation_key][
                                "names"
                            ].append(signature_name)
                            # Store score, using empty string if not available
                            protein_annotations[protein_id][annotation_key][
                                "scores"
                            ].append(str(score) if score is not None else "")

        # Convert to ProteinAnnotations objects
        result = []
        for identifier, annotations_dict in protein_annotations.items():
            # Convert to pipe-separated format: accession|score1,score2;accession2|score1
            processed_annotations = {}
            for annotation_name, annotation_data in annotations_dict.items():
                accessions = annotation_data["accessions"]
                names = annotation_data["names"]
                scores = annotation_data["scores"]

                if accessions:
                    # Group all scores by accession (collect all occurrences)
                    # Also track the name for each accession (use first non-empty name if multiple)
                    accession_to_scores = {}
                    accession_to_name = {}
                    for acc, name, sc in zip(accessions, names, scores, strict=True):
                        if acc not in accession_to_scores:
                            accession_to_scores[acc] = []
                            accession_to_name[acc] = name
                        # Only add non-empty scores
                        if sc:
                            accession_to_scores[acc].append(sc)
                        # Update name if current one is empty but we have a name
                        if not accession_to_name[acc] and name:
                            accession_to_name[acc] = name

                    # Sort by accession for consistency
                    sorted_accessions = sorted(accession_to_scores.keys())

                    # Format as: accession(name)|score1,score2,score3;accession2|score1
                    formatted_parts = []
                    for acc in sorted_accessions:
                        score_list = accession_to_scores[acc]
                        name = accession_to_name[acc]

                        # Format accession with name if available
                        if name:
                            acc_with_name = f"{acc} ({name})"
                        else:
                            acc_with_name = acc

                        if score_list:
                            # Format: accession(name)|score1,score2,score3
                            formatted_parts.append(
                                f"{acc_with_name}|{','.join(score_list)}"
                            )
                        else:
                            # If no scores, just include accession (with name if available)
                            formatted_parts.append(acc_with_name)

                    processed_annotations[annotation_name] = ";".join(formatted_parts)
                else:
                    processed_annotations[annotation_name] = ""

            result.append(
                ProteinAnnotations(
                    identifier=identifier, annotations=processed_annotations
                )
            )

        logger.info(f"Processed InterPro annotations for {len(result)} proteins")
        return result

    def _manage_headers(self, headers: list[str]) -> list[str]:
        """
        Extract protein identifiers from FASTA headers.

        For UniProt headers like 'sp|P12345|PROTEIN_MOUSE', extracts 'P12345'
        For other headers, uses the second part after splitting by '|'

        Args:
            headers: List of protein headers/identifiers

        Returns:
            List of managed protein identifiers
        """
        managed_headers = []
        prefixes = ["sp|", "tr|"]

        for header in headers:
            header_lower = header.lower()
            if any(header_lower.startswith(prefix) for prefix in prefixes):
                # For UniProt headers, extract the accession (second part)
                parts = header.split("|")
                if len(parts) >= 2:
                    managed_headers.append(parts[1])
                else:
                    managed_headers.append(header)
            else:
                # For other headers, try to extract the second part after '|'
                parts = header.split("|")
                if len(parts) >= 2:
                    managed_headers.append(parts[1])
                else:
                    managed_headers.append(header)

        return managed_headers
