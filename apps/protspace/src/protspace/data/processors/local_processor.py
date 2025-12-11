import logging
from pathlib import Path
from typing import Any

import h5py
import numpy as np
import pandas as pd

from protspace.data.features.manager import ProteinFeatureManager
from protspace.data.processors.base_processor import BaseProcessor
from protspace.utils import REDUCERS

# Configure logging
logging.basicConfig(format="%(levelname)s: %(message)s")
logger = logging.getLogger(__name__)

# Validation and configuration
EMBEDDING_EXTENSIONS = {".hdf", ".hdf5", ".h5"}  # file extensions


class LocalProcessor(BaseProcessor):
    """Main class for processing and reducing dimensionality of local data files."""

    def __init__(self, config: dict[str, Any]):
        # Remove command-line specific arguments that aren't used for dimension reduction
        clean_config = config.copy()
        for arg in [
            "input",
            "features",
            "output",
            "methods",
            "verbose",
            "custom_names",
            "delimiter",
        ]:
            clean_config.pop(arg, None)

        # Initialize base class with cleaned config and reducers
        super().__init__(clean_config, REDUCERS)

    def load_input_file(self, input_path: Path) -> tuple[np.ndarray, list[str]]:
        if input_path.suffix.lower() in EMBEDDING_EXTENSIONS:
            logger.info("Loading embeddings from HDF file")
            data, headers = [], []
            with h5py.File(input_path, "r") as hdf_handle:
                for header, emb in hdf_handle.items():
                    emb = np.array(emb).flatten()
                    data.append(emb)
                    headers.append(header)
            data = np.array(data)

            # Check for NaN values and filter them out
            nan_mask = np.isnan(data).any(axis=1)
            if nan_mask.any():
                num_nan = nan_mask.sum()
                total = len(data)
                logger.warning(
                    f"Found {num_nan} embeddings with NaN values out of {total} total. "
                    f"Removing these entries ({num_nan / total * 100:.2f}%)."
                )
                # Keep only rows without NaN
                data = data[~nan_mask]
                headers = [
                    h for h, is_nan in zip(headers, nan_mask, strict=True) if not is_nan
                ]

                if len(data) == 0:
                    raise ValueError(
                        "All embeddings contain NaN values. Please check your input file."
                    )

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
    def load_or_generate_metadata(
        headers: list[str],
        features: str,
        intermediate_dir: Path,
        delimiter: str,
        non_binary: bool = False,
        keep_tmp: bool = False,
        force_refetch: bool = False,
    ) -> pd.DataFrame:
        try:
            # csv generation logic
            if features and features.endswith(".csv"):
                logger.info(f"Using delimiter: {repr(delimiter)} to read metadata")
                features_df = pd.read_csv(
                    features, delimiter=delimiter
                ).convert_dtypes()

            else:
                if features:
                    features_list = [feature.strip() for feature in features.split(",")]
                else:
                    features_list = None  # No specific features requested, use all

                if keep_tmp and intermediate_dir:
                    # Generate metadata in intermediate directory for caching
                    intermediate_dir.mkdir(parents=True, exist_ok=True)
                    # Use intermediate directory for caching
                    if non_binary:
                        metadata_file_path = intermediate_dir / "all_features.csv"
                    else:
                        metadata_file_path = intermediate_dir / "all_features.parquet"

                    # Check if cached metadata exists
                    if metadata_file_path.exists():
                        cached_df = (
                            pd.read_parquet(metadata_file_path)
                            if not non_binary
                            else pd.read_csv(metadata_file_path)
                        )
                        cached_features = set(cached_df.columns) - {"identifier"}

                        # Determine required features
                        if features_list is None:
                            from protspace.data.features.configuration import (
                                DEFAULT_FEATURES,
                            )

                            required_features = set(DEFAULT_FEATURES)
                        else:
                            required_features = set(features_list)

                        # Check if we need to fetch anything
                        missing = required_features - cached_features

                        if not missing and not force_refetch:
                            logger.info(
                                f"All required features found in cache: {metadata_file_path}"
                            )
                            # Return filtered columns
                            if features_list:
                                cols = ["identifier"] + [
                                    f for f in features_list if f in cached_df.columns
                                ]
                                features_df = cached_df[cols]
                            else:
                                features_df = cached_df
                        else:
                            # Determine which sources to fetch
                            from protspace.data.features.configuration import (
                                FeatureConfiguration,
                            )

                            sources_to_fetch = (
                                FeatureConfiguration.determine_sources_to_fetch(
                                    cached_features, required_features
                                )
                            )

                            if force_refetch:
                                logger.info(
                                    "--force-refetch flag set, re-fetching all features"
                                )
                                sources_to_fetch = {
                                    "uniprot": True,
                                    "taxonomy": True,
                                    "interpro": True,
                                }
                                cached_df = None
                            else:
                                logger.info(f"Missing features: {missing}")
                                logger.info(
                                    f"Will fetch from sources: {[k for k, v in sources_to_fetch.items() if v]}"
                                )

                            # Fetch missing features incrementally
                            features_df = ProteinFeatureManager(
                                headers=headers,
                                features=features_list,
                                output_path=metadata_file_path,
                                non_binary=non_binary,
                                cached_data=cached_df,
                                sources_to_fetch=sources_to_fetch,
                            ).to_pd()
                            logger.info(
                                f"Updated metadata saved to: {metadata_file_path}"
                            )
                    else:
                        # Generate new metadata
                        features_df = ProteinFeatureManager(
                            headers=headers,
                            features=features_list,
                            output_path=metadata_file_path,
                            non_binary=non_binary,
                        ).to_pd()
                        logger.info(f"Metadata file saved to: {metadata_file_path}")
                else:
                    # No caching - generate metadata directly
                    features_df = ProteinFeatureManager(
                        headers=headers,
                        features=features_list,
                        output_path=None,  # No intermediate file
                        non_binary=non_binary,
                    ).to_pd()

                return features_df

        except Exception as e:
            logger.warning(
                f"Could not load metadata ({str(e)}) - creating empty metadata"
            )
            features_df = pd.DataFrame(columns=["identifier"])

        return features_df
