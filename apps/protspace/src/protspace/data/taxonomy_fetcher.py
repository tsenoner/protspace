import logging
from typing import List, Dict, Any
from pathlib import Path
from tqdm import tqdm
import taxopy

logging.basicConfig(format="%(levelname)s: %(message)s")
logger = logging.getLogger(__name__)

# Taxonomy features 
TAXONOMY_FEATURES = ['taxon_name', 'genus']

class TaxonomyFetcher:
    def __init__(
        self,
        taxon_ids: List[int],
        features: List = None
    ):
        self.taxon_ids = self._validate_taxon_ids(taxon_ids)
        self.features = features or TAXONOMY_FEATURES
        self.taxdb = self._initialize_taxdb()
    
    def fetch_features(self) -> Dict[int, Dict[str, Any]]:
        result = {}
        
        with tqdm(total=len(self.taxon_ids), desc="Fetching taxonomy features", unit="taxon") as pbar:
            taxonomies_info = self._get_taxonomy_info(self.taxon_ids)
            
            for taxon_id in self.taxon_ids:
                if taxon_id in taxonomies_info:
                    result[taxon_id] = {
                        "features": taxonomies_info[taxon_id]
                    }
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

                taxonomy_info = {
                    "taxon_name": taxon.name,
                    # "superkingdom": ranks.get("superkingdom", ""),
                    # "kingdom": ranks.get("kingdom", ""),
                    # "phylum": ranks.get("phylum", ""),
                    # "class": ranks.get("class", ""),
                    # "order": ranks.get("order", ""),
                    # "family": ranks.get("family", ""),
                    "genus": ranks.get("genus", ""),
                    # "species": ranks.get("species", "")
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
        
        # Load or download the database
        if nodes_file.exists() and names_file.exists():
            logger.info(f"Loading existing taxopy database from {db_dir}")
            taxdb = taxopy.TaxDb(
                nodes_dmp=str(nodes_file),
                names_dmp=str(names_file),
                merged_dmp=str(merged_file),
            )
        else:
            logger.info(f"Downloading taxopy database to {db_dir}")
            taxdb = taxopy.TaxDb(taxdb_dir=str(db_dir), keep_files=True)
        
        return taxdb