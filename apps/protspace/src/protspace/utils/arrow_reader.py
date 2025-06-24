import json
from pathlib import Path
from typing import Any, Dict, List
import pandas as pd
import pyarrow as pa
import pyarrow.parquet as pq


class ArrowReader:
    """A class to read and manipulate Arrow data for ProtSpace."""

    def __init__(self, arrow_data_path: Path):
        """
        Initialize with path to directory containing Arrow/Parquet files.
        
        Args:
            arrow_data_path: Path to directory containing the .parquet files
        """
        self.data_path = Path(arrow_data_path)
        self._protein_features_df = None
        self._projections_metadata_df = None
        self._projections_data_df = None
        # Initialize data structure to match JsonReader format
        self.data = {"protein_data": {}, "projections": [], "visualization_state": {"feature_colors": {}, "marker_shapes": {}}}
        self._load_data()
        self._build_data_structure()

    def _load_data(self):
        """Load data from Parquet files."""
        try:
            protein_features_path = self.data_path / "selected_features.parquet"
            projections_metadata_path = self.data_path / "projections_metadata.parquet"
            projections_data_path = self.data_path / "projections_data.parquet"
            
            if protein_features_path.exists():
                self._protein_features_df = pq.read_table(str(protein_features_path)).to_pandas()
            else:
                self._protein_features_df = pd.DataFrame(columns=['protein_id'])
            
            if projections_metadata_path.exists():
                self._projections_metadata_df = pq.read_table(str(projections_metadata_path)).to_pandas()
            else:
                self._projections_metadata_df = pd.DataFrame(columns=['projection_name', 'dimensions', 'info_json'])
            
            if projections_data_path.exists():
                self._projections_data_df = pq.read_table(str(projections_data_path)).to_pandas()
            else:
                self._projections_data_df = pd.DataFrame(columns=['projection_name', 'identifier', 'x', 'y', 'z'])
                
        except Exception as e:
            raise ValueError(f"Error loading Arrow data from {self.data_path}: {e}")

    def _build_data_structure(self):
        """Build the data structure to match JsonReader format."""
        # Build protein_data
        for _, row in self._protein_features_df.iterrows():
            protein_id = row['protein_id']
            features = {}
            for col in self._protein_features_df.columns:
                if col != 'protein_id':
                    features[col] = row[col]
            self.data["protein_data"][protein_id] = {"features": features}
        
        # Build projections
        self.data["projections"] = []
        for projection_name in self._projections_metadata_df['projection_name'].unique():
            proj_meta = self._projections_metadata_df[
                self._projections_metadata_df['projection_name'] == projection_name
            ].iloc[0]
            
            proj_data = self._projections_data_df[
                self._projections_data_df['projection_name'] == projection_name
            ]
            
            projection = {
                "name": projection_name,
                "dimensions": proj_meta['dimensions'],
                "info": {},
                "data": []
            }
            
            # Add info if available
            if pd.notna(proj_meta['info_json']):
                try:
                    projection["info"] = json.loads(proj_meta['info_json'])
                except json.JSONDecodeError:
                    pass
            
            # Add projection data
            for _, row in proj_data.iterrows():
                coordinates = {"x": row['x'], "y": row['y']}
                if pd.notna(row['z']):
                    coordinates["z"] = row['z']
                
                projection["data"].append({
                    "identifier": row['identifier'],
                    "coordinates": coordinates
                })
            
            self.data["projections"].append(projection)
        
        # Load visualization state from separate JSON file if it exists
        self._load_visualization_state()

    def _load_visualization_state(self):
        """Load visualization state from JSON file if it exists."""
        viz_state_path = self.data_path / "visualization_state.json"
        if viz_state_path.exists():
            try:
                with open(viz_state_path, 'r') as f:
                    viz_state = json.load(f)
                    self.data["visualization_state"] = viz_state
            except (json.JSONDecodeError, FileNotFoundError):
                # If file doesn't exist or is corrupted, use default state
                pass

    def save_data(self, output_path: Path = None):
        """Save the current data back to parquet files."""
        if output_path is None:
            output_path = self.data_path
        else:
            output_path = Path(output_path)
        
        output_path.mkdir(parents=True, exist_ok=True)
        
        # Save protein features
        protein_features_path = output_path / "protein_features.parquet"
        protein_features_table = pa.Table.from_pandas(self._protein_features_df)
        pq.write_table(protein_features_table, str(protein_features_path))
        
        # Save projections metadata
        projections_metadata_path = output_path / "projections_metadata.parquet"
        projections_metadata_table = pa.Table.from_pandas(self._projections_metadata_df)
        pq.write_table(projections_metadata_table, str(projections_metadata_path))
        
        # Save projections data
        projections_data_path = output_path / "projections_data.parquet"
        projections_data_table = pa.Table.from_pandas(self._projections_data_df)
        pq.write_table(projections_data_table, str(projections_data_path))
        
        # Save visualization state as a separate JSON file
        viz_state_path = output_path / "visualization_state.json"
        with open(viz_state_path, 'w') as f:
            json.dump(self.data.get("visualization_state", {}), f, indent=2)

    def get_projection_names(self) -> List[str]:
        """Get list of projection names."""
        return [proj["name"] for proj in self.data.get("projections", [])]

    def get_all_features(self) -> List[str]:
        """Get list of all feature names."""
        features = set()
        for protein_data in self.data.get("protein_data", {}).values():
            features.update(protein_data.get("features", {}).keys())
        return list(features)

    def get_protein_ids(self) -> List[str]:
        """Get list of all protein IDs."""
        return list(self.data.get("protein_data", {}).keys())

    def get_projection_data(self, projection_name: str) -> List[Dict[str, Any]]:
        """Get projection data in the same format as JsonReader."""
        for proj in self.data.get("projections", []):
            if proj["name"] == projection_name:
                return proj.get("data", [])
        raise ValueError(f"Projection {projection_name} not found")

    def get_projection_info(self, projection_name: str) -> Dict[str, Any]:
        """Get projection info in the same format as JsonReader."""
        for proj in self.data.get("projections", []):
            if proj["name"] == projection_name:
                result = {"dimensions": proj.get("dimensions")}
                if "info" in proj:
                    result["info"] = proj["info"]
                return result
        raise ValueError(f"Projection {projection_name} not found")

    def get_protein_features(self, protein_id: str) -> Dict[str, Any]:
        """Get protein features in the same format as JsonReader."""
        return self.data.get("protein_data", {}).get(protein_id, {}).get("features", {})

    def get_feature_colors(self, feature: str) -> Dict[str, str]:
        """Get feature colors from visualization state."""
        return (
            self.data.get("visualization_state", {})
            .get("feature_colors", {})
            .get(feature, {})
        )

    def get_marker_shape(self, feature: str) -> Dict[str, str]:
        """Get marker shapes from visualization state."""
        return (
            self.data.get("visualization_state", {})
            .get("marker_shapes", {})
            .get(feature, {})
        )

    def get_unique_feature_values(self, feature: str) -> List[Any]:
        """Get a list of unique values for a given feature."""
        unique_values = set()
        for protein_data in self.data.get("protein_data", {}).values():
            value = protein_data.get("features", {}).get(feature)
            if value is not None:
                unique_values.add(value)
        return list(unique_values)

    def get_all_feature_values(self, feature: str) -> List[Any]:
        """Get a list of all values for a given feature."""
        all_values = []
        protein_ids = self.get_protein_ids()
        for protein_id in protein_ids:
            all_values.append(self.get_protein_features(protein_id).get(feature, None))
        return all_values

    def update_feature_color(self, feature: str, value: str, color: str):
        """Update feature color in visualization state."""
        if "visualization_state" not in self.data:
            self.data["visualization_state"] = {}
        if "feature_colors" not in self.data["visualization_state"]:
            self.data["visualization_state"]["feature_colors"] = {}
        if feature not in self.data["visualization_state"]["feature_colors"]:
            self.data["visualization_state"]["feature_colors"][feature] = {}

        self.data["visualization_state"]["feature_colors"][feature][value] = color

    def update_marker_shape(self, feature: str, value: str, shape: str):
        """Update marker shape in visualization state."""
        if "visualization_state" not in self.data:
            self.data["visualization_state"] = {}
        if "marker_shapes" not in self.data["visualization_state"]:
            self.data["visualization_state"]["marker_shapes"] = {}
        if feature not in self.data["visualization_state"]["marker_shapes"]:
            self.data["visualization_state"]["marker_shapes"][feature] = {}

        self.data["visualization_state"]["marker_shapes"][feature][value] = shape

    def get_data(self) -> Dict[str, Any]:
        """Return the current data."""
        return self.data 