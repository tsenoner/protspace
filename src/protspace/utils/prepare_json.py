import argparse
import json
import logging
import inspect
from abc import ABC, abstractmethod
from dataclasses import dataclass, field, fields
from pathlib import Path
from typing import Any, Dict, List, Tuple, Literal, get_args, get_type_hints

import h5py
import numpy as np
import pandas as pd
from sklearn.decomposition import PCA
from sklearn.manifold import MDS, TSNE

# Configure logging
logging.basicConfig(format="%(levelname)s: %(message)s")
logger = logging.getLogger(__name__)

# Valididation and configuration
EMBEDDING_EXTENSIONS = {".hdf", ".hdf5", ".h5"}  # file extensions
METRIC_TYPES = Literal["euclidean", "cosine"]  # dimension reduction


@dataclass(frozen=True)
class DimensionReductionConfig:
    """Configuration for dimension reduction methods.

    Parameters:
        n_components: Number of dimensions in reduced space (2 or 3)
        n_neighbors: Number of neighbors for manifold learning (>0)
        metric: Distance metric to use
        precomputed: Whether distances are precomputed
        min_dist: Minimum distance for UMAP (0-1)
        perplexity: Perplexity for t-SNE (5-50)
        learning_rate: Learning rate for t-SNE optimization (>0)
        mn_ratio: Ratio for PaCMAP (0-1)
        fp_ratio: Ratio for PaCMAP (>0)
        n_init: Number of initializations for MDS (>0)
        max_iter: Maximum iterations (>0)
        eps: Convergence tolerance (>0)
    """

    n_components: int = field(default=2, metadata={"allowed": [2, 3]})
    n_neighbors: int = field(default=15, metadata={"gt": 0})
    metric: METRIC_TYPES = field(
        default="euclidean", metadata={"allowed": [m for m in get_args(METRIC_TYPES)]}
    )
    precomputed: bool = field(default=False)
    min_dist: float = field(default=0.1, metadata={"gte": 0, "lte": 1})
    perplexity: int = field(default=30, metadata={"gte": 5, "lte": 50})
    learning_rate: int = field(default=200, metadata={"gt": 0})
    mn_ratio: float = field(default=0.5, metadata={"gte": 0, "lte": 1})
    fp_ratio: float = field(default=2.0, metadata={"gt": 0})
    n_init: int = field(default=4, metadata={"gt": 0})
    max_iter: int = field(default=300, metadata={"gt": 0})
    eps: float = field(default=1e-3, metadata={"gt": 0})

    def __post_init__(self):
        """Validate configuration parameters."""
        for data_field in fields(self):
            value = getattr(self, data_field.name)
            metadata = data_field.metadata

            if "allowed" in metadata:
                if value not in metadata["allowed"]:
                    raise ValueError(
                        f"{data_field.name} must be one of {metadata['allowed']}"
                    )

            if "gt" in metadata:
                if value <= metadata["gt"]:
                    raise ValueError(
                        f"{data_field.name} must be greater than {metadata['gt']}"
                    )

            if "lt" in metadata:
                if value >= metadata["lt"]:
                    raise ValueError(
                        f"{data_field.name} must be less than {metadata['lt']}"
                    )

            if "gte" in metadata:
                if value < metadata["gte"]:
                    raise ValueError(
                        f"{data_field.name} must be greater than or equal to {metadata['gte']}"
                    )

            if "lte" in metadata:
                if value > metadata["lte"]:
                    raise ValueError(
                        f"{data_field.name} must be less than or equal to {metadata['lte']}"
                    )

    def parameters_by_method(self, method: str) -> List[Dict[str, Any]]:
        from umap import UMAP
        from pacmap import PaCMAP

        method_map = {
            "tsne": TSNE,
            "pca": PCA,
            "umap": UMAP,
            "pacmap": PaCMAP,
            "mds": MDS,
        }

        if method not in method_map:
            return []

        def _get_parameter_desc_from_docstring(parameter: str, docstring: str) -> str:
            large_splits = []
            possible_split_variants = [
                f"{parameter} : ",
                f"{parameter}: ",
                f"{parameter}:",
                parameter,
            ]
            for split_variant in possible_split_variants:
                if split_variant in docstring:
                    large_splits = docstring.split(split_variant)
                    break
            if len(large_splits) == 0:
                return ""
            large_split = large_splits[0] if len(large_splits) == 1 else large_splits[1]
            param_split = (
                large_split.split("\n\n")[0]
                if "\n" in large_split
                else large_split.split("\n")[0]
            )
            param_split_cleaned = (
                param_split.replace("\n\n", "")
                .replace("\t", "")
                .replace("  ", " ")
                .replace("   ", " ")
                .strip()
            )
            return param_split_cleaned

        type_hints = get_type_hints(self.__class__)

        try:
            method_function = method_map[method]
            method_signature = inspect.signature(method_function)
            docstring = inspect.getdoc(method_function)
            method_parameters = list(method_signature.parameters.keys())
            # Create a dictionary of lowercase attribute names to their original names
            lowercase_fields = {
                data_field.name.lower(): data_field for data_field in fields(self)
            }
            result = []
            for param in method_parameters:
                if method == "mds" and param == "metric":
                    continue  # Skip precomputed mds metric
                if method == "umap" and param == "learning_rate":
                    continue  # Learning rate only used for tSNE
                if param.lower() in lowercase_fields:
                    data_field = lowercase_fields[param.lower()]
                    field_type = type_hints.get(data_field.name, Any).__name__
                    description = f"{param}: {_get_parameter_desc_from_docstring(parameter=param, docstring=docstring)}"
                    result.append(
                        {
                            "name": param.lower(),
                            "default": data_field.default,
                            "description": description,
                            "constraints": {"type": field_type, **data_field.metadata},
                        }
                    )
            return result
        except Exception as e:
            print(e)
            return []


