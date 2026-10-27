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
        data = resp.json()
        seq_info = data.get("sequence", {})
        sequence = seq_info.get("value", "")
        length = seq_info.get("length", len(sequence))
        return sequence, length
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
    """
    wanted = set(accessions)
    records = paginated_get(
        "https://rest.uniprot.org/uniprotkb/search",
        params={
            "query": " OR ".join(f"accession:{acc}" for acc in accessions),
            "format": "json",
            "size": "500",
        },
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
    records = paginated_get(
        "https://rest.uniprot.org/uniparc/search",
        params={
            "query": " OR ".join(f"upi:{upi}" for upi in uniparc_ids),
            "fields": "upi,sequence",
            "format": "json",
            "size": "500",
        },
        on_response=on_response,
        session=session,
    )
    sequences = {}
    for record in records:
        seq_info = record.get("sequence", {})
        sequence = seq_info.get("value", "")
        if record.get("uniParcId") and sequence:
            sequences[record["uniParcId"]] = (
                sequence,
                seq_info.get("length", len(sequence)),
            )
    return sequences


def _search_sec_acc(
    accession: str,
    *,
    on_response: OnResponse | None = None,
    session: requests.Session | None = None,
) -> list[dict]:
    """Search UniProt by secondary accession (fallback for inactive entries)."""
    return paginated_get(
        "https://rest.uniprot.org/uniprotkb/search",
        params={"query": f"sec_acc:{accession}", "format": "json", "size": "500"},
        on_response=on_response,
        session=session,
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

    @staticmethod
    def _deleted_annotations(sequence: str, length: int) -> dict:
        """The values of a deleted entry: its UniParc sequence, if any, alone."""
        annotations = dict.fromkeys(UNIPROT_ANNOTATIONS, "")
        if sequence:
            annotations["sequence"] = sequence
            annotations["length"] = str(length)
        return annotations

    def _resolve_one(
        self,
        accession: str,
        session: requests.Session | None = None,
    ) -> tuple[ProteinAnnotations, bool]:
        """Resolve one inactive entry with its own requests.

        Uses fetch_one() as primary resolution (returns inactive entry details
        including reason and UniParc ID), with sec_acc: search as fallback.

        Returns:
            The entry's annotations, and whether it resolved to an active
            entry (merged) rather than counting as deleted.
        """
        try:
            result = _fetch_one_with_timeout(
                accession, on_response=self._record_release, session=session
            )
            entry_type = str(result.get("entryType", ""))

            if "Inactive" not in entry_type:
                # Merged transparently — fetch_one returned active replacement
                entry = UniProtEntry(result)
                logger.debug(f"Resolved inactive entry {accession} → {entry.entry}")
                return (
                    ProteinAnnotations(
                        identifier=accession,
                        annotations=self._extract_annotations(entry),
                    ),
                    True,
                )

            # Inactive entry — check reason
            reason = result.get("inactiveReason", {})
            reason_type = reason.get("inactiveReasonType", "UNKNOWN")
            uniparc = result.get("extraAttributes", {}).get("uniParcId", "")

            if reason_type == "MERGED" and reason.get("mergeDemergeTo"):
                target = reason["mergeDemergeTo"][0]
                try:
                    target_result = _fetch_one_with_timeout(
                        target, on_response=self._record_release, session=session
                    )
                    if "Inactive" not in str(target_result.get("entryType", "")):
                        entry = UniProtEntry(target_result)
                        logger.debug(f"Resolved inactive entry {accession} → {target}")
                        return (
                            ProteinAnnotations(
                                identifier=accession,
                                annotations=self._extract_annotations(entry),
                            ),
                            True,
                        )
                except Exception:
                    pass  # Fall through to deleted handling

            # Deleted / unresolvable — try to recover sequence from UniParc
            sequence, length = "", 0
            if uniparc:
                sequence, length = _fetch_uniparc_sequence(
                    uniparc, on_response=self._record_release, session=session
                )
            deleted_reason = reason.get("deletedReason", reason_type)
            seq_status = "sequence from UniParc" if sequence else "no sequence"
            logger.debug(f"Deleted entry {accession}: {deleted_reason} ({seq_status})")
            return (
                ProteinAnnotations(
                    identifier=accession,
                    annotations=self._deleted_annotations(sequence, length),
                ),
                False,
            )

        except Exception:
            # fetch_one failed — fall back to sec_acc: search
            try:
                records = _search_sec_acc(
                    accession, on_response=self._record_release, session=session
                )
                if records:
                    entry = UniProtEntry(records[0])
                    logger.debug(
                        f"Resolved inactive entry {accession}"
                        f" → {entry.entry} (via sec_acc search)"
                    )
                    return (
                        ProteinAnnotations(
                            identifier=accession,
                            annotations=self._extract_annotations(entry),
                        ),
                        True,
                    )
                logger.debug(
                    f"Deleted entry {accession}: unresolvable"
                    f" (no secondary accession match)"
                )
            except Exception as e2:
                logger.warning(f"Failed to resolve inactive entry {accession}: {e2}")
            return (
                ProteinAnnotations(
                    identifier=accession,
                    annotations=dict.fromkeys(UNIPROT_ANNOTATIONS, ""),
                ),
                False,
            )

    def _resolve_inactive_entries(
        self,
        missing_accessions: list[str],
        session: requests.Session | None = None,
    ) -> tuple[list[ProteinAnnotations], int, int]:
        """Resolve inactive/obsolete UniProt entries, a batch's worth at a time.

        Settles as many as it can with three requests for the whole list: an
        ``accession:`` search for their records (reason, merge target, UniParc
        ID), one fetch of the active entries they were merged into, and one
        UniParc search for the deleted entries' sequences. Each accession
        those leave unsettled goes through :meth:`_resolve_one`, the lookup
        every inactive entry used to get (two requests each, which made a
        TrEMBL-heavy run spend most of its time here). Either way an accession
        gets the same values. Requests go through *session* when one is given.

        Returns:
            Tuple of (resolved annotations, resolved_count, deleted_count)
        """
        record = self._record_release
        try:
            stubs = _search_inactive_records(
                missing_accessions, on_response=record, session=session
            )
        except Exception as e:
            logger.debug(f"Bulk inactive-entry search failed: {e}")
            stubs = {}

        active: dict[str, dict] = {}  # returned active after all
        merged_into: dict[str, str] = {}  # accession → merge target
        uniparc_of: dict[str, str] = {}  # deleted accession → UniParc ID ("" none)
        for accession in missing_accessions:
            stub = stubs.get(accession)
            if stub is None:
                continue
            if "Inactive" not in str(stub.get("entryType", "")):
                active[accession] = stub
                continue
            reason = stub.get("inactiveReason", {})
            if reason.get("inactiveReasonType") == "MERGED" and reason.get(
                "mergeDemergeTo"
            ):
                merged_into[accession] = reason["mergeDemergeTo"][0]
            else:
                uniparc_of[accession] = stub.get("extraAttributes", {}).get(
                    "uniParcId", ""
                )

        targets: dict[str, dict] = {}
        if merged_into:
            try:
                # The batch endpoint returns active entries only.
                for target in _fetch_many_accessions(
                    sorted(set(merged_into.values())),
                    on_response=record,
                    session=session,
                ):
                    targets[target.get("primaryAccession")] = target
            except Exception as e:
                logger.debug(f"Bulk merge-target fetch failed: {e}")

        sequences: dict[str, tuple[str, int]] = {}
        uniparc_ids = sorted({upi for upi in uniparc_of.values() if upi})
        if uniparc_ids:
            try:
                sequences = _search_uniparc_sequences(
                    uniparc_ids, on_response=record, session=session
                )
            except Exception as e:
                logger.debug(f"Bulk UniParc search failed: {e}")

        outcome: dict[str, tuple[ProteinAnnotations, bool]] = {}
        unsettled = []
        for accession in missing_accessions:
            if accession in active:
                entry = UniProtEntry(active[accession])
                annotations = self._extract_annotations(entry)
                outcome[accession] = (ProteinAnnotations(accession, annotations), True)
            elif merged_into.get(accession) in targets:
                entry = UniProtEntry(targets[merged_into[accession]])
                annotations = self._extract_annotations(entry)
                outcome[accession] = (ProteinAnnotations(accession, annotations), True)
                logger.debug(f"Resolved inactive entry {accession} → {entry.entry}")
            elif accession in uniparc_of:
                upi = uniparc_of[accession]
                if upi in sequences:
                    sequence, length = sequences[upi]
                elif upi:
                    # Not in the search's answer: the single lookup, as before.
                    sequence, length = _fetch_uniparc_sequence(
                        upi, on_response=record, session=session
                    )
                else:
                    sequence, length = "", 0
                annotations = self._deleted_annotations(sequence, length)
                outcome[accession] = (ProteinAnnotations(accession, annotations), False)
            else:
                unsettled.append(accession)

        if unsettled:
            for accession in tqdm(
                unsettled,
                desc="Resolving inactive entries",
                unit="seq",
                leave=False,
            ):
                outcome[accession] = self._resolve_one(accession, session=session)

        resolved = [outcome[accession][0] for accession in missing_accessions]
        resolved_count = sum(outcome[accession][1] for accession in missing_accessions)
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
