"""
UniProt annotation retriever.

This module fetches protein annotations from the UniProt API.
"""

import json
import logging
from collections import namedtuple

import requests
from tqdm import tqdm
from unipressed import UniprotkbClient

from protspace.data.annotations.retrievers.base_retriever import BaseAnnotationRetriever
from protspace.data.parsers.uniprot_parser import UniProtEntry

logger = logging.getLogger(__name__)

# UniProt annotations - these are the current protspace annotations
UNIPROT_ANNOTATIONS = [
    "annotation_score",
    "cc_subcellular_location",
    "ec",
    "fragment",
    "gene_name",
    "go_bp",
    "go_cc",
    "go_mf",
    "keyword",
    "length",
    "organism_id",
    "protein_name",
    "protein_existence",
    "protein_families",
    "reviewed",
    "sequence",
    "uniprot_kb_id",
    "xref_pdb",
]

ProteinAnnotations = namedtuple("ProteinAnnotations", ["identifier", "annotations"])


_API_TIMEOUT = 30  # seconds per HTTP request


def _fetch_one_with_timeout(accession: str, timeout: int = _API_TIMEOUT) -> dict:
    """Fetch a single UniProt entry with a timeout.

    The unipressed library's fetch_one() uses requests.get without a timeout,
    which can hang indefinitely. This wrapper adds timeout protection.
    """
    url = f"https://rest.uniprot.org/uniprotkb/{accession}.json"
    resp = requests.get(url, timeout=timeout)
    resp.raise_for_status()
    return resp.json()


def _fetch_uniparc_sequence(
    uniparc_id: str, timeout: int = _API_TIMEOUT
) -> tuple[str, int]:
    """Fetch sequence and length from UniParc.

    Deleted UniProt entries still have their sequence archived in UniParc.

    Returns:
        Tuple of (sequence_string, length) or ("", 0) on failure.
    """
    url = f"https://rest.uniprot.org/uniparc/{uniparc_id}.json"
    try:
        resp = requests.get(url, timeout=timeout)
        resp.raise_for_status()
        data = resp.json()
        seq_info = data.get("sequence", {})
        sequence = seq_info.get("value", "")
        length = seq_info.get("length", len(sequence))
        return sequence, length
    except Exception as e:
        logger.debug(f"Failed to fetch UniParc sequence {uniparc_id}: {e}")
        return "", 0


