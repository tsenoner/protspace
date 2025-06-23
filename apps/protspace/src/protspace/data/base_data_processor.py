import json
import logging
from pathlib import Path
from typing import Any, Dict, List
import numpy as np
import pandas as pd

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
        config = DimensionReductionConfig(n_components=dims, **self.config)

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
    ) -> Dict[str, Any]:
        """Create the final output dictionary."""
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
                    "x": float(reduction["data"][i][0]),
                    "y": float(reduction["data"][i][1]),
                }
                if reduction["dimensions"] == 3:
                    coordinates["z"] = float(reduction["data"][i][2])

                projection["data"].append(
                    {"identifier": header, "coordinates": coordinates}
                )

            output["projections"].append(projection)

        return output

    def save_output(self, data: Dict[str, Any], output_path: Path):
        """Save output data to JSON file."""
        if output_path.exists():
            with output_path.open("r") as f:
                existing = json.load(f)
                existing["protein_data"].update(data["protein_data"])

                # Update or add projections
                existing_projs = {p["name"]: p for p in existing["projections"]}
                for new_proj in data["projections"]:
                    existing_projs[new_proj["name"]] = new_proj
                existing["projections"] = list(existing_projs.values())

            data = existing

        with output_path.open("w") as f:
            json.dump(data, f, indent=2) 