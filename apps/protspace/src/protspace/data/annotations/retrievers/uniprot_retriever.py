"""
UniProt annotation retriever.

This module fetches protein annotations from the UniProt API.
"""

import logging
import re
from collections import namedtuple
from collections.abc import Callable

import requests
from tqdm import tqdm

from protspace.data.annotations.retrievers.base_retriever import BaseAnnotationRetriever
from protspace.data.annotations.retrievers.http_utils import (
    API_TIMEOUT,
    PooledSession,
    get_with_retry,
    paginated_get,
)
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

# Every UniProt REST response names the release its data came from.
RELEASE_HEADER = "X-UniProt-Release"

# Receives each successful UniProt response, e.g. to read RELEASE_HEADER.
OnResponse = Callable[[requests.Response], None]


def _fetch_one_with_timeout(
    accession: str,
    timeout: int = API_TIMEOUT,
    *,
    on_response: OnResponse | None = None,
    session: requests.Session | None = None,
) -> dict:
    """Fetch a single UniProt entry by accession with timeout protection.

    One attempt, sent through the retry helper so that on a session it waits
    out a ``Retry-After`` the session received, and passes on one it gets.
    """
    url = f"https://rest.uniprot.org/uniprotkb/{accession}.json"
    resp = get_with_retry(url, timeout=timeout, attempts=1, session=session)
    if on_response is not None:
        on_response(resp)
    return resp.json()


def _uniparc_sequence(record: dict) -> tuple[str, int]:
    """Sequence and length of a UniParc record (length from the sequence if absent)."""
    seq_info = record.get("sequence", {})
    sequence = seq_info.get("value", "")
    return sequence, seq_info.get("length", len(sequence))


def _fetch_uniparc_sequence(
    uniparc_id: str,
    timeout: int = API_TIMEOUT,
    *,
    on_response: OnResponse | None = None,
    session: requests.Session | None = None,
) -> tuple[str, int]:
    """Fetch sequence and length from UniParc for deleted entries.

    One attempt, sent like :func:`_fetch_one_with_timeout`.
    """
    url = f"https://rest.uniprot.org/uniparc/{uniparc_id}.json"
    try:
        resp = get_with_retry(url, timeout=timeout, attempts=1, session=session)
        if on_response is not None:
            on_response(resp)
        return _uniparc_sequence(resp.json())
    except Exception as e:
        logger.debug(f"Failed to fetch UniParc sequence {uniparc_id}: {e}")
        return "", 0


def _fetch_many_accessions(
    accessions: list[str],
    *,
    on_response: OnResponse | None = None,
    session: requests.Session | None = None,
) -> list[dict]:
    """Fetch multiple UniProt entries by accession."""
    return paginated_get(
        "https://rest.uniprot.org/uniprotkb/accessions",
        params={"accessions": ",".join(accessions)},
        on_response=on_response,
        session=session,
    )


def _search(
    url: str,
    query: str,
    *,
    on_response: OnResponse | None = None,
    session: requests.Session | None = None,
    **params: str,
) -> list[dict]:
    """Every record a UniProt search endpoint returns for *query*, all pages."""
    return paginated_get(
        url,
        params={"query": query, "format": "json", "size": "500", **params},
        on_response=on_response,
        session=session,
    )


def _search_inactive_records(
    accessions: list[str],
    *,
    on_response: OnResponse | None = None,
    session: requests.Session | None = None,
) -> dict[str, dict]:
    """The records of *accessions*, inactive ones included, by primary accession.

    The batch endpoint leaves inactive entries out; an ``accession:`` search
    returns them as the stub a single-entry lookup gets (a merged one as a
    ``MERGED`` stub naming its target, not redirected to it). Records for any
    other accession are dropped, so none is filed under the wrong protein.
    UniProt refuses more than 100 ``OR`` terms, one batch's worth.
    """
    wanted = set(accessions)
    records = _search(
        "https://rest.uniprot.org/uniprotkb/search",
        " OR ".join(f"accession:{acc}" for acc in accessions),
        on_response=on_response,
        session=session,
    )
    return {
        record["primaryAccession"]: record
        for record in records
        if record.get("primaryAccession") in wanted
    }


def _search_uniparc_sequences(
    uniparc_ids: list[str],
    *,
    on_response: OnResponse | None = None,
    session: requests.Session | None = None,
) -> dict[str, tuple[str, int]]:
    """Sequence and length of each UniParc entry the search returns, by id.

    Asks for the id and sequence only: the full records carry every
    cross-reference and are several times larger.
    """
    records = _search(
        "https://rest.uniprot.org/uniparc/search",
        " OR ".join(f"upi:{upi}" for upi in uniparc_ids),
        on_response=on_response,
        session=session,
        fields="upi,sequence",
    )
    sequences = {}
    for record in records:
        sequence, length = _uniparc_sequence(record)
        if record.get("uniParcId") and sequence:
            sequences[record["uniParcId"]] = (sequence, length)
    return sequences


