import csv
import pandas as pd
from tqdm import tqdm
from typing import List
from pathlib import Path
from bioservices import UniProt

import logging

logging.basicConfig(format="%(levelname)s: %(message)s")
logger = logging.getLogger(__name__)

# UniProt features
# TODO: Add more features
FEATURES = ['protein_existence', 'annotation_score']

class ProteinFeatureExtractor:
    def __init__(
        self,
        headers: List[str],
        features: List,
        csv_output: Path
    ):
        self.headers = headers
        self.features = FEATURES if features is None else self._validate_features(features)
        self.u = UniProt(verbose=False)
        self.csv_output = csv_output

    def to_pd(self) -> pd.DataFrame:
        fetched_data = self.get_uniprot_features()
        self.save_csv(fetched_data)
        return pd.read_csv(self.csv_output)
    
    def get_uniprot_features(self) -> str:
        batch_size = 100
        all_data = []
        first_batch = True
        
        for i in tqdm(range(0, len(self.headers), batch_size), desc="Fetching UniProt features", unit="batch"):
            batch = self.headers[i:i+batch_size]
            query = '+OR+'.join([f"accession:{accession}" for accession in batch])
            columns = ','.join(self.features)
            
            data = self.u.search(
                query=query,
                columns=columns
            )
            
            if data:
                if first_batch:
                    all_data.append(data)
                    first_batch = False
                else:
                    # Skip the header
                    all_data.append('\n'.join(data.strip().split('\n')[1:]))
        
        fetched_data = '\n'.join(all_data) if all_data else ""
        return fetched_data
    
    def save_csv(self, fetched_data: str):
        lines = fetched_data.strip().split('\n')
        
        csv_headers = ["identifier"] + self.features[1:] # Skip "accession" from self.features
        data_rows = [line.split('\t') for line in lines[1:]]
        
        with open(self.csv_output, 'w', newline='') as f:
            writer = csv.writer(f)
            writer.writerow(csv_headers)
            for row in data_rows:
                writer.writerow(row)
        
    def _validate_features(self, features: List) -> str:
        for feature in features:
            if feature not in FEATURES:
                raise ValueError(f"Feature {feature} not found in feature map")
        
        if "accession" in features:
            features.remove("accession")

        return ["accession"] + features
