import logging
from typing import List, Dict, Any
from pathlib import Path
from tqdm import tqdm
from datetime import datetime, timedelta
import taxopy

logging.basicConfig(format="%(levelname)s: %(message)s")
logger = logging.getLogger(__name__)

# Taxonomy features
TAXONOMY_FEATURES = [
    "taxon_name",
    "superkingdom",
    "kingdom",
    "phylum",
    "class",
    "order",
    "family",
    "genus",
    "species",
]


class TaxonomyFeatureRetriever:
    def __init__(self, taxon_ids: List[int], features: List = None):
        self.taxon_ids = self._validate_taxon_ids(taxon_ids)
        self.features = features
        self.taxdb = self._initialize_taxdb()

    def fetch_features(self) -> Dict[int, Dict[str, Any]]:
        result = {}

        with tqdm(
            total=len(self.taxon_ids), desc="Fetching taxonomy features", unit="taxon"
        ) as pbar:
            taxonomies_info = self._get_taxonomy_info(self.taxon_ids)

            for taxon_id in self.taxon_ids:
                if taxon_id in taxonomies_info:
                    result[taxon_id] = {"features": taxonomies_info[taxon_id]}
                else:
                    result[taxon_id] = {
                        "features": {feature: "" for feature in self.features}
                    }
                pbar.update(1)

        return result

    def _validate_taxon_ids(self, taxon_ids: List[int]) -> List[int]:
        for taxon_id in taxon_ids:
            if type(taxon_id) != int:
                raise ValueError(f"Taxon ID {taxon_id} is not an integer")

        return taxon_ids

    def _get_taxonomy_info(self, taxon_ids: List[int]) -> Dict[int, Dict[str, str]]:
        result = {}

        for taxon_id in taxon_ids:
            try:
                taxon = taxopy.Taxon(taxon_id, self.taxdb)
                ranks = taxon.rank_name_dictionary

                # Fetch all available taxonomy information
                full_taxonomy_info = {
                    "taxon_name": taxon.name,
                    "superkingdom": ranks.get("superkingdom", ""),
                    "kingdom": ranks.get("kingdom", ""),
                    "phylum": ranks.get("phylum", ""),
                    "class": ranks.get("class", ""),
                    "order": ranks.get("order", ""),
                    "family": ranks.get("family", ""),
                    "genus": ranks.get("genus", ""),
                    "species": ranks.get("species", ""),
                }

                # Filter based on requested features
                taxonomy_info = {
                    feature: full_taxonomy_info.get(feature, "")
                    for feature in self.features
                }

                result[taxon_id] = taxonomy_info

            except Exception as e:
                logger.error(f"Failed to get taxonomy for {taxon_id}: {e}")
                result[taxon_id] = {feature: "" for feature in self.features}

        return result

    def _initialize_taxdb(self):
        home_dir = Path.home() / ".cache"
        db_dir = home_dir / "taxopy_db"
        db_dir.mkdir(parents=True, exist_ok=True)
        nodes_file = db_dir / "nodes.dmp"
        names_file = db_dir / "names.dmp"
        merged_file = db_dir / "merged.dmp"
        timestamp_file = db_dir / ".download_timestamp"

        # Check if cache needs refresh based on timestamp file
        needs_refresh = False
        if timestamp_file.exists():
            try:
                with open(timestamp_file, "r") as f:
                    download_time = datetime.fromisoformat(f.read().strip())
                one_week_ago = datetime.now() - timedelta(weeks=1)

                if download_time < one_week_ago:
                    logger.info(
                        "Your taxonomy dataset is more than one week old. Refreshing cache..."
                    )
                    print(
                        "Your taxonomy dataset is more than one week old. Refreshing cache..."
                    )
                    needs_refresh = True
            except (ValueError, OSError) as e:
                logger.warning(
                    f"Could not read timestamp file: {e}. Will refresh cache."
                )
                print(f"Could not read timestamp file: {e}. Will refresh cache.")
                needs_refresh = True
        else:
            # No timestamp file means we should download
            needs_refresh = True

        # Remove old files if refresh is needed
        if needs_refresh:
            for file_path in [nodes_file, names_file, merged_file, timestamp_file]:
                if file_path.exists():
                    file_path.unlink()

        # Load or download the database
        if nodes_file.exists() and names_file.exists() and not needs_refresh:
            logger.info(f"Loading existing taxopy database from {db_dir}")
            taxdb = taxopy.TaxDb(
                nodes_dmp=str(nodes_file),
                names_dmp=str(names_file),
                merged_dmp=str(merged_file) if merged_file.exists() else None,
            )
        else:
            logger.info(f"Downloading taxopy database to {db_dir}")
            taxdb = taxopy.TaxDb(taxdb_dir=str(db_dir), keep_files=True)

            # Create timestamp file after successful download
            with open(timestamp_file, "w") as f:
                f.write(datetime.now().isoformat())

        return taxdb
