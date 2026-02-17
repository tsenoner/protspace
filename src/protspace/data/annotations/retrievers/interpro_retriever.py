import gzip
import hashlib
import json
import logging
import os
import tempfile
import time
import xml.etree.ElementTree as ET
from collections import namedtuple
from pathlib import Path
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
    "smart": "smart",
    "cdd": "cdd",
    "panther": "panther",
    "prosite": "prosite patterns",
    "prints": "prints",
}

# List of supported InterPro annotations for easy access
INTERPRO_ANNOTATIONS = list(INTERPRO_MAPPING.keys())

# API Configuration
BASE_URL = "https://www.ebi.ac.uk/interpro/matches/api"
INTERPRO_ENTRY_URL = "https://www.ebi.ac.uk/interpro/api/entry"
CHUNK_SIZE = 100  # As per API documentation for batch requests

# Mapping from annotation key to InterPro entry API database path
# Used to resolve human-readable names for databases where the matches API
# does not return meaningful names
ENTRY_API_DB_MAPPING = {
    "cath": "cathgene3d",
    "superfamily": "ssf",
    "panther": "panther",
}

# FTP XML-based name resolution
INTERPRO_XML_URL = (
    "https://ftp.ebi.ac.uk/pub/databases/interpro/current_release/interpro.xml.gz"
)
INTERPRO_CACHE_DIR = Path.home() / ".cache" / "protspace" / "interpro"
CACHE_MAX_AGE_DAYS = 7

# Mapping from annotation key to the db attribute used in the XML <db_xref> elements
_ANNOTATION_KEY_TO_XML_DB = {
    "cath": "CATHGENE3D",
    "superfamily": "SSF",
    "panther": "PANTHER",
}

# The set of db attribute values we extract from the XML
_XML_DBS_OF_INTEREST = set(_ANNOTATION_KEY_TO_XML_DB.values())

ProteinAnnotations = namedtuple("ProteinAnnotations", ["identifier", "annotations"])