def _search_sec_acc(
    accession: str,
    *,
    on_response: OnResponse | None = None,
    session: requests.Session | None = None,
) -> list[dict]:
    """Search UniProt by secondary accession (fallback for inactive entries)."""
    return _search(
        "https://rest.uniprot.org/uniprotkb/search",
        f"sec_acc:{accession}",
        on_response=on_response,
        session=session,
    )


def _is_active(record: dict | None) -> bool:
    return record is not None and "Inactive" not in str(record.get("entryType", ""))


def _merge_target(record: dict | None) -> str | None:
    """The entry an inactive record was merged into (the first one named), if any."""
    reason = (record or {}).get("inactiveReason", {})
    if reason.get("inactiveReasonType") == "MERGED" and reason.get("mergeDemergeTo"):
        return reason["mergeDemergeTo"][0]
    return None


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
        self.failed_batch_count = 0
        # UniProtKB releases (e.g. "2026_03") reported by the responses this
        # retriever's values came from; empty when none carried the header.
        self.releases: set[str] = set()
        # How many identifiers the last fetch sent to UniProt: the ones that
        # are UniProt accessions. None until a fetch has run.
        self.queried_accessions: int | None = None

    def _record_release(self, response: requests.Response) -> None:
        """Note the UniProtKB release a response reports, if any."""
        release = response.headers.get(RELEASE_HEADER)
        if release:
            self.releases.add(release)

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

    def _annotations_of(self, record: dict) -> dict:
        """UNIPROT_ANNOTATIONS of an active entry's record."""
        return self._extract_annotations(UniProtEntry(record))

    @staticmethod
    def _deleted_annotations(sequence: str = "", length: int = 0) -> dict:
        """The values of a deleted entry: its UniParc sequence, if any, alone."""
        annotations = dict.fromkeys(UNIPROT_ANNOTATIONS, "")
        if sequence:
            annotations["sequence"] = sequence
            annotations["length"] = str(length)
        return annotations

    def _lookup_record(
        self, accession: str, session: requests.Session | None = None
    ) -> dict | None:
        """The record of one accession the bulk search did not return.

        The single-entry endpoint follows a merge to the active entry (UniProt
        redirects) and returns any other inactive entry as its stub; when it
        fails, a ``sec_acc:`` search may still find the entry the accession was
        merged into. None when neither finds anything.
        """
        try:
            return _fetch_one_with_timeout(
                accession, on_response=self._record_release, session=session
            )
        except Exception:
            pass
        try:
            records = _search_sec_acc(
                accession, on_response=self._record_release, session=session
            )
        except Exception as e:
            logger.warning(f"Failed to resolve inactive entry {accession}: {e}")
            return None
        if not records:
            logger.debug(f"Deleted entry {accession}: no secondary accession match")
        return records[0] if records else None

    def _resolve_inactive_entries(
        self,
        missing_accessions: list[str],
        session: requests.Session | None = None,
    ) -> tuple[list[ProteinAnnotations], int, int]:
        """Resolve inactive/obsolete UniProt entries, a batch's worth at a time.

        Each step is one request for the whole list, and only what it leaves
        unanswered is looked up on its own, as every inactive entry used to be
        (two requests each, which made a TrEMBL-heavy run spend most of its
        time here):

        1. an ``accession:`` search for the records (an accession it misses:
           the single-entry endpoint, then a ``sec_acc:`` search);
        2. the active entries the merged ones were merged into (a target not
           returned: the single-entry endpoint, which follows a further merge);
        3. a UniParc search for the deleted entries' sequences (an id not
           returned: the single UniParc lookup).

        A merged entry whose target is not active counts as deleted, with the
        sequence its own record's UniParc id gives. Requests go through
        *session* when one is given.

        Returns:
            Tuple of (resolved annotations, resolved_count, deleted_count)
        """
        record_release = self._record_release
        try:
            records = _search_inactive_records(
                missing_accessions, on_response=record_release, session=session
            )
        except Exception as e:
            logger.warning(f"Bulk inactive-entry search failed, one by one: {e}")
            records = {}
        unanswered = [acc for acc in missing_accessions if acc not in records]
        for accession in tqdm(
            unanswered, desc="Resolving inactive entries", unit="seq", leave=False
        ):
            records[accession] = self._lookup_record(accession, session=session)

        annotations: dict[str, dict] = {}  # resolved to an active entry
        merged_into = {}
        for accession in missing_accessions:
            record = records[accession]
            if _is_active(record):
                annotations[accession] = self._annotations_of(record)
            elif target := _merge_target(record):
                merged_into[accession] = target

        if merged_into:
            try:
                # The batch endpoint returns active entries only.
                found = {
                    target["primaryAccession"]: target
                    for target in _fetch_many_accessions(
                        sorted(set(merged_into.values())),
                        on_response=record_release,
                        session=session,
                    )
                }
            except Exception as e:
                logger.warning(f"Bulk merge-target fetch failed, one by one: {e}")
                found = {}
            for accession, target in merged_into.items():
                if target not in found:
                    try:
                        found[target] = _fetch_one_with_timeout(
                            target, on_response=record_release, session=session
                        )
                    except Exception:
                        found[target] = None
                if _is_active(found[target]):
                    annotations[accession] = self._annotations_of(found[target])
                    logger.debug(f"Resolved inactive entry {accession} → {target}")
        resolved_ids = set(annotations)

        deleted = [acc for acc in missing_accessions if acc not in resolved_ids]
        uniparc_of = {
            acc: (records[acc] or {}).get("extraAttributes", {}).get("uniParcId", "")
            for acc in deleted
        }
        sequences: dict[str, tuple[str, int]] = {}
        uniparc_ids = sorted({upi for upi in uniparc_of.values() if upi})
        if uniparc_ids:
            try:
                sequences = _search_uniparc_sequences(
                    uniparc_ids, on_response=record_release, session=session
                )
            except Exception as e:
                logger.warning(f"Bulk UniParc search failed, one by one: {e}")
        for accession in deleted:
            upi = uniparc_of[accession]
            if upi and upi not in sequences:
                sequences[upi] = _fetch_uniparc_sequence(
                    upi, on_response=record_release, session=session
                )
            annotations[accession] = self._deleted_annotations(
                *sequences.get(upi, ("", 0))
            )
            found_sequence = bool(annotations[accession]["sequence"])
            logger.debug(
                f"Deleted entry {accession} "
                f"({'sequence from UniParc' if found_sequence else 'no sequence'})"
            )

        resolved = [
            ProteinAnnotations(acc, annotations[acc]) for acc in missing_accessions
        ]
        resolved_count = sum(acc in resolved_ids for acc in missing_accessions)
        return resolved, resolved_count, len(resolved) - resolved_count

    def fetch_annotations(self) -> list[ProteinAnnotations]:
        """
        Fetch raw UniProt annotations and store in tmp files.
        Stores UNIPROT_ANNOTATIONS with minimal processing.
        Processing/transformation happens later in annotation_manager.

        Every request goes through one session, one at a time: reusing the
        connection is what makes UniProt fast (308 entries a second against
        208 with a new connection per request), and it is not on the critical
        path, so batches are not sent in parallel.

        Returns:
            List of ProteinAnnotations with raw UniProt data
        """
        batch_size = 100
        result = []
        total_resolved = 0
        total_deleted = 0
        total_failed_proteins = 0
        # Reset so a re-fetch does not accumulate.
        self.failed_batch_count = 0
        self.releases.clear()

        # Separate valid UniProt accessions from non-UniProt identifiers
        # to prevent invalid IDs from causing entire batch failures
        _uniprot_re = re.compile(
            r"^[OPQ][0-9][A-Z0-9]{3}[0-9]$"
            r"|^[A-NR-Z][0-9]([A-Z][A-Z0-9]{2}[0-9]){1,2}$"
        )
        valid_headers = [h for h in self.headers if _uniprot_re.match(h)]
        invalid_headers = [h for h in self.headers if not _uniprot_re.match(h)]
        self.queried_accessions = len(valid_headers)

        if invalid_headers:
            # Add empty annotations for non-UniProt identifiers immediately
            for header in invalid_headers:
                result.append(
                    ProteinAnnotations(
                        identifier=header,
                        annotations=dict.fromkeys(UNIPROT_ANNOTATIONS, ""),
                    )
                )

        with (
            PooledSession() as session,
            tqdm(
                total=len(self.headers),
                desc="Fetching UniProt annotations",
                unit="seq",
            ) as pbar,
        ):
            pbar.update(len(invalid_headers))
            for i in range(0, len(valid_headers), batch_size):
                batch = valid_headers[i : i + batch_size]

                try:
                    records = _fetch_many_accessions(
                        batch, on_response=self._record_release, session=session
                    )

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
                            missing, session=session
                        )
                        result.extend(resolved)
                        total_resolved += res_count
                        total_deleted += del_count

                except Exception as e:
                    self.failed_batch_count += 1
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

        if self.failed_batch_count:
            logger.warning(
                f"{self.failed_batch_count} UniProt "
                f"{'batch' if self.failed_batch_count == 1 else 'batches'} failed; "
                f"{total_failed_proteins} "
                f"{'protein has' if total_failed_proteins == 1 else 'proteins have'} "
                "empty annotations"
            )

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
