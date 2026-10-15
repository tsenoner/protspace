"""TED (The Encyclopedia of Domains) retriever via AlphaFold Database API."""

import logging
import threading
from contextlib import closing
from functools import partial

import requests
from tqdm import tqdm

from protspace.data.annotations.encoding import encode_field
from protspace.data.annotations.retrievers.base_retriever import BaseAnnotationRetriever
from protspace.data.annotations.retrievers.cath_names import get_cath_names
from protspace.data.annotations.retrievers.http_utils import (
    MAX_ATTEMPTS,
    PooledSession,
    get_with_retry,
    map_as_completed,
    map_in_order,
)

logger = logging.getLogger(__name__)

ALPHAFOLD_DOMAINS_URL = "https://alphafold.ebi.ac.uk/api/domains"
_API_TIMEOUT = 10
# TED is fetched one request per accession, so a full outage would otherwise
# pay the default backoff hundreds of thousands of times.
_MAX_ATTEMPTS = 2
# The final pass retries first-pass failures with the default budget. This many
# failures in a row means the service is still down: stop instead of paying the
# full backoff once per remaining accession.
_FINAL_PASS_MAX_CONSECUTIVE_FAILURES = 10
# Accessions named in the "still failed" warning.
_PREVIEW = 5
# Lookups in flight at once, over one session. Measured on AlphaFold DB with
# Swiss-Prot accessions: 7 lookups a second one at a time with a new
# connection each (about 23 h for Swiss-Prot), 124 a second with 8 in
# parallel over one session (about 1.3 h), without a single 429 or 5xx.
# Raising it asks more of a public server; the constructor takes an override.
MAX_CONCURRENT_REQUESTS = 8

TED_ANNOTATIONS = ["ted_domains"]

# TED's own label for a domain with no CATH assignment.
_UNLABELED_CATH = "-"


