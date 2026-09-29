"""TED (The Encyclopedia of Domains) retriever via AlphaFold Database API."""

import logging

import requests
from tqdm import tqdm

from protspace.data.annotations.encoding import encode_field
from protspace.data.annotations.retrievers.base_retriever import BaseAnnotationRetriever
from protspace.data.annotations.retrievers.cath_names import get_cath_names
from protspace.data.annotations.retrievers.http_utils import (
    MAX_ATTEMPTS,
    get_with_retry,
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

TED_ANNOTATIONS = ["ted_domains"]

# TED's own label for a domain with no CATH assignment.
_UNLABELED_CATH = "-"


class TedRetriever(BaseAnnotationRetriever):
    """Retrieves TED domain annotations from the AlphaFold Database API."""

    def __init__(self, headers: list[str] = None, annotations: list = None):
        # Don't call super().__init__() as we don't need standard header management
        self.headers = headers or []
        self.annotations = annotations
        self._cath_names = None
        # Accessions whose lookup still failed after the final retry pass, as
        # opposed to having no domains.
        self.failed_lookup_count = 0

    def fetch_annotations(self) -> list[tuple]:
        """Fetch TED domain annotations for all proteins.

        Lookups that fail in the first pass are retried once more after it,
        with the default retry budget, by which time a transient outage has
        usually passed. Only lookups still failing then count as failed.
        """
        from protspace.data.annotations.retrievers.uniprot_retriever import (
            ProteinAnnotations,
        )

        values: list[str] = []
        failed: list[int] = []  # positions whose first-pass lookup raised

        with tqdm(
            total=len(self.headers),
            desc="Fetching TED domain annotations",
            unit="seq",
        ) as pbar:
            for position, accession in enumerate(self.headers):
                try:
                    values.append(self._lookup(accession, attempts=_MAX_ATTEMPTS))
                except Exception as e:
                    failed.append(position)
                    logger.debug(f"Failed to fetch TED domains for {accession}: {e}")
                    values.append("")
                pbar.update(1)

        lost = self._retry_failed(failed, values) if failed else []
        self.failed_lookup_count = len(lost)

        return [
            ProteinAnnotations(identifier=accession, annotations={"ted_domains": value})
            for accession, value in zip(self.headers, values, strict=True)
        ]

    def _retry_failed(self, failed: list[int], values: list[str]) -> list[str]:
        """Look up the first pass's failures again, filling *values* in place.

        Returns the accessions still failing. After
        ``_FINAL_PASS_MAX_CONSECUTIVE_FAILURES`` failures in a row the service
        is taken to be down, and every accession not yet retried counts as
        failed without another request.
        """
        lost: list[str] = []
        consecutive = 0
        with tqdm(
            total=len(failed), desc="Retrying failed TED lookups", unit="seq"
        ) as pbar:
            for done, position in enumerate(failed):
                if consecutive >= _FINAL_PASS_MAX_CONSECUTIVE_FAILURES:
                    lost.extend(self.headers[p] for p in failed[done:])
                    break
                accession = self.headers[position]
                try:
                    values[position] = self._lookup(accession, attempts=MAX_ATTEMPTS)
                    consecutive = 0
                except Exception as e:
                    lost.append(accession)
                    consecutive += 1
                    logger.debug(f"TED retry failed for {accession}: {e}")
                pbar.update(1)

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

    def _lookup(self, accession: str, attempts: int) -> str:
        """Fetch and format one accession's TED domains."""
        return self._format_domains(self._fetch_domains(accession, attempts=attempts))

    def _fetch_domains(
        self, accession: str, attempts: int = _MAX_ATTEMPTS
    ) -> list[dict]:
        """Fetch TED domains for a single protein from AlphaFold DB API."""
        url = f"{ALPHAFOLD_DOMAINS_URL}/{accession}"
        # One request per protein, so the first-pass retry budget is
        # deliberately small: on a full AlphaFold outage the backoff is paid
        # once per accession. The final pass raises it for the few failures.
        try:
            resp = get_with_retry(url, timeout=_API_TIMEOUT, attempts=attempts)
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
            self._cath_names = get_cath_names()
        return self._cath_names.get(cath_label, "")