class DimensionReducer(ABC):
    """Abstract base class for dimension reduction methods."""

    def __init__(self, config: DimensionReductionConfig):
        self.config = config

    @abstractmethod
    def fit_transform(self, data: np.ndarray) -> np.ndarray:
        """Transform data to lower dimensions."""
        pass

    @abstractmethod
    def get_params(self) -> Dict[str, Any]:
        """Get parameters used for the reduction."""
        pass


class PCAReducer(DimensionReducer):
    """Principal Component Analysis reduction."""

    def fit_transform(self, data: np.ndarray) -> np.ndarray:
        pca = PCA(n_components=self.config.n_components)
        result = pca.fit_transform(data)
        self.explained_variance = pca.explained_variance_ratio_.tolist()
        return result

    def get_params(self) -> Dict[str, Any]:
        return {
            "n_components": self.config.n_components,
            "explained_variance_ratio": self.explained_variance,
        }


class TSNEReducer(DimensionReducer):
    """t-SNE (t-Distributed Stochastic Neighbor Embedding) reduction."""

    def fit_transform(self, data: np.ndarray) -> np.ndarray:
        return TSNE(
            n_components=self.config.n_components,
            perplexity=self.config.perplexity,
            learning_rate=self.config.learning_rate,
            metric=self.config.metric,
        ).fit_transform(data)

    def get_params(self) -> Dict[str, Any]:
        return {
            "n_components": self.config.n_components,
            "perplexity": self.config.perplexity,
            "learning_rate": self.config.learning_rate,
            "metric": self.config.metric,
        }


class UMAPReducer(DimensionReducer):
    """UMAP (Uniform Manifold Approximation and Projection) reduction."""

    def fit_transform(self, data: np.ndarray) -> np.ndarray:
        from umap import UMAP

        return UMAP(
            n_components=self.config.n_components,
            n_neighbors=self.config.n_neighbors,
            min_dist=self.config.min_dist,
            metric=self.config.metric,
        ).fit_transform(data)

    def get_params(self) -> Dict[str, Any]:
        return {
            "n_components": self.config.n_components,
            "n_neighbors": self.config.n_neighbors,
            "min_dist": self.config.min_dist,
            "metric": self.config.metric,
        }


class PaCMAPReducer(DimensionReducer):
    """PaCMAP (Pairwise Controlled Manifold Approximation) reduction."""

    def fit_transform(self, data: np.ndarray) -> np.ndarray:
        from pacmap import PaCMAP

        return PaCMAP(
            n_components=self.config.n_components,
            n_neighbors=self.config.n_neighbors,
            MN_ratio=self.config.mn_ratio,
            FP_ratio=self.config.fp_ratio,
        ).fit_transform(data)

    def get_params(self) -> Dict[str, Any]:
        return {
            "n_components": self.config.n_components,
            "n_neighbors": self.config.n_neighbors,
            "MN_ratio": self.config.mn_ratio,
            "FP_ratio": self.config.fp_ratio,
        }


class MDSReducer(DimensionReducer):
    """Multidimensional Scaling reduction."""

    def fit_transform(self, data: np.ndarray) -> np.ndarray:
        return MDS(
            n_components=self.config.n_components,
            metric=self.config.precomputed,
            n_init=self.config.n_init,
            max_iter=self.config.max_iter,
            eps=self.config.eps,
            dissimilarity=("precomputed" if self.config.precomputed else "euclidean"),
        ).fit_transform(data)

    def get_params(self) -> Dict[str, Any]:
        return {
            "n_components": self.config.n_components,
            "n_init": self.config.n_init,
            "max_iter": self.config.max_iter,
            "eps": self.config.eps,
        }