class TedRetriever(BaseAnnotationRetriever):
    """Retrieves TED domain annotations from the AlphaFold Database API."""

    def __init__(
        self,
        headers: list[str] = None,
        annotations: list = None,
        max_concurrent_requests: int | None = None,
    ):
        # Don't call super().__init__() as we don't need standard header management
        self.headers = headers or []
        self.annotations = annotations
        self.max_concurrent_requests = (
            MAX_CONCURRENT_REQUESTS
            if max_concurrent_requests is None
            else max_concurrent_requests
        )
        self._cath_names = None
        # Parallel lookups resolve names at the same time; the names load once.
        self._cath_names_lock = threading.Lock()
        # Accessions whose lookup still failed after the final retry pass, as
        # opposed to having no domains.
        self.failed_lookup_count = 0

    def fetch_annotations(self) -> list[tuple]:
        """Fetch TED domain annotations for all proteins.

        Up to ``max_concurrent_requests`` lookups run at once over one
        session. The first pass files each result by position as it
        finishes, so a lookup that times out holds up only its own worker.
        Lookups that fail in the first pass are retried once more after it,
        in input order and with the default retry budget, by which time a
        transient outage has usually passed; that pass takes its results in
        input order for its breaker. Values, order and failure counts are
        those of one lookup at a time. Only lookups still failing after the
        final pass count as failed.
        """
        from protspace.data.annotations.retrievers.uniprot_retriever import (
            ProteinAnnotations,
        )

        values = [""] * len(self.headers)
        failed: list[int] = []  # positions whose first-pass lookup raised

        with PooledSession(self.max_concurrent_requests) as session:
            first_pass = map_as_completed(
                partial(self._try_lookup, session, attempts=_MAX_ATTEMPTS),
                self.headers,
                self.max_concurrent_requests,
                stop=session.stop,
            )
            with (
                tqdm(
                    total=len(self.headers),
                    desc="Fetching TED domain annotations",
                    unit="seq",
                ) as pbar,
                closing(first_pass) as lookups,
            ):
                for position, (value, error) in lookups:
                    if error is None:
                        values[position] = value
                    else:
                        failed.append(position)
                        logger.debug(
                            f"Failed to fetch TED domains for "
                            f"{self.headers[position]}: {error}"
                        )
                    pbar.update(1)
            # Finished out of order; the final pass goes in input order.
            failed.sort()

            lost = self._retry_failed(session, failed, values) if failed else []
        self.failed_lookup_count = len(lost)

        return [
            ProteinAnnotations(identifier=accession, annotations={"ted_domains": value})
            for accession, value in zip(self.headers, values, strict=True)
        ]

    def _retry_failed(
        self, session: PooledSession, failed: list[int], values: list[str]
    ) -> list[str]:
        """Look up the first pass's failures again, filling *values* in place.

        Returns the accessions still failing. After
        ``_FINAL_PASS_MAX_CONSECUTIVE_FAILURES`` failures in a row, counted
        in input order, the service is taken to be down: no further lookup is
        started, the lookups still retrying give up after their current
        attempt, and every accession whose result was not used counts as
        failed.
        """
        lost: list[str] = []
        consecutive = 0
        final_pass = map_in_order(
            lambda position: self._try_lookup(
                session, self.headers[position], attempts=MAX_ATTEMPTS
            ),
            failed,
            self.max_concurrent_requests,
            stop=session.stop,
        )
        with (
            tqdm(
                total=len(failed), desc="Retrying failed TED lookups", unit="seq"
            ) as pbar,
            closing(final_pass) as lookups,
        ):
            for done, (value, error) in enumerate(lookups):
                position = failed[done]
                accession = self.headers[position]
                if error is None:
                    values[position] = value
                    consecutive = 0
                else:
                    lost.append(accession)
                    consecutive += 1
                    logger.debug(f"TED retry failed for {accession}: {error}")
                pbar.update(1)
                if consecutive >= _FINAL_PASS_MAX_CONSECUTIVE_FAILURES:
                    lost.extend(self.headers[p] for p in failed[done + 1 :])
                    break

        recovered = len(failed) - len(lost)
        if lost:
            shown = ", ".join(lost[:_PREVIEW]) + (
                ", ..." if len(lost) > _PREVIEW else ""
            )
            logger.warning(
                f"TED lookups: recovered {recovered} of {len(failed)} that failed "
                f"in the first pass; {len(lost)} still failed ({shown}). TED "
                "domains are incomplete and will not be cached."
            )
        else:
            logger.info(f"TED lookups: recovered all {recovered} first-pass failures")
        return lost

    def _try_lookup(
        self, session: requests.Session, accession: str, attempts: int
    ) -> tuple[str, Exception | None]:
        """One accession's formatted domains, or the error its lookup raised.

        Returned rather than raised, so a parallel pass keeps every other
        lookup's result and counts the failure where the caller reads it.
        """
        try:
            return self._lookup(accession, attempts=attempts, session=session), None
        except Exception as e:
            return "", e

    def _lookup(
        self, accession: str, attempts: int, session: requests.Session | None = None
    ) -> str:
        """Fetch and format one accession's TED domains."""
        return self._format_domains(
            self._fetch_domains(accession, attempts=attempts, session=session)
        )

    def _fetch_domains(
        self,
        accession: str,
        attempts: int = _MAX_ATTEMPTS,
        session: requests.Session | None = None,
    ) -> list[dict]:
        """Fetch TED domains for a single protein from AlphaFold DB API."""
        url = f"{ALPHAFOLD_DOMAINS_URL}/{accession}"
        # One request per protein, so the first-pass retry budget is
        # deliberately small: on a full AlphaFold outage the backoff is paid
        # once per accession. The final pass raises it for the few failures.
        try:
            resp = get_with_retry(
                url, timeout=_API_TIMEOUT, attempts=attempts, session=session
            )
        except requests.HTTPError as exc:
            resp = exc.response
            if resp is None or resp.status_code != 404:
                raise
        if resp.status_code == 404:
            # AlphaFold has no entry for this accession -- a real absence, the
            # normal answer for a non-UniProt identifier or an unmodelled
            # protein. Raising here would count it as a lost lookup and keep
            # the whole TED column out of the cache on every ordinary run.
            return []
        resp.raise_for_status()
        data = resp.json()

        if not data or "annotations" not in data:
            return []

        return data["annotations"]

    def _format_domains(self, domains: list[dict]) -> str:
        """Format TED domains as semicolon-separated string.

        Format: "{cath_label} ({cath_name})|{plddt}", falling back to
        "{cath_label}|{plddt}" when no CATH name resolves, and to "-|{plddt}"
        for a domain with no CATH assignment.
        Example: "2.60.40.720 (Immunoglobulin-like)|95.1;-|88.3"
        """
        if not domains:
            return ""

        parts = []
        for domain in domains:
            cath_label = domain.get("cath_label") or _UNLABELED_CATH
            # `or 0` (not a `.get` default): the key can be present and null,
            # and formatting None would raise inside the caller's blanket
            # `except`, silently dropping every domain of this accession.
            plddt = domain.get("plddt") or 0

            name = (
                self._resolve_cath_name(cath_label)
                if cath_label != _UNLABELED_CATH
                else ""
            )
            label = f"{cath_label} ({encode_field(name)})" if name else cath_label
            parts.append(f"{label}|{plddt:.1f}")

        return ";".join(parts)

    def _resolve_cath_name(self, cath_label: str) -> str:
        """Resolve a CATH code (any level) to a human-readable name.

        Uses the official CATH names file which covers all 4 hierarchy levels.
        """
        if self._cath_names is None:
            with self._cath_names_lock:
                if self._cath_names is None:
                    self._cath_names = get_cath_names()
        return self._cath_names.get(cath_label, "")
