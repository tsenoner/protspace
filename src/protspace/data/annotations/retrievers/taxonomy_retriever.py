import logging
from typing import Any

from tqdm import tqdm

from protspace.data.annotations.retrievers.base_retriever import BaseAnnotationRetriever
from protspace.data.annotations.retrievers.http_utils import paginated_get

logger = logging.getLogger(__name__)

TAXONOMY_API_URL = "https://rest.uniprot.org/taxonomy/search"
_BATCH_SIZE = 100  # Max taxon IDs per request (URL length safety)

# Taxonomy annotations
TAXONOMY_ANNOTATIONS = [
    "root",
    "domain",
    "kingdom",
    "phylum",
    "class",
    "order",
    "family",
    "genus",
    "species",
]


class TaxonomyRetriever(BaseAnnotationRetriever):
    """Retrieves taxonomy lineage data from the UniProt Taxonomy API."""

    def __init__(self, taxon_ids: list[int], annotations: list = None):
        # Don't call super().__init__() as we use taxon_ids instead of headers
        self.taxon_ids = self._validate_taxon_ids(taxon_ids)
        self.annotations = annotations

    def fetch_annotations(self) -> dict[int, dict[str, Any]]:
        result = {}

        with tqdm(
            total=len(self.taxon_ids),
            desc="Fetching taxonomy annotations",
            unit="taxon",
        ) as pbar:
            taxonomies_info = self._get_taxonomy_info(self.taxon_ids)

            for taxon_id in self.taxon_ids:
                if taxon_id in taxonomies_info:
                    result[taxon_id] = {"annotations": taxonomies_info[taxon_id]}
                else:
                    result[taxon_id] = {
                        "annotations": dict.fromkeys(self.annotations, "")
                    }
                pbar.update(1)

        return result

    def _validate_taxon_ids(self, taxon_ids: list[int]) -> list[int]:
        for taxon_id in taxon_ids:
            if not isinstance(taxon_id, int):
                raise ValueError(f"Taxon ID {taxon_id} is not an integer")
        return taxon_ids

    def _get_taxonomy_info(self, taxon_ids: list[int]) -> dict[int, dict[str, str]]:
        result = {}

        # Fetch in batches to stay within URL length limits
        for i in range(0, len(taxon_ids), _BATCH_SIZE):
            batch = taxon_ids[i : i + _BATCH_SIZE]
            batch_results = self._fetch_batch(batch)
            result.update(batch_results)

        return result

    def _fetch_batch(self, taxon_ids: list[int]) -> dict[int, dict[str, str]]:
        """Fetch taxonomy info for a batch of taxon IDs from UniProt Taxonomy API."""
        result = {}
        query = " OR ".join(f"id:{tid}" for tid in taxon_ids)

        try:
            entries = paginated_get(
                TAXONOMY_API_URL,
                params={"query": query, "format": "json", "size": "500"},
            )
            for entry in entries:
                taxon_id = entry.get("taxonId")
                if taxon_id is not None:
                    result[taxon_id] = self._extract_taxonomy(entry)

        except Exception as e:
            logger.error(f"Failed to fetch taxonomy batch: {e}")
            for tid in taxon_ids:
                if tid not in result:
                    result[tid] = dict.fromkeys(self.annotations, "")

        return result

    def _extract_taxonomy(self, entry: dict) -> dict[str, str]:
        """Extract taxonomy ranks from a UniProt Taxonomy API result."""
        lineage = entry.get("lineage", [])
        rank_map = {item["rank"]: item["scientificName"] for item in lineage}

        # The lineage only contains ancestors. If the taxon itself is a
        # species (e.g., Human 9606), include it from the entry's own rank.
        own_rank = entry.get("rank", "")
        if own_rank and own_rank not in rank_map:
            rank_map[own_rank] = entry.get("scientificName", "")

        full_taxonomy_info = {
            "root": rank_map.get("no rank", ""),
            "domain": rank_map.get("domain", "") or rank_map.get("realm", ""),
            "kingdom": rank_map.get("kingdom", ""),
            "phylum": rank_map.get("phylum", ""),
            "class": rank_map.get("class", ""),
            "order": rank_map.get("order", ""),
            "family": rank_map.get("family", ""),
            "genus": rank_map.get("genus", ""),
            "species": rank_map.get("species", ""),
        }

        # Filter based on requested taxonomy annotations
        return {
            annotation: full_taxonomy_info.get(annotation, "")
            for annotation in self.annotations
        }
