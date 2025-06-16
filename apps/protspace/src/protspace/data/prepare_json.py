import argparse
import json
import logging
from pathlib import Path
from typing import Any, Dict, List, Union, Tuple

import h5py
import numpy as np
import pandas as pd

from protspace.utils import REDUCER_METHODS, DimensionReductionConfig
from protspace.utils.reducers import MDS_NAME
from protspace.data.generate_csv import ProteinFeatureExtractor

# Configure logging
logging.basicConfig(format="%(levelname)s: %(message)s")
logger = logging.getLogger(__name__)

# Validation and configuration
EMBEDDING_EXTENSIONS = {".hdf", ".hdf5", ".h5"}  # file extensions


class DataProcessor:
    """Main class for processing and reducing dimensionality of data."""

    REDUCERS = REDUCER_METHODS

    def __init__(self, config: Dict[str, Any]):
        # Remove command-line specific arguments that aren't used for dimension reduction
        self.config = config.copy()
        for arg in [
            "input",
            "metadata",
            "output",
            "methods",
            "verbose",
            "custom_names",
            "delimiter",
        ]:
            self.config.pop(arg, None)
        self.identifier_col = "identifier"
        self.custom_names = config.get("custom_names", {})

    def load_data(
        self,
        input_path: Path,
        metadata: Union[Path, List],  # If list, generates csv from uniprot features
        delimiter: str,
    ) -> Tuple[pd.DataFrame, np.ndarray, List[str]]:
        data, headers = self._load_input_file(input_path)
        metadata = self._load_or_generate_metadata(
            headers, metadata, input_path, delimiter
        )

        # Create full metadata with NaN for missing entries
        full_metadata = pd.DataFrame({"identifier": headers})
        if len(metadata.columns) > 1:
            metadata = metadata.astype(str)
            full_metadata = full_metadata.merge(
                metadata.drop_duplicates("identifier"),
                on="identifier",
                how="left",
            )

        return full_metadata, data, headers

    def _load_input_file(self, input_path: Path) -> Tuple[np.ndarray, List[str]]:
        if input_path.suffix.lower() in EMBEDDING_EXTENSIONS:
            logger.info("Loading embeddings from HDF file")
            data, headers = [], []
            with h5py.File(input_path, "r") as hdf_handle:
                for header, emb in hdf_handle.items():
                    emb = np.array(emb).flatten()
                    data.append(emb)
                    headers.append(header)
            data = np.array(data)

            return data, headers

        elif input_path.suffix.lower() == ".csv":
            logger.info("Loading similarity matrix from CSV file")
            self.config["precomputed"] = True
            sim_matrix = pd.read_csv(input_path, index_col=0)
            if not sim_matrix.index.equals(sim_matrix.columns):
                raise ValueError(
                    "Similarity matrix must have matching row and column labels"
                )

            headers = sim_matrix.index.tolist()
            data = sim_matrix.values

            if not np.allclose(data, data.T, rtol=1e-5, atol=1e-8):
                logger.warning(
                    "Similarity matrix is not perfectly symmetric - using (A + A.T)/2"
                )
                data = (data + data.T) / 2

            return data, headers

        else:
            raise ValueError(
                "Input file must be either HDF (.hdf, .hdf5, .h5) or CSV (.csv)"
            )

    @staticmethod
    def _load_or_generate_metadata(
        headers: List[str], metadata: str, input_path: Path, delimiter: str
    ) -> pd.DataFrame:
        try:
            # csv generation logic
            if metadata and metadata.endswith(".csv"):
                logger.info(f"Using delimiter: {repr(delimiter)} to read metadata")
                metadata = pd.read_csv(metadata, delimiter=delimiter).convert_dtypes()

            else:
                if metadata:
                    features = [feature.strip() for feature in metadata.split(",")]
                else:
                    features = None  # No specific features requested, use all

                input_path = input_path.absolute()
                if input_path.is_file():
                    csv_output = input_path.parent / "metadata.csv"
                else:
                    csv_output = input_path / "metadata.csv"

                metadata = ProteinFeatureExtractor(
                    headers=headers, features=features, csv_output=csv_output
                ).to_pd()

        except Exception as e:
            logger.warning(
                f"Could not load metadata ({str(e)}) - creating empty metadata"
            )
            metadata = pd.DataFrame(columns=["identifier"])

        return metadata

    def process_reduction(
        self, data: np.ndarray, method: str, dims: int
    ) -> Dict[str, Any]:
        """Process a single reduction method."""
        config = DimensionReductionConfig(n_components=dims, **self.config)

        # Special handling for MDS when using similarity matrix
        if method == MDS_NAME and config.precomputed is True:
            # Convert similarity to dissimilarity matrix if needed
            if np.allclose(np.diag(data), 1):
                # Convert similarity to distance: d = sqrt(max(s) - s)
                max_sim = np.max(data)
                data = np.sqrt(max_sim - data)

        reducer_cls = self.REDUCERS.get(method)
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


def save_output(data: Dict[str, Any], output_path: Path):
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