class InterProRetriever(BaseAnnotationRetriever):
    """
    Retrieves InterPro domain annotations for proteins using the InterPro API.

    Supports fetching annotations from:
    - Pfam (key: pfam)
    - SUPERFAMILY (key: superfamily)
    - CATH-Gene3D (key: cath)
    - Phobius signal peptides (key: signal_peptide)
    - SMART (key: smart)
    - CDD (key: cdd)
    - PANTHER (key: panther)
    - PROSITE (key: prosite)
    - PRINTS (key: prints)

    Annotations are stored with confidence scores in a pipe-separated format:
    - Format: accession (name)|score1,score2,score3;accession2 (name2)|score1
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
            annotations: List of InterPro database annotations to fetch (e.g., pfam, superfamily, cath, smart, ...)
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
            - Format: accession (name)|score1,score2,score3;accession2 (name2)|score1
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

        # Resolve names via InterPro entry API for databases that don't
        # provide meaningful names in the matches API response
        resolved_names = {}
        for annotation_key in self.annotations:
            if annotation_key in ENTRY_API_DB_MAPPING:
                all_accessions = set()
                for annotations_data in protein_annotations.values():
                    if annotation_key in annotations_data:
                        all_accessions.update(
                            annotations_data[annotation_key]["accessions"]
                        )
                resolved_names[annotation_key] = self._resolve_entry_names(
                    all_accessions, annotation_key
                )

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

                    # Inject names resolved from InterPro entry API
                    if annotation_name in resolved_names:
                        name_map = resolved_names[annotation_name]
                        for acc in accession_to_name:
                            if not accession_to_name[acc] and acc in name_map:
                                accession_to_name[acc] = name_map[acc]

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

    def _resolve_entry_names(
        self, accessions: set[str], annotation_key: str
    ) -> dict[str, str]:
        """
        Resolve accessions to human-readable names via the InterPro FTP XML.

        Downloads ``interpro.xml.gz`` once (cached locally for 7 days) and
        extracts the parent InterPro entry name for each member-database
        accession.

        Args:
            accessions: Set of accessions (e.g., {"G3DSA:1.10.10.10"} or {"SSF53098"})
            annotation_key: The annotation key (e.g., "cath", "superfamily")

        Returns:
            Dictionary mapping accession to name (only for the requested
            accessions).
        """
        if not accessions or annotation_key not in ENTRY_API_DB_MAPPING:
            return {}

        xml_db = _ANNOTATION_KEY_TO_XML_DB.get(annotation_key)
        if not xml_db:
            return {}

        all_names = self._get_member_db_name_map()
        db_names = all_names.get(xml_db, {})

        name_map = {acc: db_names[acc] for acc in accessions if acc in db_names}

        label = annotation_key.upper()
        logger.info(f"Resolved {len(name_map)}/{len(accessions)} {label} names")
        return name_map

    @classmethod
    def _get_member_db_name_map(cls) -> dict[str, dict[str, str]]:
        """
        Return ``{db: {accession: name}}`` for SSF, CATHGENE3D and PANTHER.

        The data is extracted from ``interpro.xml.gz`` on the EBI FTP server
        and cached locally as JSON for up to :data:`CACHE_MAX_AGE_DAYS` days.
        """
        cache_dir = INTERPRO_CACHE_DIR
        cache_file = cache_dir / "member_db_names.json"
        timestamp_file = cache_dir / "member_db_names.timestamp"

        # Check cache freshness
        if cache_file.exists() and timestamp_file.exists():
            try:
                ts = float(timestamp_file.read_text().strip())
                age_days = (time.time() - ts) / 86400
                if age_days < CACHE_MAX_AGE_DAYS:
                    logger.info("Loading InterPro member-DB name map from cache")
                    return json.loads(cache_file.read_text())
            except (ValueError, OSError, json.JSONDecodeError) as e:
                logger.warning(f"Cache read failed ({e}), will re-download")

        # Download and parse
        logger.info(f"Downloading {INTERPRO_XML_URL} ...")
        try:
            cache_dir.mkdir(parents=True, exist_ok=True)

            resp = requests.get(INTERPRO_XML_URL, timeout=120, stream=True)
            resp.raise_for_status()

            # Write to temp file first, then move atomically
            tmp_gz = None
            try:
                fd, tmp_gz = tempfile.mkstemp(suffix=".xml.gz", dir=str(cache_dir))
                os.close(fd)
                with open(tmp_gz, "wb") as f:
                    for chunk in resp.iter_content(chunk_size=1 << 20):
                        f.write(chunk)

                name_maps = cls._parse_interpro_xml(tmp_gz)
            finally:
                if tmp_gz and os.path.exists(tmp_gz):
                    os.remove(tmp_gz)

            # Persist cache
            cache_file.write_text(json.dumps(name_maps))
            timestamp_file.write_text(str(time.time()))

            logger.info("InterPro member-DB name map cached successfully")
            return name_maps

        except Exception as e:
            logger.warning(f"Failed to download/parse InterPro XML: {e}")
            # If a stale cache exists, use it as fallback
            if cache_file.exists():
                try:
                    logger.info("Falling back to stale cache")
                    return json.loads(cache_file.read_text())
                except (json.JSONDecodeError, OSError):
                    pass
            return {}

    @staticmethod
    def _parse_interpro_xml(gz_path: str) -> dict[str, dict[str, str]]:
        """
        Stream-parse a gzipped InterPro XML file and extract member-DB names.

        For each ``<interpro>`` element the parser captures the child
        ``<name>`` text (the InterPro entry name).  For every ``<db_xref>``
        whose ``db`` attribute is in :data:`_XML_DBS_OF_INTEREST`, the
        ``name`` attribute of the xref is used if non-empty; otherwise the
        parent InterPro entry name is used.

        Returns:
            ``{db: {accession: name}}`` for the databases of interest.
        """
        name_maps: dict[str, dict[str, str]] = {db: {} for db in _XML_DBS_OF_INTEREST}

        with gzip.open(gz_path, "rb") as f:
            context = ET.iterparse(f, events=("end",))
            for _event, elem in context:
                if elem.tag == "interpro":
                    # Get the InterPro entry name
                    name_elem = elem.find("name")
                    ipr_name = (
                        name_elem.text.strip()
                        if name_elem is not None and name_elem.text
                        else ""
                    )

                    for db_xref in elem.iter("db_xref"):
                        db = db_xref.get("db", "")
                        if db in _XML_DBS_OF_INTEREST:
                            dbkey = db_xref.get("dbkey", "")
                            xref_name = db_xref.get("name", "").strip()
                            resolved_name = xref_name if xref_name else ipr_name
                            if dbkey and resolved_name:
                                name_maps[db][dbkey] = resolved_name

                    # Free memory for processed elements
                    elem.clear()

        total = sum(len(v) for v in name_maps.values())
        logger.info(f"Parsed InterPro XML: {total} member-DB name mappings extracted")
        return name_maps

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
