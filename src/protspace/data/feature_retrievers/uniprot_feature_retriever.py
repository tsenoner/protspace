import logging
from collections import namedtuple
from typing import NamedTuple

from bioservices import UniProt
from tqdm import tqdm

logging.basicConfig(format="%(levelname)s: %(message)s")
logger = logging.getLogger(__name__)

# UniProt features
# TODO: Add more features
UNIPROT_FEATURES = [
    "protein_existence",
    "annotation_score",
    "protein_families",
    "length",
    "reviewed",
    "fragment",
    "cc_subcellular_location",
    "sequence",
]

ProteinFeatures = namedtuple("ProteinFeatures", ["identifier", "features"])


class UniProtFeatureRetriever:
    def __init__(self, headers: list[str] = None, features: list = None):
        self.headers = self._manage_headers(headers) if headers else []
        self.features = features
        self.u = UniProt(verbose=False)

    def fetch_features(self) -> list[NamedTuple]:
        batch_size = 100
        all_data = []
        first_batch = True
        result = []

        with tqdm(
            total=len(self.headers), desc="Fetching UniProt features", unit="seq"
        ) as pbar:
            for i in range(0, len(self.headers), batch_size):
                batch = self.headers[i : i + batch_size]
                query = "+OR+".join([f"accession:{accession}" for accession in batch])
                columns = ",".join(self.features)

                data = self.u.search(query=query, columns=columns)

                if data:
                    if first_batch:
                        all_data.append(data)
                        first_batch = False
                    else:
                        all_data.append("\n".join(data.strip().split("\n")[1:]))

                pbar.update(len(batch))

        fetched_data = "\n".join(all_data) if all_data else ""

        lines = fetched_data.strip().split("\n")
        csv_headers = ["identifier"] + self.features[1:]
        data_rows = [line.split("\t") for line in lines[1:]]

        for row in data_rows:
            identifier = row[0]
            features = {
                csv_headers[i]: row[i]
                for i in range(1, len(csv_headers))
                if i < len(row)
            }
            result.append(ProteinFeatures(identifier=identifier, features=features))

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