def main():
    parser = argparse.ArgumentParser(
        description="Dimensionality reduction for protein embeddings or similarity matrices",
        formatter_class=argparse.ArgumentDefaultsHelpFormatter,
    )

    # Required arguments
    parser.add_argument(
        "-i",
        "--input",
        type=Path,
        required=True,
        help="Path to input data: HDF file (.hdf, .hdf5, .h5) for embeddings or CSV file for similarity matrix",
    )
    parser.add_argument(
        "-m",
        "--metadata",
        type=str,
        required=False,
        default=None,
        help="Path to CSV file containing metadata and features (first column must be named 'identifier' and match IDs in HDF5/similarity matrix). If want to generate CSV from UniProt features, use the following format: feature1,feature2,...",
    )
    parser.add_argument(
        "-o",
        "--output",
        type=Path,
        required=True,
        help="Path to output JSON file",
    )
    # Specify delimiter argument with comma as default
    parser.add_argument(
        "--delimiter",
        type=str,
        default=",",
        help="Specify delimiter for metadata file (default: comma)",
    )

    # Reduction methods
    parser.add_argument(
        "--methods",
        type=str,
        default="pca2",
        help=f"Reduction methods to use (e.g., {','.join([m + '2' for m in REDUCER_METHODS])}). Format: method_name + dimensions",
    )

    # Custom names
    parser.add_argument(
        "--custom_names",
        type=str,
        metavar="METHOD1=NAME1,METHOD2=NAME2",
        help="Custom names for projections in format METHOD=NAME separated by commas without spaces (e.g., pca2=PCA_2D,tsne2=t-SNE_2D)",
    )

    # Verbosity control
    parser.add_argument(
        "-v",
        "--verbose",
        action="count",
        default=0,
        help="Increase output verbosity (-v for INFO, -vv for DEBUG)",
    )

    # General parameters
    general_group = parser.add_argument_group("General Parameters")
    general_group.add_argument(
        "--metric",
        default="euclidean",
        help="Distance metric to use (applies to UMAP, t-SNE, MDS)",
    )

    # UMAP parameters
    umap_group = parser.add_argument_group("UMAP Parameters")
    umap_group.add_argument(
        "--n_neighbors",
        type=int,
        default=15,
        help="Number of neighbors to consider (UMAP, PaCMAP, LocalMAP)",
    )
    umap_group.add_argument(
        "--min_dist",
        type=float,
        default=0.1,
        help="Minimum distance between points in UMAP",
    )

    # t-SNE parameters
    tsne_group = parser.add_argument_group("t-SNE Parameters")
    tsne_group.add_argument(
        "--perplexity",
        type=int,
        default=30,
        help="Perplexity parameter for t-SNE",
    )
    tsne_group.add_argument(
        "--learning_rate", type=int, default=200, help="Learning rate for t-SNE"
    )

    # PaCMAP parameters
    pacmap_group = parser.add_argument_group("PaCMAP Parameters")
    pacmap_group.add_argument(
        "--mn_ratio",
        type=float,
        default=0.5,
        help="MN ratio (Mid-near pairs ratio) for PaCMAP and LocalMAP",
    )
    pacmap_group.add_argument(
        "--fp_ratio",
        type=float,
        default=2.0,
        help="FP ratio (Further pairs ratio) for PaCMAP and LocalMAP",
    )

    # MDS parameters
    mds_group = parser.add_argument_group("MDS Parameters")
    mds_group.add_argument(
        "--n_init",
        type=int,
        default=4,
        help="Number of initialization runs for MDS",
    )
    mds_group.add_argument(
        "--max_iter",
        type=int,
        default=300,
        help="Maximum number of iterations for MDS",
    )
    mds_group.add_argument(
        "--eps",
        type=float,
        default=1e-3,
        help="Relative tolerance for MDS convergence",
    )

    args = parser.parse_args()

    # Process custom names
    custom_names = {}
    if args.custom_names:
        custom_names_list = args.custom_names.split(",")
        for name_spec in custom_names_list:
            try:
                method, name = name_spec.split("=")
                custom_names[method] = name
            except ValueError:
                logger.warning(f"Invalid custom name specification: {name_spec}")

    # Add custom names to args
    args_dict = vars(args)
    args_dict["custom_names"] = custom_names

    # Set logging level
    logger.setLevel(
        [logging.WARNING, logging.INFO, logging.DEBUG][min(args.verbose, 2)]
    )

    try:
        # Process data
        processor = DataProcessor(args_dict)
        metadata, data, headers = processor.load_data(
            args.input, args.metadata, delimiter=args.delimiter
        )

        # Process each method
        methods_list = args.methods.split(",")
        reductions = []
        for method_spec in methods_list:
            method = "".join(filter(str.isalpha, method_spec))
            dims = int("".join(filter(str.isdigit, method_spec)))

            if method not in processor.REDUCERS:
                logger.warning(
                    f"Unknown reduction method specified: {method}. Skipping."
                )
                continue  # Use logger.warning and continue instead of raising ValueError
                # raise ValueError(f"Unknown reduction method: {method}") # Kept for reference

            logger.info(f"Applying {method.upper()}{dims} reduction")
            reductions.append(processor.process_reduction(data, method, dims))

        # Create and save output
        output = processor.create_output(metadata, reductions, headers)
        save_output(output, args.output)
        logger.info(
            f"Successfully processed {len(headers)} items using {len(methods_list)} reduction methods"
        )

    except Exception as e:
        logger.error(f"Error: {str(e)}")
        raise


if __name__ == "__main__":
    main()
