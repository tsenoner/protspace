import logging
import tempfile
import shutil
from pathlib import Path
from typing import Any, Dict, List, Union, Tuple

import h5py
import numpy as np
import pandas as pd

from protspace.utils import REDUCERS
from protspace.data.base_data_processor import BaseDataProcessor
from protspace.data.feature_manager import ProteinFeatureExtractor

# Configure logging
logging.basicConfig(format="%(levelname)s: %(message)s")
logger = logging.getLogger(__name__)

# Validation and configuration
EMBEDDING_EXTENSIONS = {".hdf", ".hdf5", ".h5"}  # file extensions


class LocalDataProcessor(BaseDataProcessor):
    """Main class for processing and reducing dimensionality of local data files."""

    def __init__(self, config: Dict[str, Any]):
        # Remove command-line specific arguments that aren't used for dimension reduction
        clean_config = config.copy()
        for arg in [
            "input",
            "metadata",
            "output",
            "methods",
            "verbose",
            "custom_names",
            "delimiter",
        ]:
            clean_config.pop(arg, None)
        
        # Initialize base class with cleaned config and reducers
        super().__init__(clean_config, REDUCERS)

    def load_data(
        self,
        input_path: Path,
        metadata: Union[Path, List],  # If list, generates csv from uniprot features
        output_path: Path,
        delimiter: str,
        non_binary: bool = False,
        keep_tmp: bool = False,
    ) -> Tuple[pd.DataFrame, np.ndarray, List[str]]:
        data, headers = self._load_input_file(input_path)
        metadata = self._load_or_generate_metadata(
            headers,
            metadata,
            output_path,
            delimiter,
            non_binary,
            keep_tmp,
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
        headers: List[str],
        metadata: str,
        output_path: Path,
        delimiter: str,
        non_binary: bool = False,
        keep_tmp: bool = False,
    ) -> pd.DataFrame:
        try:
            # csv generation logic
            if metadata and metadata.endswith(".csv"):
                logger.info(f"Using delimiter: {repr(delimiter)} to read metadata")
                metadata_df = pd.read_csv(metadata, delimiter=delimiter).convert_dtypes()

            else:
                if metadata:
                    features = [feature.strip() for feature in metadata.split(",")]
                else:
                    features = None  # No specific features requested, use all

                # Generate metadata directly in output directory
                output_base = output_path.with_suffix('')
                output_base.mkdir(parents=True, exist_ok=True)
                
                if non_binary:
                    metadata_file_path = output_base / "all_features.csv"
                else:
                    metadata_file_path = output_base / "all_features.parquet"
                
                metadata_df = ProteinFeatureExtractor(
                    headers=headers, 
                    features=features, 
                    output_path=metadata_file_path, 
                    non_binary=non_binary
                ).to_pd()
                
                if keep_tmp:
                    logger.info(f"Metadata file saved to: {metadata_file_path}")
                else:
                    # Delete the metadata file if keep_tmp is False
                    if metadata_file_path.exists():
                        metadata_file_path.unlink()
                        logger.debug(f"Temporary metadata file deleted: {metadata_file_path}")

                return metadata_df

        except Exception as e:
            logger.warning(
                f"Could not load metadata ({str(e)}) - creating empty metadata"
            )
            metadata_df = pd.DataFrame(columns=["identifier"])

        return metadata_df
