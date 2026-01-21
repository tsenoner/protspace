"""
UniProt annotation retriever.

This module fetches protein annotations from the UniProt API.
"""

import logging
from collections import namedtuple

from tqdm import tqdm
from unipressed import UniprotkbClient

from protspace.data.annotations.retrievers.base_retriever import BaseAnnotationRetriever
from protspace.data.parsers.uniprot_parser import UniProtEntry

logging.basicConfig(format="%(levelname)s: %(message)s")
logger = logging.getLogger(__name__)

# UniProt annotations - these are the current protspace annotations
UNIPROT_ANNOTATIONS = [
    "annotation_score",
    "cc_subcellular_location",
    "fragment",
    "gene_name",
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

        with tqdm(
            total=len(self.headers), desc="Fetching UniProt annotations", unit="seq"
        ) as pbar:
            for i in range(0, len(self.headers), batch_size):
                batch = self.headers[i : i + batch_size]

                try:
                    # Fetch records using unipressed
                    records = UniprotkbClient.fetch_many(batch)

                    # Parse each record and extract raw properties for tmp storage
                    for record in records:
                        entry = UniProtEntry(record)
                        identifier = entry.entry

                        # Extract UNIPROT_ANNOTATIONS
                        annotations_dict = {}
                        for prop in UNIPROT_ANNOTATIONS:
                            try:
                                value = getattr(entry, prop)
                                # Store raw values, convert to strings for CSV/Parquet compatibility
                                if isinstance(value, list):
                                    # Join list values with semicolon (raw format)
                                    annotations_dict[prop] = (
                                        ";".join(str(v) for v in value) if value else ""
                                    )
                                elif isinstance(value, bool):
                                    # Store bool as string
                                    annotations_dict[prop] = str(value)
                                elif value is None or value == "":
                                    annotations_dict[prop] = ""
                                else:
                                    # Store as string
                                    annotations_dict[prop] = str(value)
                            except (KeyError, AttributeError, IndexError):
                                annotations_dict[prop] = ""

                        result.append(
                            ProteinAnnotations(
                                identifier=identifier, annotations=annotations_dict
                            )
                        )

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
