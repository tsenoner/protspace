import json
import logging
from pathlib import Path
from typing import Any, Dict, List
import numpy as np
import pandas as pd
import pyarrow as pa
import pyarrow.parquet as pq

from protspace.utils import DimensionReductionConfig
from protspace.utils.reducers import MDS_NAME

logger = logging.getLogger(__name__)


class BaseDataProcessor:
    """Base class containing common data processing methods."""

    def __init__(self, config: Dict[str, Any], reducers: Dict[str, Any]):
        self.config = config
        self.reducers = reducers
        self.identifier_col = "identifier"
        self.custom_names = config.get("custom_names", {})

    def process_reduction(self, data: np.ndarray, method: str, dims: int) -> Dict[str, Any]:
        """Process a single reduction method."""
        # Filter config to only include parameters accepted by DimensionReductionConfig
        valid_config_keys = {
            'n_neighbors', 'metric', 'precomputed', 'min_dist', 'perplexity', 
            'learning_rate', 'mn_ratio', 'fp_ratio', 'n_init', 'max_iter', 'eps'
        }
        filtered_config = {k: v for k, v in self.config.items() if k in valid_config_keys}
        config = DimensionReductionConfig(n_components=dims, **filtered_config)

        # Special handling for MDS when using similarity matrix
        if method == MDS_NAME and config.precomputed is True:
            # Convert similarity to dissimilarity matrix if needed
            if np.allclose(np.diag(data), 1):
                # Convert similarity to distance: d = sqrt(max(s) - s)
                max_sim = np.max(data)
                data = np.sqrt(max_sim - data)

        reducer_cls = self.reducers.get(method)
        if not reducer_cls:
            raise ValueError(f"Unknown reduction method: {method}")

        reducer = reducer_cls(config)
        reduced_data = reducer.fit_transform(data)

        method_spec = f"{method}{dims}"
        projection_name = self.custom_names.get(method_spec, f"{method.upper()}_{dims}")

        return {
            "name": projection_name,
            "dimensions": dims,
            "info": reducer.get_params(),
            "data": reduced_data,
        }

    def create_output(
        self,
        metadata: pd.DataFrame,
        reductions: List[Dict[str, Any]],
        headers: List[str],
    ) -> Dict[str, pa.Table]:
        """Create the final output as Apache Arrow tables."""
        return {
            'protein_features': self._create_protein_features_table(metadata),
            'projections_metadata': self._create_projections_metadata_table(reductions),
            'projections_data': self._create_projections_data_table(reductions, headers)
        }

    def save_output(self, data: Dict[str, pa.Table], output_path: Path):
        """Save output data to Parquet files using Apache Arrow."""
        base_path = output_path.with_suffix('')
        base_path.mkdir(parents=True, exist_ok=True)
        
        # Custom filename mapping for better naming
        filename_mapping = {
            'protein_features': 'selected_features.parquet',
            'projections_metadata': 'projections_metadata.parquet',
            'projections_data': 'projections_data.parquet'
        }
        
        for table_name, table in data.items():
            filename = filename_mapping.get(table_name, f"{table_name}.parquet")
            table_path = base_path / filename
            
            # Simply overwrite existing files instead of merging
            # This ensures clean output when running with different parameters
            pq.write_table(table, str(table_path))

    def _create_protein_features_table(self, metadata: pd.DataFrame) -> pa.Table:
        """Create Apache Arrow table for protein features in wide format."""
        df = metadata.copy()
        
        if self.identifier_col != 'protein_id':
            df = df.rename(columns={self.identifier_col: 'protein_id'})
        
        df = df.fillna("").astype(str)
        
        return pa.Table.from_pandas(df)

    def _create_projections_metadata_table(self, reductions: List[Dict[str, Any]]) -> pa.Table:
        """Create Apache Arrow table for projection metadata."""
        rows = []
        for reduction in reductions:
            rows.append({
                'projection_name': reduction['name'],
                'dimensions': reduction['dimensions'],
                'info_json': json.dumps(reduction['info'])
            })
        
        df = pd.DataFrame(rows)
        return pa.Table.from_pandas(df)

    def _create_projections_data_table(self, reductions: List[Dict[str, Any]], headers: List[str]) -> pa.Table:
        """Create Apache Arrow table for projection coordinates."""
        rows = []
        for reduction in reductions:
            for i, header in enumerate(headers):
                row = {
                    'projection_name': reduction['name'],
                    'identifier': header,
                    'x': np.float32(reduction['data'][i][0]),
                    'y': np.float32(reduction['data'][i][1])
                }
                if reduction['dimensions'] == 3:
                    row['z'] = np.float32(reduction['data'][i][2])
                else:
                    row['z'] = None
                
                rows.append(row)
        
        df = pd.DataFrame(rows)
        return pa.Table.from_pandas(df)

    def create_output_legacy(
        self,
        metadata: pd.DataFrame,
        reductions: List[Dict[str, Any]],
        headers: List[str],
    ) -> Dict[str, Any]:
        """Create the final output dictionary (legacy JSON format)."""
        output = {"protein_data": {}, "projections": []}

        # Process features
        for _, row in metadata.iterrows():
            protein_id = row[self.identifier_col]
            features = (
                row.drop(self.identifier_col)
                .infer_objects(copy=False)
                .fillna("")
                .to_dict()
            )
            output["protein_data"][protein_id] = {"features": features}

        # Process projections
        for reduction in reductions:
            projection = {
                "name": reduction["name"],
                "dimensions": reduction["dimensions"],
                "info": reduction["info"],
                "data": [],
            }

            for i, header in enumerate(headers):
                coordinates = {
                    "x": np.float32(reduction["data"][i][0]),
                    "y": np.float32(reduction["data"][i][1]),
                }
                if reduction["dimensions"] == 3:
                    coordinates["z"] = np.float32(reduction["data"][i][2])

                projection["data"].append(
                    {"identifier": header, "coordinates": coordinates}
                )

            output["projections"].append(projection)

        return output

    def save_output_legacy(self, data: Dict[str, Any], output_path: Path):
        """Save output data to JSON file (legacy format)."""
        # Treat output_path as directory, similar to save_output method
        base_path = output_path.with_suffix('')
        base_path.mkdir(parents=True, exist_ok=True)
        
        # Use predefined filename for JSON output
        json_file_path = base_path / "selected_features_projections.json"
        
        if json_file_path.exists():
            with json_file_path.open("r") as f:
                existing = json.load(f)
                existing["protein_data"].update(data["protein_data"])

                # Update or add projections
                existing_projs = {p["name"]: p for p in existing["projections"]}
                for new_proj in data["projections"]:
                    existing_projs[new_proj["name"]] = new_proj
                existing["projections"] = list(existing_projs.values())

            data = existing

        with json_file_path.open("w") as f:
            json.dump(data, f, indent=2) 