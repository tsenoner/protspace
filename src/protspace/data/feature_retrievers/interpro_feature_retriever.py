import logging
import requests
import hashlib
from typing import List, NamedTuple, Dict
from tqdm import tqdm
from collections import namedtuple

logging.basicConfig(format="%(levelname)s: %(message)s")
logger = logging.getLogger(__name__)

# InterPro features - supported databases
# Keys are used for CLI naming and dataset creation
# Values are used when accessing the JSON output from the InterPro API
INTERPRO_MAPPING = {
    "pfam": "pfam",
    "superfamily": "superfamily", 
    "cath": "cath-gene3d",
    "signal_peptide": "phobius"
}

# List of supported InterPro features for easy access
INTERPRO_FEATURES = list(INTERPRO_MAPPING.keys())

# API Configuration
BASE_URL = "https://www.ebi.ac.uk/interpro/matches/api"
CHUNK_SIZE = 100  # As per API documentation for batch requests

ProteinFeatures = namedtuple("ProteinFeatures", ["identifier", "features"])


class InterProFeatureRetriever:
    """
    Retrieves InterPro domain features for proteins using the InterPro API.

    Supports fetching features from:
    - Pfam (key: pfam)
    - SUPERFAMILY (key: superfamily)
    - CATH-Gene3D (key: cath)
    """

    def __init__(
        self,
        headers: List[str] = None,
        features: List[str] = None,
        sequences: Dict[str, str] = None,
    ):
        """
        Initialize the InterPro feature retriever.

        Args:
            headers: List of protein identifiers
            features: List of InterPro database features to fetch (pfam, superfamily, cath)
            sequences: Dictionary mapping protein identifiers to their sequences (needed for MD5 calculation)
        """
        self.headers = self._manage_headers(headers) if headers else []
        self.features = features if features else INTERPRO_FEATURES
        self.sequences = sequences if sequences else {}

        # Validate features
        invalid_features = [f for f in self.features if f not in INTERPRO_FEATURES]
        if invalid_features:
            logger.warning(
                f"Invalid InterPro features: {invalid_features}. Supported: {INTERPRO_FEATURES}"
            )
            self.features = [f for f in self.features if f in INTERPRO_FEATURES]

    def fetch_features(self) -> List[NamedTuple]:
        """
        Fetch InterPro features for all proteins.

        Returns:
            List of ProteinFeatures namedtuples containing identifier and features
        """
        if not self.headers:
            logger.warning("No headers provided for InterPro feature retrieval")
            return []

        if not self.sequences:
            logger.warning(
                "No sequences provided for InterPro feature retrieval. MD5 calculation requires sequences."
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

        # Parse results and create features
        return self._parse_interpro_results(api_results, md5_to_identifier)

    def _get_matches_in_batches(self, md5s: List[str]) -> List[Dict]:
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
            total=len(md5s), desc="Fetching InterPro features", unit="seq"
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
        self, api_results: List[Dict], md5_to_identifier: Dict[str, str]
    ) -> List[NamedTuple]:
        """
        Parse InterPro API results and extract relevant features.

        Args:
            api_results: Raw API results from InterPro
            md5_to_identifier: Mapping from MD5 hash to protein identifier

        Returns:
            List of ProteinFeatures with parsed InterPro data
        """
        # Create reverse mapping from API database names to our keys
        api_to_key = {v: k for k, v in INTERPRO_MAPPING.items()}
        
        # Initialize feature dictionary for each protein
        protein_features = {}
        for identifier in md5_to_identifier.values():
            protein_features[identifier] = {feature: [] for feature in self.features}

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
                    feature_key = api_to_key[source_db]
                    if feature_key in self.features:
                        signature_accession = signature.get("accession", "")
                        if signature_accession:
                            protein_features[protein_id][feature_key].append(
                                signature_accession
                            )

        # Convert to ProteinFeatures objects
        result = []
        for identifier, features_dict in protein_features.items():
            # Convert lists to comma-separated strings (similar to UniProt format)
            processed_features = {}
            for feature_name, feature_list in features_dict.items():
                if feature_list:
                    # Remove duplicates and sort for consistency
                    unique_features = sorted(list(set(feature_list)))
                    processed_features[feature_name] = ";".join(unique_features)
                else:
                    processed_features[feature_name] = ""

            result.append(
                ProteinFeatures(identifier=identifier, features=processed_features)
            )

        logger.info(f"Processed InterPro features for {len(result)} proteins")
        return result

    def _manage_headers(self, headers: List[str]) -> List[str]:
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
