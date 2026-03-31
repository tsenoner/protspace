"""TED (The Encyclopedia of Domains) retriever via AlphaFold Database API."""

import logging

import requests
from tqdm import tqdm

from protspace.data.annotations.retrievers.base_retriever import BaseAnnotationRetriever
from protspace.data.annotations.retrievers.cath_names import get_cath_names

logger = logging.getLogger(__name__)

ALPHAFOLD_DOMAINS_URL = "https://alphafold.ebi.ac.uk/api/domains"
_API_TIMEOUT = 10

TED_ANNOTATIONS = ["ted_domains"]


class TedRetriever(BaseAnnotationRetriever):
    """Retrieves TED domain annotations from the AlphaFold Database API."""

    def __init__(self, headers: list[str] = None, annotations: list = None):
        # Don't call super().__init__() as we don't need standard header management
        self.headers = headers or []
        self.annotations = annotations
        self._cath_names = None

    def fetch_annotations(self) -> list[tuple]:
        """Fetch TED domain annotations for all proteins."""
        from protspace.data.annotations.retrievers.uniprot_retriever import (
            ProteinAnnotations,
        )

        result = []

        with tqdm(
            total=len(self.headers),
            desc="Fetching TED domain annotations",
            unit="seq",
        ) as pbar:
            for accession in self.headers:
                try:
                    domains = self._fetch_domains(accession)
                    ted_value = self._format_domains(domains)
                except Exception as e:
                    logger.debug(f"Failed to fetch TED domains for {accession}: {e}")
                    ted_value = ""

                result.append(
                    ProteinAnnotations(
                        identifier=accession,
                        annotations={"ted_domains": ted_value},
                    )
                )
                pbar.update(1)

        return result

    def _fetch_domains(self, accession: str) -> list[dict]:
        """Fetch TED domains for a single protein from AlphaFold DB API."""
        url = f"{ALPHAFOLD_DOMAINS_URL}/{accession}"
        resp = requests.get(url, timeout=_API_TIMEOUT)
        resp.raise_for_status()
        data = resp.json()

        if not data or "annotations" not in data:
            return []

        return data["annotations"]

    def _format_domains(self, domains: list[dict]) -> str:
        """Format TED domains as semicolon-separated string.

        Format: "{cath_label} ({cath_name})|{plddt}"
        Example: "2.60.40.720 (Immunoglobulin-like)|95.1;3.40.50.300 (P-loop NTPases)|88.3"
        """
        if not domains:
            return ""

        parts = []
        for domain in domains:
            cath_label = domain.get("cath_label", "-")
            plddt = domain.get("plddt", 0)

            if cath_label and cath_label != "-":
                name = self._resolve_cath_name(cath_label)
                if name:
                    parts.append(f"{cath_label} ({name})|{plddt:.1f}")
                else:
                    parts.append(f"{cath_label}|{plddt:.1f}")
            else:
                parts.append(f"unclassified|{plddt:.1f}")

        return ";".join(parts)

    def _resolve_cath_name(self, cath_label: str) -> str:
        """Resolve a CATH code (any level) to a human-readable name.

        Uses the official CATH names file which covers all 4 hierarchy levels.
        """
        if self._cath_names is None:
            self._cath_names = get_cath_names()
        return self._cath_names.get(cath_label, "")
