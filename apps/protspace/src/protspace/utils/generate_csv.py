import logging
from typing import List, Union
from pathlib import Path
import csv
from bioservices import UniProt
import pandas as pd

from ..config import FEATURES

logging.basicConfig(format="%(levelname)s: %(message)s")
logger = logging.getLogger(__name__)

class ProteinFeatureExtractor:
    def __init__(
        self,
        protein_ids: Union[List[str], Path],
        features: List,
        csv_output: Path
    ):
        self.protein_ids = protein_ids
        self.features = FEATURES if features is None else self._validate_features(features)
        self.u = UniProt(verbose=False)

        self.csv_output = csv_output
        self._data = None
    

    def to_pd(self) -> pd.DataFrame:
        self.get_uniprot_features()
        self.save_csv()
        return pd.read_csv(self.csv_output)
    
    def get_uniprot_features(self) -> str:
        query = '+OR+'.join([f"id:{protein_id}" for protein_id in self.protein_ids])
        columns = ','.join(self.features)
        
        data = self.u.search(
            query=query,
            columns=columns
        )

        self._data = data
    
    def save_csv(self):
            if not self._data:
                self._get_uniprot_features()
            
            lines = self._data.strip().split('\n')
            headers = lines[0].split('\t')
            
            headers = ['identifier' if h == 'Entry Name' else h for h in headers]
            data_rows = [line.split('\t') for line in lines[1:]]
            
            with open(self.csv_output, 'w', newline='') as f:
                writer = csv.writer(f)
                writer.writerow(['identifier'] + [h for h in headers if h != 'identifier'])
                for row in data_rows:
                    writer.writerow(row)
        
    def _validate_features(self, features: List) -> str:
        print(features)
        for feature in features:
            if feature not in FEATURES:
                raise ValueError(f"Feature {feature} not found in feature map")
        
        if "id" in features:
            features.remove("id")

        return ["id"] + features
