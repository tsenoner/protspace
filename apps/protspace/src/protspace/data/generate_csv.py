import csv
import pandas as pd
from typing import List, Union, Tuple
from pathlib import Path

from .uniprot_fetcher import UniProtFetcher, UNIPROT_FEATURES, ProteinFeatures
from .taxonomy_fetcher import TaxonomyFetcher, TAXONOMY_FEATURES

import logging

logging.basicConfig(format="%(levelname)s: %(message)s")
logger = logging.getLogger(__name__)

DEFAULT_FEATURES = UNIPROT_FEATURES + TAXONOMY_FEATURES
NEEDED_UNIPROT_FEATURES = ["accession", "organism_id"]

class ProteinFeatureExtractor:
    def __init__(
        self,
        headers: List[str],
        features: List = None,
        csv_output: Path = None
    ):
        self.headers = headers
        self.uniprot_features, self.taxonomy_features = self._initialize_features(features)
        self.csv_output = csv_output

    def to_pd(self) -> pd.DataFrame:
        # We always have at least one uniprot feature, if only taxonomy provided we need the organism_id from uniprot
        fetched_uniprot = self.get_uniprot_features(self.headers, self.uniprot_features)

        taxon_counts = self._get_taxon_counts(fetched_uniprot)
        unique_taxons = list(taxon_counts.keys())
        taxonomy_features = self.get_taxonomy_features(unique_taxons, self.taxonomy_features)

        all_features = self._merge_features(fetched_uniprot, taxonomy_features)

        self.save_csv(all_features)
        return pd.read_csv(self.csv_output)
    
    def get_uniprot_features(self, headers: List[str], features: List[str]) -> List[ProteinFeatures]:
        uniprot_fetcher = UniProtFetcher(headers, features)
        return uniprot_fetcher.fetch_features() 
    
    def get_taxonomy_features(self, taxons: List[int], features: List[str]) -> str:
        taxonomy_fetcher = TaxonomyFetcher(taxons, features)
        return taxonomy_fetcher.fetch_features()
    
    def save_csv(self, fetched_uniprot: List[ProteinFeatures]):
        with open(self.csv_output, 'w', newline='') as f:
            writer = csv.writer(f)
            csv_headers = ["identifier"] + list(fetched_uniprot[0].features.keys()) if fetched_uniprot else ["identifier"]
            writer.writerow(csv_headers)
            
            for protein in fetched_uniprot:
                row = [protein.identifier] + [protein.features.get(header, '') for header in csv_headers[1:]]
                modified_row = self._modify_if_needed(row, csv_headers)
                writer.writerow(modified_row)
    
    def _get_taxon_counts(self, fetched_uniprot: List[ProteinFeatures]) -> dict:
        """Returns a dictionary with organism IDs as keys and their occurrence counts as values."""
        id_counts = {}
        
        for protein in fetched_uniprot:
            organism_id = protein.features.get('organism_id')
            if organism_id:
                org_id = int(organism_id)
                id_counts[org_id] = id_counts.get(org_id, 0) + 1
        
        return id_counts
    
    def _modify_if_needed(
        self,
        row: List,
        csv_headers: List
    ) -> List:
        
        modified_row = row.copy()
        
        if 'annotation_score' in csv_headers:
            idx = csv_headers.index('annotation_score')
            if idx < len(row) and row[idx]:
                try:
                    modified_row[idx] = str(int(float(row[idx])))
                except (ValueError, TypeError):
                    pass
                    
        return modified_row
    
    def _initialize_features(self, features: List[str]) -> Tuple[List[str], Union[List[str], None]]:
        
        self._validate_features(features)

        uniprot_features = [feature for feature in features if feature in UNIPROT_FEATURES]
        taxonomy_features = [feature for feature in features if feature in TAXONOMY_FEATURES]

        uniprot_features = self._modify_uniprot_features(uniprot_features)

        # We have taxonomy, so we need the organism_ids in uniprot_features
        if taxonomy_features:
            return uniprot_features, taxonomy_features
        
        # We have other features than the needed ones
        elif len(uniprot_features) > len(NEEDED_UNIPROT_FEATURES):
            return uniprot_features, None
        
        else:
            logger.info("No features provided, using default UniProt features")
            return UNIPROT_FEATURES, None
    
    def _validate_features(
        self,
        user_features: List[str],
        default_features: List[str] = DEFAULT_FEATURES
    ) -> str:
        for feature in user_features:
            if feature not in default_features:
                raise ValueError(f"Feature {feature} is not a valid feature. Valid features are: {default_features}")
    
    def _modify_uniprot_features(self, features: List[str]) -> List[str]:
        filtered_features = [f for f in features if f not in NEEDED_UNIPROT_FEATURES]
        return NEEDED_UNIPROT_FEATURES + filtered_features
    
    def _merge_features(
        self,
        fetched_uniprot: List[ProteinFeatures],
        taxonomy_features: dict
    ) -> List[ProteinFeatures]:
        
        merged_features = []
        
        # First, we'll analyze taxonomy features to find the top 9 most frequent values for each feature
        feature_value_counts = {}
        
        # Collect all values for each taxonomy feature
        for org_id, tax_data in taxonomy_features.items():
            for feature_name, feature_value in tax_data['features'].items():
                if feature_name not in feature_value_counts:
                    feature_value_counts[feature_name] = {}
                
                if feature_value not in feature_value_counts[feature_name]:
                    feature_value_counts[feature_name][feature_value] = 0
                
                feature_value_counts[feature_name][feature_value] += 1
        
        # Determine top 9 values for each feature
        top_values = {}
        for feature_name, counts in feature_value_counts.items():
            # Sort values by count (descending) and take top 9
            sorted_values = sorted(counts.items(), key=lambda x: x[1], reverse=True)
            top_values[feature_name] = {val[0] for val in sorted_values[:9]}
        
        # Process each protein
        for protein in fetched_uniprot:
            organism_id = protein.features.get('organism_id')
            
            # Create a copy of the protein to avoid modifying the original
            updated_protein = ProteinFeatures(
                identifier=protein.identifier,
                features=protein.features.copy()
            )
            
            # If this organism_id has taxonomy features, add them to the protein
            if organism_id and int(organism_id) in taxonomy_features:
                tax_features = taxonomy_features[int(organism_id)]['features']
                
                # Add each taxonomy feature to the protein features
                for feature_name, feature_value in tax_features.items():
                    # Check if this value is in the top 9 for this feature
                    if feature_name in top_values and feature_value in top_values[feature_name]:
                        updated_protein.features[feature_name] = feature_value
                    else:
                        updated_protein.features[feature_name] = "other"
            
            merged_features.append(updated_protein)
        
        return merged_features