class UniProtRetriever(BaseAnnotationRetriever):
    """Retrieves annotations from UniProt API."""

    def __init__(self, headers: list[str] = None, annotations: list = None):
        """
        Initialize UniProt retriever.

        Args:
            headers: List of protein accessions to fetch
            annotations: List of annotations to retrieve (not used, always retrieves UNIPROT_ANNOTATIONS)
        """
        super().__init__(headers, annotations)
        self.headers = self._manage_headers(self.headers)

    @staticmethod
    def _extract_annotations(entry: UniProtEntry) -> dict:
        """Extract UNIPROT_ANNOTATIONS from a UniProtEntry as a string dict."""
        annotations_dict = {}
        for prop in UNIPROT_ANNOTATIONS:
            try:
                value = getattr(entry, prop)
                if isinstance(value, list):
                    annotations_dict[prop] = (
                        ";".join(str(v) for v in value) if value else ""
                    )
                elif isinstance(value, bool):
                    annotations_dict[prop] = str(value)
                elif value is None or value == "":
                    annotations_dict[prop] = ""
                else:
                    annotations_dict[prop] = str(value)
            except (KeyError, AttributeError, IndexError):
                annotations_dict[prop] = ""
        return annotations_dict

    def _resolve_inactive_entries(
        self, missing_accessions: list[str]
    ) -> tuple[list[ProteinAnnotations], int, int]:
        """Resolve inactive/obsolete UniProt entries.

        Uses fetch_one() as primary resolution (returns inactive entry details
        including reason and UniParc ID), with sec_acc: search as fallback.

        Returns:
            Tuple of (resolved annotations, resolved_count, deleted_count)
        """
        resolved = []
        resolved_count = 0
        deleted_count = 0

        for accession in tqdm(
            missing_accessions,
            desc="Resolving inactive entries",
            unit="seq",
            leave=False,
        ):
            try:
                result = _fetch_one_with_timeout(accession)
                entry_type = str(result.get("entryType", ""))

                if "Inactive" not in entry_type:
                    # Merged transparently — fetch_one returned active replacement
                    entry = UniProtEntry(result)
                    annotations_dict = self._extract_annotations(entry)
                    resolved.append(
                        ProteinAnnotations(
                            identifier=accession, annotations=annotations_dict
                        )
                    )
                    resolved_count += 1
                    logger.debug(f"Resolved inactive entry {accession} → {entry.entry}")
                    continue

                # Inactive entry — check reason
                reason = result.get("inactiveReason", {})
                reason_type = reason.get("inactiveReasonType", "UNKNOWN")
                uniparc = result.get("extraAttributes", {}).get("uniParcId", "")

                if reason_type == "MERGED" and reason.get("mergeDemergeTo"):
                    target = reason["mergeDemergeTo"][0]
                    try:
                        target_result = _fetch_one_with_timeout(target)
                        if "Inactive" not in str(target_result.get("entryType", "")):
                            entry = UniProtEntry(target_result)
                            annotations_dict = self._extract_annotations(entry)
                            resolved.append(
                                ProteinAnnotations(
                                    identifier=accession,
                                    annotations=annotations_dict,
                                )
                            )
                            resolved_count += 1
                            logger.debug(
                                f"Resolved inactive entry {accession} → {target}"
                            )
                            continue
                    except Exception:
                        pass  # Fall through to deleted handling

                # Deleted / unresolvable — try to recover sequence from UniParc
                annotations = dict.fromkeys(UNIPROT_ANNOTATIONS, "")
                if uniparc:
                    sequence, length = _fetch_uniparc_sequence(uniparc)
                    if sequence:
                        annotations["sequence"] = sequence
                        annotations["length"] = str(length)
                resolved.append(
                    ProteinAnnotations(
                        identifier=accession,
                        annotations=annotations,
                    )
                )
                deleted_count += 1
                deleted_reason = reason.get("deletedReason", reason_type)
                seq_status = (
                    "sequence from UniParc"
                    if annotations["sequence"]
                    else "no sequence"
                )
                logger.debug(
                    f"Deleted entry {accession}: {deleted_reason} ({seq_status})"
                )

            except Exception:
                # fetch_one failed — fall back to sec_acc: search
                try:
                    records = []
                    for page in UniprotkbClient.search(
                        query=f"sec_acc:{accession}", format="json"
                    ).each_page():
                        content = page.read() if hasattr(page, "read") else page
                        parsed = (
                            json.loads(content) if isinstance(content, str) else content
                        )
                        records.extend(parsed.get("results", []))
                    if records:
                        entry = UniProtEntry(records[0])
                        annotations_dict = self._extract_annotations(entry)
                        resolved.append(
                            ProteinAnnotations(
                                identifier=accession,
                                annotations=annotations_dict,
                            )
                        )
                        resolved_count += 1
                        logger.debug(
                            f"Resolved inactive entry {accession}"
                            f" → {entry.entry} (via sec_acc search)"
                        )
                    else:
                        resolved.append(
                            ProteinAnnotations(
                                identifier=accession,
                                annotations=dict.fromkeys(UNIPROT_ANNOTATIONS, ""),
                            )
                        )
                        deleted_count += 1
                        logger.debug(
                            f"Deleted entry {accession}: unresolvable"
                            f" (no secondary accession match)"
                        )
                except Exception as e2:
                    resolved.append(
                        ProteinAnnotations(
                            identifier=accession,
                            annotations=dict.fromkeys(UNIPROT_ANNOTATIONS, ""),
                        )
                    )
                    deleted_count += 1
                    logger.warning(
                        f"Failed to resolve inactive entry {accession}: {e2}"
                    )

        return resolved, resolved_count, deleted_count

    def fetch_annotations(self) -> list[ProteinAnnotations]:
        """
        Fetch raw UniProt annotations and store in tmp files.
        Stores UNIPROT_ANNOTATIONS with minimal processing.
        Processing/transformation happens later in annotation_manager.

        Returns:
            List of ProteinAnnotations with raw UniProt data
        """
        batch_size = 100
        result = []
        total_resolved = 0
        total_deleted = 0

        with tqdm(
            total=len(self.headers), desc="Fetching UniProt annotations", unit="seq"
        ) as pbar:
            for i in range(0, len(self.headers), batch_size):
                batch = self.headers[i : i + batch_size]

                try:
                    # Fetch records using unipressed
                    records = UniprotkbClient.fetch_many(batch)

                    # Parse each record and track returned identifiers
                    returned_ids = set()
                    for record in records:
                        entry = UniProtEntry(record)
                        returned_ids.add(entry.entry)
                        annotations_dict = self._extract_annotations(entry)
                        result.append(
                            ProteinAnnotations(
                                identifier=entry.entry, annotations=annotations_dict
                            )
                        )

                    # Resolve any missing (inactive/obsolete) entries
                    missing = [acc for acc in batch if acc not in returned_ids]
                    if missing:
                        resolved, res_count, del_count = self._resolve_inactive_entries(
                            missing
                        )
                        result.extend(resolved)
                        total_resolved += res_count
                        total_deleted += del_count

                except Exception as e:
                    logger.warning(f"Failed to fetch batch {i}-{i + batch_size}: {e}")
                    # Add empty annotations for failed proteins
                    for accession in batch:
                        result.append(
                            ProteinAnnotations(
                                identifier=accession,
                                annotations=dict.fromkeys(UNIPROT_ANNOTATIONS, ""),
                            )
                        )

                pbar.update(len(batch))

        if total_resolved or total_deleted:
            parts = []
            if total_deleted:
                parts.append(f"{total_deleted} deleted (sequence from UniParc)")
            if total_resolved:
                parts.append(f"{total_resolved} merged into other entries")
            logger.warning(f"Inactive UniProt entries: {', '.join(parts)}")

        return result

    def _manage_headers(self, headers: list[str]) -> list[str]:
        """
        Clean protein headers by extracting accessions from FASTA format.

        Args:
            headers: List of protein headers

        Returns:
            List of cleaned accessions
        """
        managed_headers = []
        prefixes = ["sp|", "tr|"]
        for header in headers:
            header_lower = header.lower()
            if any(header_lower.startswith(prefix) for prefix in prefixes):
                accession = header.split("|")[1]
                managed_headers.append(accession)
            else:
                managed_headers.append(header)
        return managed_headers