class DataProcessor:
    """Main class for processing and reducing dimensionality of data."""

    REDUCERS = {
        "pca": PCAReducer,
        "tsne": TSNEReducer,
        "umap": UMAPReducer,
        "pacmap": PaCMAPReducer,
        "mds": MDSReducer,
    }

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
        self, input_path: Path, metadata_path: Path, delimiter: str
    ) -> Tuple[pd.DataFrame, np.ndarray, List[str]]:
        """Load and align input data with metadata, handling missing values gracefully."""
        # Log the delimiter being used
        logger.info(f"Using delimiter: {repr(delimiter)} to read metadata")

        # Load metadata if available
        try:
            metadata = pd.read_csv(metadata_path, delimiter=delimiter).convert_dtypes()
            if "identifier" not in metadata.columns:
                logger.warning(
                    "Metadata CSV missing 'identifier' column - creating empty metadata"
                )
                metadata = pd.DataFrame(columns=["identifier"])
        except Exception as e:
            logger.warning(
                f"Could not load metadata ({str(e)}) - creating empty metadata"
            )
            metadata = pd.DataFrame(columns=["identifier"])

        # Load input data based on file extension
        if input_path.suffix.lower() in EMBEDDING_EXTENSIONS:
            logger.info("Loading embeddings from HDF file")
            data, headers = [], []
            with h5py.File(input_path, "r") as hdf_handle:
                for header, emb in hdf_handle.items():
                    emb = np.array(emb).flatten()
                    data.append(emb)
                    headers.append(header)
            data = np.array(data)

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

        else:
            raise ValueError(
                "Input file must be either HDF (.hdf, .hdf5, .h5) or CSV (.csv)"
            )

        # Create full metadata with NaN for missing entries
        full_metadata = pd.DataFrame({"identifier": headers})
        if len(metadata.columns) > 1:
            metadata = metadata.astype(str)  # Convert all columns to strings
            full_metadata = full_metadata.merge(
                metadata.drop_duplicates("identifier"),
                on="identifier",
                how="left",
            )

        return full_metadata, data, headers

    def process_reduction(
        self, data: np.ndarray, method: str, dims: int
    ) -> Dict[str, Any]:
        """Process a single reduction method."""
        config = DimensionReductionConfig(n_components=dims, **self.config)

        # Special handling for MDS when using similarity matrix
        if method == "mds" and config.precomputed is True:
            # Convert similarity to dissimilarity matrix if needed
            if np.allclose(np.diag(data), 1):
                # Convert similarity to distance: d = sqrt(max(s) - s)
                max_sim = np.max(data)
                data = np.sqrt(max_sim - data)

        reducer = self.REDUCERS[method](config)
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
        type=Path,
        required=True,
        help="Path to CSV file containing metadata and features (first column must be named 'identifier' and match IDs in HDF5/similarity matrix)",
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
        nargs="+",
        default=["pca2"],
        help="Reduction methods to use (e.g., pca2, tsne3, mds2). Format: method_name + dimensions",
    )

    # Custom names
    parser.add_argument(
        "--custom_names",
        nargs="+",
        metavar="METHOD=NAME",
        help="Custom names for projections in format METHOD=NAME (e.g., pca2=PCA_2D)",
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
        help="Number of neighbors to consider (UMAP, PaCMAP)",
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
        help="MN ratio (Mid-near pairs ratio) for PaCMAP",
    )
    pacmap_group.add_argument(
        "--fp_ratio",
        type=float,
        default=2.0,
        help="FP ratio (Further pairs ratio) for PaCMAP",
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
        for name_spec in args.custom_names:
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
        reductions = []
        for method_spec in args.methods:
            method = "".join(filter(str.isalpha, method_spec))
            dims = int("".join(filter(str.isdigit, method_spec)))

            if method not in processor.REDUCERS:
                raise ValueError(f"Unknown reduction method: {method}")

            logger.info(f"Applying {method.upper()}{dims} reduction")
            reductions.append(processor.process_reduction(data, method, dims))

        # Create and save output
        output = processor.create_output(metadata, reductions, headers)
        save_output(output, args.output)
        logger.info(
            f"Successfully processed {len(headers)} items using {len(args.methods)} reduction methods"
        )

    except Exception as e:
        logger.error(f"Error: {str(e)}")
        raise


if __name__ == "__main__":
    main()
