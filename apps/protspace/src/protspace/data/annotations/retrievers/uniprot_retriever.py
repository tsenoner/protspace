"""
UniProt annotation retriever.

This module fetches protein annotations from the UniProt API.
"""

import logging
import re
from collections import namedtuple

import requests
from tqdm import tqdm

from protspace.data.annotations.retrievers.base_retriever import BaseAnnotationRetriever
from protspace.data.annotations.retrievers.http_utils import API_TIMEOUT, paginated_get
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


def _fetch_one_with_timeout(accession: str, timeout: int = API_TIMEOUT) -> dict:
    """Fetch a single UniProt entry by accession with timeout protection."""
    url = f"https://rest.uniprot.org/uniprotkb/{accession}.json"
    resp = requests.get(url, timeout=timeout)
    resp.raise_for_status()
    return resp.json()


def _fetch_uniparc_sequence(
    uniparc_id: str, timeout: int = API_TIMEOUT
) -> tuple[str, int]:
    """Fetch sequence and length from UniParc for deleted entries."""
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


def _fetch_many_accessions(accessions: list[str]) -> list[dict]:
    """Fetch multiple UniProt entries by accession."""
    return paginated_get(
        "https://rest.uniprot.org/uniprotkb/accessions",
        params={"accessions": ",".join(accessions)},
    )


def _search_sec_acc(accession: str) -> list[dict]:
    """Search UniProt by secondary accession (fallback for inactive entries)."""
    return paginated_get(
        "https://rest.uniprot.org/uniprotkb/search",
        params={"query": f"sec_acc:{accession}", "format": "json", "size": "500"},
    )


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
                    records = _search_sec_acc(accession)
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
        total_batch_failures = 0
        total_failed_proteins = 0

        # Separate valid UniProt accessions from non-UniProt identifiers
        # to prevent invalid IDs from causing entire batch failures
        _uniprot_re = re.compile(
            r"^[OPQ][0-9][A-Z0-9]{3}[0-9]$"
            r"|^[A-NR-Z][0-9]([A-Z][A-Z0-9]{2}[0-9]){1,2}$"
        )
        valid_headers = [h for h in self.headers if _uniprot_re.match(h)]
        invalid_headers = [h for h in self.headers if not _uniprot_re.match(h)]

        if invalid_headers:
            # Add empty annotations for non-UniProt identifiers immediately
            for header in invalid_headers:
                result.append(
                    ProteinAnnotations(
                        identifier=header,
                        annotations=dict.fromkeys(UNIPROT_ANNOTATIONS, ""),
                    )
                )

        with tqdm(
            total=len(self.headers), desc="Fetching UniProt annotations", unit="seq"
        ) as pbar:
            pbar.update(len(invalid_headers))
            for i in range(0, len(valid_headers), batch_size):
                batch = valid_headers[i : i + batch_size]

                try:
                    records = _fetch_many_accessions(batch)

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
                    total_batch_failures += 1
                    total_failed_proteins += len(batch)
                    logger.debug(
                        f"Failed to fetch UniProt batch {i}-{i + batch_size}: {e}"
                    )
                    # Add empty annotations for failed proteins
                    for accession in batch:
                        result.append(
                            ProteinAnnotations(
                                identifier=accession,
                                annotations=dict.fromkeys(UNIPROT_ANNOTATIONS, ""),
                            )
                        )

                pbar.update(len(batch))

        # Summary
        seq_count = sum(1 for p in result if p.annotations.get("sequence", ""))

        if invalid_headers:
            msg = (
                f"{len(valid_headers)}/{len(self.headers)} identifiers are valid "
                f"UniProt accessions ({len(invalid_headers)} skipped)."
            )
            if seq_count == 0:
                msg += (
                    "\n  Accession-dependent annotations (UniProt, Taxonomy, TED) "
                    "will be empty for non-UniProt identifiers."
                    "\n  Sequence-dependent annotations (InterPro, Biocentral) can "
                    "still work if you provide a FASTA file with -f."
                )
            else:
                msg += f" {seq_count} sequences retrieved."
            logger.warning(msg)

        if total_resolved or total_deleted:
            parts = []
            if total_deleted:
                parts.append(f"{total_deleted} deleted (sequence from UniParc)")
            if total_resolved:
                parts.append(f"{total_resolved} merged into other entries")
            logger.warning(f"Inactive UniProt entries: {', '.join(parts)}")

        return result
