import logging
from pathlib import Path
from typing import Any

import h5py
import numpy as np
import pandas as pd

from protspace.data.annotations.manager import ProteinAnnotationManager
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
            "annotations",
            "output",
            "methods",
            "verbose",
            "custom_names",
            "delimiter",
        ]:
            clean_config.pop(arg, None)

        # Initialize base class with cleaned config and reducers
        super().__init__(clean_config, REDUCERS)

    def _load_h5_files(self, h5_files: list[Path]) -> tuple[np.ndarray, list[str]]:
        """
        Load and merge H5 files.

        Args:
            h5_files: List of paths to H5 files

        Returns:
            Tuple of (data array, list of headers)
        """
        data, headers = [], []
        seen_ids = set()
        duplicates_count = 0

        for h5_file in h5_files:
            with h5py.File(h5_file, "r") as hdf_handle:
                for header, emb in hdf_handle.items():
                    if header in seen_ids:
                        duplicates_count += 1
                        continue  # Skip duplicates, keep first occurrence

                    emb = np.array(emb).flatten()
                    data.append(emb)
                    headers.append(header)
                    seen_ids.add(header)

        if duplicates_count > 0:
            logger.warning(
                f"Found {duplicates_count} duplicate protein IDs across files. "
                f"Kept first occurrence of each."
            )

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
            data = data[~nan_mask]
            headers = [
                h for h, is_nan in zip(headers, nan_mask, strict=True) if not is_nan
            ]

            if len(data) == 0:
                raise ValueError(
                    "All embeddings contain NaN values. Please check your input file."
                )

        return data, headers

    def load_input_files(self, input_paths: list[Path]) -> tuple[np.ndarray, list[str]]:
        """
        Load input from one or more paths (files or directories).

        Args:
            input_paths: List of paths to files or directories

        Returns:
            Tuple of (data array, list of headers)
        """
        # Collect all files to process
        embedding_files = []
        csv_file = None

        for path in input_paths:
            if path.is_dir():
                # Collect all embedding files from directory (all extensions)
                dir_files = []
                for ext in EMBEDDING_EXTENSIONS:
                    dir_files.extend(path.glob(f"*{ext}"))

                if not dir_files:
                    logger.warning(f"No embedding files found in directory: {path}")
                embedding_files.extend(sorted(dir_files))
            elif path.suffix.lower() in EMBEDDING_EXTENSIONS:
                # Add embedding file directly
                embedding_files.append(path)
            elif path.suffix.lower() == ".csv":
                if csv_file is not None:
                    raise ValueError("Only one CSV file can be provided")
                csv_file = path
            else:
                raise ValueError(
                    f"Unsupported file type: {path}. "
                    f"Must be HDF5 files (.h5, .hdf5, .hdf), directories, or CSV file."
                )

        # Handle CSV (similarity matrix)
        if csv_file is not None:
            if embedding_files:
                raise ValueError("Cannot mix CSV and HDF5 inputs")

            logger.info("Loading similarity matrix from CSV file")
            self.config["precomputed"] = True
            sim_matrix = pd.read_csv(csv_file, index_col=0)
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

        # Handle HDF5 files
        if not embedding_files:
            raise FileNotFoundError("No embedding files found in provided paths")

        logger.info(f"Loading embeddings from {len(embedding_files)} HDF file(s)")
        return self._load_h5_files(embedding_files)

    @staticmethod
    def load_or_generate_metadata(
        headers: list[str],
        annotations: str,
        intermediate_dir: Path,
        delimiter: str,
        non_binary: bool = False,
        keep_tmp: bool = False,
        force_refetch: bool = False,
    ) -> pd.DataFrame:
        try:
            # csv generation logic
            if annotations and annotations.endswith(".csv"):
                logger.info(f"Using delimiter: {repr(delimiter)} to read metadata")
                annotations_df = pd.read_csv(
                    annotations, delimiter=delimiter
                ).convert_dtypes()

            else:
                if annotations:
                    annotations_list = [
                        annotation.strip() for annotation in annotations.split(",")
                    ]
                    from protspace.data.annotations.configuration import (
                        AnnotationConfiguration,
                    )

                    annotations_list = AnnotationConfiguration(
                        annotations_list
                    ).user_annotations
                else:
                    annotations_list = (
                        None  # No specific annotations requested, use all
                    )

                if keep_tmp and intermediate_dir:
                    # Generate metadata in intermediate directory for caching
                    intermediate_dir.mkdir(parents=True, exist_ok=True)
                    # Use intermediate directory for caching
                    if non_binary:
                        metadata_file_path = intermediate_dir / "all_annotations.csv"
                    else:
                        metadata_file_path = (
                            intermediate_dir / "all_annotations.parquet"
                        )

                    # Check if cached metadata exists
                    if metadata_file_path.exists():
                        cached_df = (
                            pd.read_parquet(metadata_file_path)
                            if not non_binary
                            else pd.read_csv(metadata_file_path)
                        )
                        cached_annotations = set(cached_df.columns) - {"identifier"}

                        # Determine required annotations
                        if annotations_list is None:
                            from protspace.data.annotations.configuration import (
                                ANNOTATION_GROUPS,
                            )

                            required_annotations = set(ANNOTATION_GROUPS["default"])
                        else:
                            required_annotations = set(annotations_list)

                        # Check if we need to fetch anything
                        missing = required_annotations - cached_annotations

                        if not missing and not force_refetch:
                            logger.info(
                                f"All required annotations found in cache: {metadata_file_path}"
                            )
                            # Return filtered columns
                            if annotations_list:
                                cols = ["identifier"] + [
                                    f
                                    for f in annotations_list
                                    if f in cached_df.columns
                                ]
                                annotations_df = cached_df[cols]
                            else:
                                annotations_df = cached_df
                        else:
                            # Determine which sources to fetch
                            from protspace.data.annotations.configuration import (
                                AnnotationConfiguration,
                            )

                            sources_to_fetch = (
                                AnnotationConfiguration.determine_sources_to_fetch(
                                    cached_annotations, required_annotations
                                )
                            )

                            if force_refetch:
                                logger.info(
                                    "--force-refetch flag set, re-fetching all annotations"
                                )
                                sources_to_fetch = {
                                    "uniprot": True,
                                    "taxonomy": True,
                                    "interpro": True,
                                }
                                cached_df = None
                            else:
                                logger.info(f"Missing annotations: {missing}")
                                logger.info(
                                    f"Will fetch from sources: {[k for k, v in sources_to_fetch.items() if v]}"
                                )

                            # Fetch missing annotations incrementally
                            annotations_df = ProteinAnnotationManager(
                                headers=headers,
                                annotations=annotations_list,
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
                        annotations_df = ProteinAnnotationManager(
                            headers=headers,
                            annotations=annotations_list,
                            output_path=metadata_file_path,
                            non_binary=non_binary,
                        ).to_pd()
                        logger.info(f"Metadata file saved to: {metadata_file_path}")
                else:
                    # No caching - generate metadata directly
                    annotations_df = ProteinAnnotationManager(
                        headers=headers,
                        annotations=annotations_list,
                        output_path=None,  # No intermediate file
                        non_binary=non_binary,
                    ).to_pd()

                return annotations_df

        except Exception as e:
            logger.warning(
                f"Could not load metadata ({str(e)}) - creating empty metadata"
            )
            annotations_df = pd.DataFrame(columns=["identifier"])

        return annotations_df
