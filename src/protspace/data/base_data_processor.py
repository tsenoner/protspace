import io
import json
import logging
from pathlib import Path
from typing import Any

import numpy as np
import pandas as pd
import pyarrow as pa
import pyarrow.parquet as pq

from protspace.utils import DimensionReductionConfig
from protspace.utils.reducers import MDS_NAME

logger = logging.getLogger(__name__)


class NumpyEncoder(json.JSONEncoder):
    """Custom JSON encoder that handles NumPy data types."""

    def default(self, obj):
        if isinstance(obj, np.integer):
            return int(obj)
        elif isinstance(obj, np.floating):
            return float(obj)
        elif isinstance(obj, np.ndarray):
            return obj.tolist()
        return super().default(obj)


class BaseDataProcessor:
    """Base class containing common data processing methods."""

    def __init__(self, config: dict[str, Any], reducers: dict[str, Any]):
        self.config = config
        self.reducers = reducers
        self.identifier_col = "identifier"
        self.custom_names = config.get("custom_names", {})

    def process_reduction(
        self, data: np.ndarray, method: str, dims: int
    ) -> dict[str, Any]:
        """Process a single reduction method."""
        # Filter config to only include parameters accepted by DimensionReductionConfig
        valid_config_keys = {
            "n_neighbors",
            "metric",
            "precomputed",
            "min_dist",
            "perplexity",
            "learning_rate",
            "mn_ratio",
            "fp_ratio",
            "n_init",
            "max_iter",
            "eps",
            "random_state",
        }
        filtered_config = {
            k: v for k, v in self.config.items() if k in valid_config_keys
        }
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
        reductions: list[dict[str, Any]],
        headers: list[str],
    ) -> dict[str, pa.Table]:
        """Create the final output as Apache Arrow tables."""
        return {
            "protein_features": self._create_protein_features_table(metadata),
            "projections_metadata": self._create_projections_metadata_table(reductions),
            "projections_data": self._create_projections_data_table(
                reductions, headers
            ),
        }

    def save_output(
        self, data: dict[str, pa.Table], output_path: Path, bundled: bool = True
    ):
        """Save output data to Parquet files using Apache Arrow.

        Args:
            data: Dictionary of Apache Arrow tables to save
            output_path: Path for output (file or directory)
            bundled: Whether to bundle into single .parquetbundle file
        """
        # Custom filename mapping for better naming
        filename_mapping = {
            "protein_features": "selected_features.parquet",
            "projections_metadata": "projections_metadata.parquet",
            "projections_data": "projections_data.parquet",
        }

        if bundled:
            # Determine the bundle file path
            if output_path.suffix == ".parquetbundle":
                # User provided a file path ending with .parquetbundle
                bundle_path = output_path
                output_path.parent.mkdir(parents=True, exist_ok=True)
            elif output_path.suffix:
                # User provided a file path with different extension - use it as is but warn
                bundle_path = output_path.with_suffix(".parquetbundle")
                logger.warning(
                    f"Output path has extension '{output_path.suffix}', "
                    f"using '.parquetbundle' instead: {bundle_path}"
                )
                bundle_path.parent.mkdir(parents=True, exist_ok=True)
            else:
                # User provided a directory path - create bundle inside with default name
                output_path.mkdir(parents=True, exist_ok=True)
                bundle_path = output_path / "data.parquetbundle"

            delimiter = b"---PARQUET_DELIMITER---"

            with open(bundle_path, "wb") as bundle_file:
                for i, (_, table) in enumerate(data.items()):
                    if i > 0:
                        bundle_file.write(delimiter)

                    buffer = io.BytesIO()
                    pq.write_table(table, buffer)
                    buffer.seek(0)
                    bundle_file.write(buffer.read())

            logger.info(f"Saved bundled output to: {bundle_path}")
        else:
            # Save as separate parquet files
            # output_path must be a directory
            base_path = output_path.with_suffix("")  # Remove any extension
            base_path.mkdir(parents=True, exist_ok=True)

            for table_name, table in data.items():
                filename = filename_mapping.get(table_name, f"{table_name}.parquet")
                table_path = base_path / filename

                # Overwrite existing files
                pq.write_table(table, str(table_path))

            logger.info(f"Saved separate parquet files to: {base_path}")

    def _create_protein_features_table(self, metadata: pd.DataFrame) -> pa.Table:
        """Create Apache Arrow table for protein features in wide format."""
        df = metadata.copy()

        if self.identifier_col != "protein_id":
            df = df.rename(columns={self.identifier_col: "protein_id"})

        df = df.fillna("").astype(str)

        return pa.Table.from_pandas(df)

    def _create_projections_metadata_table(
        self, reductions: list[dict[str, Any]]
    ) -> pa.Table:
        """Create Apache Arrow table for projection metadata."""
        rows = []
        for reduction in reductions:
            rows.append(
                {
                    "projection_name": reduction["name"],
                    "dimensions": reduction["dimensions"],
                    "info_json": json.dumps(reduction["info"]),
                }
            )

        df = pd.DataFrame(rows)
        return pa.Table.from_pandas(df)

    def _create_projections_data_table(
        self, reductions: list[dict[str, Any]], headers: list[str]
    ) -> pa.Table:
        """Create Apache Arrow table for projection coordinates."""
        rows = []
        for reduction in reductions:
            for i, header in enumerate(headers):
                row = {
                    "projection_name": reduction["name"],
                    "identifier": header,
                    "x": np.float32(reduction["data"][i][0]),
                    "y": np.float32(reduction["data"][i][1]),
                }
                if reduction["dimensions"] == 3:
                    row["z"] = np.float32(reduction["data"][i][2])
                else:
                    row["z"] = None

                rows.append(row)

        df = pd.DataFrame(rows)
        return pa.Table.from_pandas(df)

    def create_output_legacy(
        self,
        metadata: pd.DataFrame,
        reductions: list[dict[str, Any]],
        headers: list[str],
    ) -> dict[str, Any]:
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

    def save_output_legacy(self, data: dict[str, Any], output_path: Path):
        """Save output data to JSON file (legacy format)."""
        # output_path is the final .json file path
        output_path.parent.mkdir(parents=True, exist_ok=True)
        json_file_path = output_path

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
            json.dump(data, f, indent=2, cls=NumpyEncoder)
