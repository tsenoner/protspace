import logging
from pathlib import Path
from typing import Any, Dict, List, Union, Tuple

import h5py
import numpy as np
import pandas as pd

from protspace.utils import REDUCERS
from protspace.data.base_data_processor import BaseDataProcessor
from protspace.data.generate_csv import ProteinFeatureExtractor

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
