import logging
from collections import namedtuple

from tqdm import tqdm
from unipressed import UniprotkbClient

from protspace.data.parsers.uniprot_parser import UniProtEntry

logging.basicConfig(format="%(levelname)s: %(message)s")
logger = logging.getLogger(__name__)

# UniProt features - these are the current protspace features
UNIPROT_FEATURES = [
    "annotation_score",
    "cc_subcellular_location",
    "fragment",
    "length",
    "organism_id",
    "protein_existence",
    "protein_families",
    "reviewed",
    "sequence",
    "xref_pdb",
]

ProteinFeatures = namedtuple("ProteinFeatures", ["identifier", "features"])


class UniProtFeatureRetriever:
    def __init__(self, headers: list[str] = None, features: list = None):
        self.headers = self._manage_headers(headers) if headers else []
        self.features = features

    def fetch_features(self) -> list[ProteinFeatures]:
        """
        Fetch raw UniProt properties and store in tmp files.
        Stores UNIPROT_FEATURES with minimal processing.
        Processing/transformation happens later in feature_manager.
        """
        batch_size = 100
        result = []

        with tqdm(
            total=len(self.headers), desc="Fetching UniProt features", unit="seq"
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

                        # Extract UNIPROT_FEATURES with minimal processing
                        features_dict = {}
                        for prop in UNIPROT_FEATURES:
                            try:
                                value = getattr(entry, prop)
                                # Store raw values, convert to strings for CSV/Parquet compatibility
                                if isinstance(value, list):
                                    # Join list values with semicolon (raw format)
                                    features_dict[prop] = (
                                        ";".join(str(v) for v in value) if value else ""
                                    )
                                elif isinstance(value, bool):
                                    # Store bool as string
                                    features_dict[prop] = str(value)
                                elif value is None or value == "":
                                    features_dict[prop] = ""
                                else:
                                    # Store as string
                                    features_dict[prop] = str(value)
                            except (KeyError, AttributeError, IndexError):
                                features_dict[prop] = ""

                        result.append(
                            ProteinFeatures(
                                identifier=identifier, features=features_dict
                            )
                        )

                except Exception as e:
                    logger.warning(f"Failed to fetch batch {i}-{i + batch_size}: {e}")
                    # Add empty features for failed proteins
                    for accession in batch:
                        result.append(
                            ProteinFeatures(
                                identifier=accession,
                                features=dict.fromkeys(UNIPROT_FEATURES, ""),
                            )
                        )

                pbar.update(len(batch))

        return result

    def _manage_headers(self, headers: list[str]) -> list[str]:
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
