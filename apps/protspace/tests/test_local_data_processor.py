import tempfile
from pathlib import Path
from unittest.mock import MagicMock, Mock, patch

import numpy as np
import pandas as pd
import pytest

from src.protspace.data.annotations.configuration import AnnotationConfiguration
from src.protspace.data.processors.local_processor import (
    EMBEDDING_EXTENSIONS,
    LocalProcessor,
)
from src.protspace.utils import REDUCERS

# Use new name
LocalDataProcessor = LocalProcessor  # For test compatibility

# Test data
SAMPLE_HEADERS = ["P01308", "P01315", "P01316"]
SAMPLE_EMBEDDINGS = np.array(
    [[0.1, 0.2, 0.3, 0.4], [0.5, 0.6, 0.7, 0.8], [0.9, 1.0, 1.1, 1.2]]
)
SAMPLE_SIMILARITY_MATRIX = np.array([[1.0, 0.8, 0.7], [0.8, 1.0, 0.9], [0.7, 0.9, 1.0]])
SAMPLE_METADATA_DF = pd.DataFrame(
    {
        "identifier": SAMPLE_HEADERS,
        "length": ["110", "142", "85"],
        "organism": ["Homo sapiens", "Homo sapiens", "Mus musculus"],
    }
)


# Helper functions for test setup
def create_mock_h5_file(data_dict: dict[str, np.ndarray]) -> MagicMock:
    """Create a mock HDF5 file with the given data.

    Args:
        data_dict: Dictionary mapping protein IDs to embeddings

    Returns:
        Mock HDF5 file object
    """
    mock_file = MagicMock()
    mock_file.items.return_value = list(data_dict.items())
    return mock_file


def setup_mock_h5_files(mock_h5py_file, *file_data: dict[str, np.ndarray]) -> None:
    """Setup multiple mock HDF5 files for testing.

    Args:
        mock_h5py_file: The mocked h5py.File object
        *file_data: Variable number of dictionaries, each mapping protein IDs to embeddings
    """
    mock_files = [create_mock_h5_file(data) for data in file_data]
    mock_h5py_file.return_value.__enter__.side_effect = mock_files


class TestLocalDataProcessorInit:
    """Test LocalDataProcessor initialization."""

    def test_init_removes_cli_args(self):
        """Test that CLI-specific arguments are removed from config."""
        config_with_cli_args = {
            "input": "input.h5",
            "annotations": "annotations.csv",
            "output": "output.json",
            "methods": ["pca"],
            "verbose": True,
            "custom_names": {"pca2": "Custom_PCA"},
            "delimiter": ",",
            "n_components": 2,
            "random_state": 42,
        }

        processor = LocalDataProcessor(config_with_cli_args)

        # Check that CLI args are removed but dimension reduction args remain
        assert "input" not in processor.config
        assert "annotations" not in processor.config
        assert "output" not in processor.config
        assert "methods" not in processor.config
        assert "verbose" not in processor.config
        assert "custom_names" not in processor.config
        assert "delimiter" not in processor.config

        assert "n_components" in processor.config
        assert "random_state" in processor.config
        assert set(processor.reducers.keys()) == set(REDUCERS.keys())

    def test_init_with_minimal_config(self):
        """Test initialization with minimal configuration."""
        minimal_config = {}
        processor = LocalDataProcessor(minimal_config)

        assert processor.config == {}
        assert set(processor.reducers.keys()) == set(REDUCERS.keys())


class TestLoadInputFiles:
    """Test the load_input_files method."""

    @patch("src.protspace.data.processors.local_processor.h5py.File")
    def test_load_single_hdf5_file(self, mock_h5py_file):
        """Test loading embeddings from single HDF5 file."""
        # Setup mock using helper
        setup_mock_h5_files(
            mock_h5py_file,
            {
                "P01308": np.array([0.1, 0.2, 0.3, 0.4]),
                "P01315": np.array([0.5, 0.6, 0.7, 0.8]),
                "P01316": np.array([0.9, 1.0, 1.1, 1.2]),
            },
        )

        processor = LocalDataProcessor({})
        input_path = Path("test_embeddings.h5")

        data, headers = processor.load_input_files([input_path])

        # Verify results
        assert len(headers) == 3
        assert headers == SAMPLE_HEADERS
        assert data.shape == (3, 4)
        np.testing.assert_array_almost_equal(data, SAMPLE_EMBEDDINGS)

        # Verify HDF5 file was opened
        mock_h5py_file.assert_called_once_with(input_path, "r")

    def test_load_single_csv_file(self):
        """Test loading similarity matrix from CSV file."""
        processor = LocalDataProcessor({})

        # Create mock CSV data
        csv_data = pd.DataFrame(
            SAMPLE_SIMILARITY_MATRIX, index=SAMPLE_HEADERS, columns=SAMPLE_HEADERS
        )

        with patch("pandas.read_csv", return_value=csv_data):
            input_path = Path("test_similarity.csv")

            data, headers = processor.load_input_files([input_path])

            # Verify results
            assert headers == SAMPLE_HEADERS
            np.testing.assert_array_almost_equal(data, SAMPLE_SIMILARITY_MATRIX)
            assert processor.config.get("precomputed") is True

    def test_load_csv_asymmetric_matrix(self):
        """Test loading asymmetric similarity matrix gets symmetrized."""
        processor = LocalDataProcessor({})

        # Create asymmetric matrix
        asymmetric_matrix = np.array(
            [
                [1.0, 0.8, 0.7],
                [0.9, 1.0, 0.9],  # Changed from 0.8 to 0.9
                [0.6, 0.8, 1.0],  # Changed from 0.7, 0.9
            ]
        )

        csv_data = pd.DataFrame(
            asymmetric_matrix, index=SAMPLE_HEADERS, columns=SAMPLE_HEADERS
        )

        with patch("pandas.read_csv", return_value=csv_data):
            input_path = Path("test_asymmetric.csv")

            data, headers = processor.load_input_files([input_path])

            # Verify matrix was symmetrized
            np.testing.assert_array_equal(data, data.T)
            assert headers == SAMPLE_HEADERS

    def test_load_csv_mismatched_labels(self):
        """Test error handling for CSV with mismatched row/column labels."""
        processor = LocalDataProcessor({})

        # Create CSV with mismatched labels
        csv_data = pd.DataFrame(
            SAMPLE_SIMILARITY_MATRIX,
            index=SAMPLE_HEADERS,
            columns=["A", "B", "C"],  # Different column labels
        )

        with patch("pandas.read_csv", return_value=csv_data):
            input_path = Path("test_mismatched.csv")

            with pytest.raises(
                ValueError,
                match="Similarity matrix must have matching row and column labels",
            ):
                processor.load_input_files([input_path])

    def test_load_unsupported_format(self):
        """Test error handling for unsupported file format."""
        processor = LocalDataProcessor({})
        input_path = Path("test_file.txt")

        with pytest.raises(ValueError, match="Unsupported file type"):
            processor.load_input_files([input_path])

    @patch("src.protspace.data.processors.local_processor.h5py.File")
    def test_load_multiple_hdf5_files(self, mock_h5py_file):
        """Test loading and merging multiple HDF5 files."""
        # Setup mock using helper
        setup_mock_h5_files(
            mock_h5py_file,
            {
                "P01308": np.array([0.1, 0.2, 0.3, 0.4]),
                "P01315": np.array([0.5, 0.6, 0.7, 0.8]),
            },
            {"P01316": np.array([0.9, 1.0, 1.1, 1.2])},
        )

        processor = LocalDataProcessor({})
        input_paths = [Path("batch1.h5"), Path("batch2.h5")]

        data, headers = processor.load_input_files(input_paths)

        # Verify results
        assert len(headers) == 3
        assert headers == SAMPLE_HEADERS
        assert data.shape == (3, 4)
        np.testing.assert_array_almost_equal(data, SAMPLE_EMBEDDINGS)

    @patch("src.protspace.data.processors.local_processor.h5py.File")
    def test_load_multiple_hdf5_with_duplicates(self, mock_h5py_file):
        """Test that duplicate protein IDs are handled correctly."""
        # Setup mock with duplicate P01308 in second file
        setup_mock_h5_files(
            mock_h5py_file,
            {
                "P01308": np.array([0.1, 0.2, 0.3, 0.4]),
                "P01315": np.array([0.5, 0.6, 0.7, 0.8]),
            },
            {
                "P01308": np.array(
                    [9.9, 9.9, 9.9, 9.9]
                ),  # Duplicate, should be skipped
                "P01316": np.array([0.9, 1.0, 1.1, 1.2]),
            },
        )

        processor = LocalDataProcessor({})
        input_paths = [Path("batch1.h5"), Path("batch2.h5")]

        data, headers = processor.load_input_files(input_paths)

        # Verify P01308 appears once with first occurrence values
        assert len(headers) == 3
        assert headers == SAMPLE_HEADERS
        assert data.shape == (3, 4)
        # First row should be from first file, not second
        np.testing.assert_array_almost_equal(data[0], [0.1, 0.2, 0.3, 0.4])

    @patch("src.protspace.data.processors.local_processor.h5py.File")
    def test_load_directory_with_hdf5_files(self, mock_h5py_file):
        """Test loading all HDF5 files from a directory."""
        with tempfile.TemporaryDirectory() as temp_dir:
            # Create mock H5 files in directory
            dir_path = Path(temp_dir)
            h5_file1 = dir_path / "batch1.h5"
            h5_file2 = dir_path / "batch2.hdf5"
            h5_file1.touch()
            h5_file2.touch()

            # Setup mocks using helper
            setup_mock_h5_files(
                mock_h5py_file,
                {"P01308": np.array([0.1, 0.2, 0.3, 0.4])},
                {"P01315": np.array([0.5, 0.6, 0.7, 0.8])},
            )

            processor = LocalDataProcessor({})
            data, headers = processor.load_input_files([dir_path])

            # Verify both files were loaded
            assert len(headers) == 2
            assert "P01308" in headers
            assert "P01315" in headers

    def test_load_mixed_csv_and_hdf5_raises_error(self):
        """Test that mixing CSV and HDF5 files raises an error."""
        processor = LocalDataProcessor({})
        input_paths = [Path("data.h5"), Path("similarity.csv")]

        with pytest.raises(ValueError, match="Cannot mix CSV and HDF5 inputs"):
            processor.load_input_files(input_paths)

    @patch("src.protspace.data.processors.local_processor.h5py.File")
    def test_load_multiple_hdf5_with_nan_filtering(self, mock_h5py_file):
        """Test that NaN values are filtered when merging multiple HDF5 files."""
        # Setup mock files with some NaN embeddings
        setup_mock_h5_files(
            mock_h5py_file,
            {
                "P01308": np.array([0.1, 0.2, 0.3, 0.4]),  # Valid
                "P01309": np.array([0.5, np.nan, 0.7, 0.8]),  # Contains NaN
            },
            {"P01315": np.array([0.5, 0.6, 0.7, 0.8])},  # Valid
            {
                "P01316": np.array([0.9, 1.0, 1.1, 1.2]),  # Valid
                "P01317": np.array([np.nan, np.nan, np.nan, np.nan]),  # All NaN
            },
        )

        processor = LocalDataProcessor({})
        input_paths = [Path("batch1.h5"), Path("batch2.h5"), Path("batch3.h5")]

        data, headers = processor.load_input_files(input_paths)

        # Verify NaN entries were filtered out
        assert len(headers) == 3  # Only valid proteins
        assert "P01308" in headers
        assert "P01315" in headers
        assert "P01316" in headers
        assert "P01309" not in headers  # Filtered due to NaN
        assert "P01317" not in headers  # Filtered due to all NaN

        # Verify data has no NaN values
        assert not np.isnan(data).any()
        assert data.shape == (3, 4)

    @patch("src.protspace.data.processors.local_processor.h5py.File")
    def test_load_directory_with_mixed_extensions(self, mock_h5py_file):
        """Test loading HDF5 files with different extensions from a directory."""
        with tempfile.TemporaryDirectory() as temp_dir:
            # Create mock H5 files with different extensions
            dir_path = Path(temp_dir)
            h5_file = dir_path / "batch1.h5"
            hdf5_file = dir_path / "batch2.hdf5"
            hdf_file = dir_path / "batch3.hdf"
            h5_file.touch()
            hdf5_file.touch()
            hdf_file.touch()

            # Setup mocks using helper
            setup_mock_h5_files(
                mock_h5py_file,
                {"P01308": np.array([0.1, 0.2, 0.3, 0.4])},
                {"P01315": np.array([0.5, 0.6, 0.7, 0.8])},
                {"P01316": np.array([0.9, 1.0, 1.1, 1.2])},
            )

            processor = LocalDataProcessor({})
            data, headers = processor.load_input_files([dir_path])

            # Verify all three files were loaded (all extensions)
            assert len(headers) == 3
            assert set(headers) == {"P01308", "P01315", "P01316"}
            assert data.shape == (3, 4)

    @patch("src.protspace.data.processors.local_processor.h5py.File")
    def test_load_mixed_files_and_directory(self, mock_h5py_file):
        """Test loading from both individual files and a directory."""
        with tempfile.TemporaryDirectory() as temp_dir:
            # Create directory with H5 files
            dir_path = Path(temp_dir) / "embs"
            dir_path.mkdir()
            dir_file1 = dir_path / "batch1.h5"
            dir_file2 = dir_path / "batch2.h5"
            dir_file1.touch()
            dir_file2.touch()

            # Create standalone file
            standalone_file = Path(temp_dir) / "standalone.h5"
            standalone_file.touch()

            # Setup mocks using helper
            setup_mock_h5_files(
                mock_h5py_file,
                {"P01308": np.array([0.1, 0.2, 0.3, 0.4])},
                {"P01315": np.array([0.5, 0.6, 0.7, 0.8])},
                {"P01316": np.array([0.9, 1.0, 1.1, 1.2])},
            )

            processor = LocalDataProcessor({})
            # Mix directory and individual file
            data, headers = processor.load_input_files([dir_path, standalone_file])

            # Verify all files were loaded
            assert len(headers) == 3
            assert set(headers) == {"P01308", "P01315", "P01316"}
            assert data.shape == (3, 4)


class TestLoadOrGenerateMetadata:
    """Test the load_or_generate_metadata static method."""

    def test_load_metadata_from_csv(self):
        """Test loading metadata from existing CSV file."""
        with tempfile.TemporaryDirectory() as temp_dir:
            # Create test CSV file
            csv_path = Path(temp_dir) / "metadata.csv"
            SAMPLE_METADATA_DF.to_csv(csv_path, index=False)

            result = LocalDataProcessor.load_or_generate_metadata(
                headers=SAMPLE_HEADERS,
                annotations=str(csv_path),
                intermediate_dir=Path(temp_dir) / "intermediate",
                delimiter=",",
                non_binary=False,
                keep_tmp=False,
            )

            # Verify result
            assert isinstance(result, pd.DataFrame)
            assert len(result) == 3
            assert list(result["identifier"]) == SAMPLE_HEADERS

    def test_load_metadata_csv_with_custom_delimiter(self):
        """Test loading CSV with custom delimiter."""
        with tempfile.TemporaryDirectory() as temp_dir:
            # Create test CSV with semicolon delimiter
            csv_path = Path(temp_dir) / "metadata.csv"
            SAMPLE_METADATA_DF.to_csv(csv_path, index=False, sep=";")

            result = LocalDataProcessor.load_or_generate_metadata(
                headers=SAMPLE_HEADERS,
                annotations=str(csv_path),
                intermediate_dir=Path(temp_dir) / "intermediate",
                delimiter=";",
                non_binary=False,
                keep_tmp=False,
            )

            # Verify result
            assert isinstance(result, pd.DataFrame)
            assert len(result) == 3

    @patch("src.protspace.data.processors.local_processor.ProteinAnnotationManager")
    def test_generate_metadata_with_annotations(self, mock_annotation_extractor):
        """Test metadata generation with specified annotations."""
        # Setup mock
        mock_extractor_instance = Mock()
        mock_extractor_instance.to_pd.return_value = SAMPLE_METADATA_DF
        mock_annotation_extractor.return_value = mock_extractor_instance

        with tempfile.TemporaryDirectory() as temp_dir:
            result = LocalDataProcessor.load_or_generate_metadata(
                headers=SAMPLE_HEADERS,
                annotations="length,organism",
                intermediate_dir=Path(temp_dir) / "intermediate",
                delimiter=",",
                non_binary=True,
                keep_tmp=True,
            )

            # Verify ProteinAnnotationManager was called correctly
            mock_annotation_extractor.assert_called_once()
            call_kwargs = mock_annotation_extractor.call_args[1]
            assert call_kwargs["headers"] == SAMPLE_HEADERS
            assert call_kwargs["annotations"] == [
                "length",
                "organism",
                "gene_name",
                "protein_name",
                "uniprot_kb_id",
            ]
            assert call_kwargs["non_binary"] is True

            # Verify result
            pd.testing.assert_frame_equal(result, SAMPLE_METADATA_DF)

    @patch("src.protspace.data.processors.local_processor.ProteinAnnotationManager")
    def test_generate_metadata_no_annotations(self, mock_annotation_extractor):
        """Test metadata generation without specifying annotations."""
        # Setup mock
        mock_extractor_instance = Mock()
        mock_extractor_instance.to_pd.return_value = SAMPLE_METADATA_DF
        mock_annotation_extractor.return_value = mock_extractor_instance

        with tempfile.TemporaryDirectory() as temp_dir:
            LocalDataProcessor.load_or_generate_metadata(
                headers=SAMPLE_HEADERS,
                annotations=None,
                intermediate_dir=Path(temp_dir) / "intermediate",
                delimiter=",",
                non_binary=False,
                keep_tmp=False,
            )

            # Verify ProteinAnnotationManager was called with None annotations
            call_kwargs = mock_annotation_extractor.call_args[1]
            assert call_kwargs["annotations"] is None

    @patch("src.protspace.data.processors.local_processor.ProteinAnnotationManager")
    def test_generate_metadata_file_cleanup(self, mock_annotation_extractor):
        """Test metadata generation when keep_tmp=False (no intermediate files created)."""
        # Setup mock
        mock_extractor_instance = Mock()
        mock_extractor_instance.to_pd.return_value = SAMPLE_METADATA_DF
        mock_annotation_extractor.return_value = mock_extractor_instance

        with tempfile.TemporaryDirectory() as temp_dir:
            result = LocalDataProcessor.load_or_generate_metadata(
                headers=SAMPLE_HEADERS,
                annotations="length",
                intermediate_dir=Path(temp_dir) / "intermediate",
                delimiter=",",
                non_binary=True,
                keep_tmp=False,
            )

            # Verify metadata was generated directly (no intermediate files)
            assert isinstance(result, pd.DataFrame)
            assert len(result) == 3
            assert list(result["identifier"]) == SAMPLE_HEADERS

    def test_load_metadata_error_handling(self):
        """Test error handling in metadata loading."""
        with tempfile.TemporaryDirectory() as temp_dir:
            # Test with non-existent CSV file
            result = LocalDataProcessor.load_or_generate_metadata(
                headers=SAMPLE_HEADERS,
                annotations="nonexistent.csv",
                intermediate_dir=Path(temp_dir) / "intermediate",
                delimiter=",",
                non_binary=False,
                keep_tmp=False,
            )

            # Should return empty DataFrame
            assert isinstance(result, pd.DataFrame)
            assert list(result.columns) == ["identifier"]


class TestPublicMethods:
    """Test the main public methods (load_input_files and load_or_generate_metadata)."""

    @patch(
        "src.protspace.data.processors.local_processor.LocalProcessor.load_or_generate_metadata"
    )
    @patch(
        "src.protspace.data.processors.local_processor.LocalProcessor.load_input_files"
    )
    def test_load_methods_success(self, mock_load_input, mock_load_metadata):
        """Test successful data loading using public methods."""
        # Setup mocks
        mock_load_input.return_value = (SAMPLE_EMBEDDINGS, SAMPLE_HEADERS)
        mock_load_metadata.return_value = SAMPLE_METADATA_DF

        processor = LocalDataProcessor({})

        with tempfile.TemporaryDirectory() as temp_dir:
            input_path = Path(temp_dir) / "input.h5"
            annotations_path = Path(temp_dir) / "metadata.csv"

            # Call public methods separately (like CLI does)
            data, headers = processor.load_input_files([input_path])
            metadata = processor.load_or_generate_metadata(
                headers=headers,
                annotations=annotations_path,
                intermediate_dir=Path(temp_dir) / "intermediate",
                delimiter=",",
                non_binary=False,
                keep_tmp=False,
            )

            # Create full metadata (like CLI does)
            full_metadata = pd.DataFrame({"identifier": headers})
            if len(metadata.columns) > 1:
                metadata = metadata.astype(str)
                full_metadata = full_metadata.merge(
                    metadata.drop_duplicates("identifier"),
                    on="identifier",
                    how="left",
                )

            # Verify results
            assert isinstance(full_metadata, pd.DataFrame)
            assert len(full_metadata) == 3
            assert list(full_metadata["identifier"]) == SAMPLE_HEADERS
            np.testing.assert_array_equal(data, SAMPLE_EMBEDDINGS)
            assert headers == SAMPLE_HEADERS

            # Verify method calls
            mock_load_input.assert_called_once_with([input_path])
            mock_load_metadata.assert_called_once()

    @patch(
        "src.protspace.data.processors.local_processor.LocalProcessor.load_or_generate_metadata"
    )
    @patch(
        "src.protspace.data.processors.local_processor.LocalProcessor.load_input_files"
    )
    def test_load_methods_with_partial_metadata(
        self, mock_load_input, mock_load_metadata
    ):
        """Test data loading with partial metadata (missing entries)."""
        # Setup mocks
        mock_load_input.return_value = (SAMPLE_EMBEDDINGS, SAMPLE_HEADERS)

        # Partial metadata missing one entry
        partial_metadata = pd.DataFrame(
            {
                "identifier": ["P01308", "P01316"],  # Missing P01315
                "length": ["110", "85"],
            }
        )
        mock_load_metadata.return_value = partial_metadata

        processor = LocalDataProcessor({})

        with tempfile.TemporaryDirectory() as temp_dir:
            input_path = Path(temp_dir) / "input.h5"

            # Call public methods separately (like CLI does)
            data, headers = processor.load_input_files([input_path])
            metadata = processor.load_or_generate_metadata(
                headers=headers,
                annotations="length,organism",
                intermediate_dir=Path(temp_dir) / "intermediate",
                delimiter=",",
                non_binary=False,
                keep_tmp=False,
            )

            # Create full metadata (like CLI does)
            full_metadata = pd.DataFrame({"identifier": headers})
            if len(metadata.columns) > 1:
                metadata = metadata.astype(str)
                full_metadata = full_metadata.merge(
                    metadata.drop_duplicates("identifier"),
                    on="identifier",
                    how="left",
                )

            # Verify all headers are present in metadata with NaN for missing entries
            assert len(full_metadata) == 3
            assert list(full_metadata["identifier"]) == SAMPLE_HEADERS

            # Check that missing entries are filled with NaN
            p01315_row = full_metadata[full_metadata["identifier"] == "P01315"]
            assert len(p01315_row) == 1
            assert pd.isna(p01315_row["length"].iloc[0])


class TestConstants:
    """Test module constants."""

    def test_embedding_extensions_constant(self):
        """Test EMBEDDING_EXTENSIONS constant."""
        expected_extensions = {".hdf", ".hdf5", ".h5"}
        assert EMBEDDING_EXTENSIONS == expected_extensions


class TestIntegration:
    """Integration tests for complete workflows."""

    @patch("src.protspace.data.processors.local_processor.ProteinAnnotationManager")
    @patch("src.protspace.data.processors.local_processor.h5py.File")
    def test_end_to_end_hdf5_workflow(self, mock_h5py_file, mock_annotation_extractor):
        """Test complete workflow from HDF5 input to final data."""
        # Setup HDF5 mock using helper
        setup_mock_h5_files(
            mock_h5py_file,
            {
                "P01308": np.array([0.1, 0.2, 0.3, 0.4]),
                "P01315": np.array([0.5, 0.6, 0.7, 0.8]),
                "P01316": np.array([0.9, 1.0, 1.1, 1.2]),
            },
        )

        # Setup ProteinAnnotationManager mock
        mock_extractor_instance = Mock()
        mock_extractor_instance.to_pd.return_value = SAMPLE_METADATA_DF
        mock_annotation_extractor.return_value = mock_extractor_instance

        processor = LocalDataProcessor({"random_state": 42})

        with tempfile.TemporaryDirectory() as temp_dir:
            input_path = Path(temp_dir) / "embeddings.h5"

            # Call public methods separately (like CLI does)
            data, headers = processor.load_input_files([input_path])
            metadata = processor.load_or_generate_metadata(
                headers=headers,
                annotations="length,organism",
                intermediate_dir=Path(temp_dir) / "intermediate",
                delimiter=",",
                non_binary=True,
                keep_tmp=True,
            )

            # Create full metadata (like CLI does)
            full_metadata = pd.DataFrame({"identifier": headers})
            if len(metadata.columns) > 1:
                metadata = metadata.astype(str)
                full_metadata = full_metadata.merge(
                    metadata.drop_duplicates("identifier"),
                    on="identifier",
                    how="left",
                )

            # Verify complete workflow
            assert isinstance(full_metadata, pd.DataFrame)
            assert len(full_metadata) == 3
            assert data.shape == (3, 4)
            assert headers == SAMPLE_HEADERS

            # Verify all components were called
            mock_h5py_file.assert_called_once()
            mock_annotation_extractor.assert_called_once()

    def test_end_to_end_csv_workflow(self):
        """Test complete workflow from CSV input to final data."""
        processor = LocalDataProcessor({"n_components": 2})

        with tempfile.TemporaryDirectory() as temp_dir:
            # Create CSV similarity matrix file
            sim_csv_path = Path(temp_dir) / "similarity.csv"
            sim_df = pd.DataFrame(
                SAMPLE_SIMILARITY_MATRIX, index=SAMPLE_HEADERS, columns=SAMPLE_HEADERS
            )
            sim_df.to_csv(sim_csv_path)

            # Create metadata CSV file
            annotations_csv_path = Path(temp_dir) / "annotations.csv"
            SAMPLE_METADATA_DF.to_csv(annotations_csv_path, index=False)

            # Call public methods separately (like CLI does)
            data, headers = processor.load_input_files([sim_csv_path])
            metadata = processor.load_or_generate_metadata(
                headers=headers,
                annotations=str(annotations_csv_path),
                intermediate_dir=Path(temp_dir) / "intermediate",
                delimiter=",",
                non_binary=False,
                keep_tmp=False,
            )

            # Create full metadata (like CLI does)
            full_metadata = pd.DataFrame({"identifier": headers})
            if len(metadata.columns) > 1:
                metadata = metadata.astype(str)
                full_metadata = full_metadata.merge(
                    metadata.drop_duplicates("identifier"),
                    on="identifier",
                    how="left",
                )

            # Verify complete workflow
            assert isinstance(full_metadata, pd.DataFrame)
            assert len(full_metadata) == 3
            assert data.shape == (3, 3)
            assert headers == SAMPLE_HEADERS
            assert processor.config.get("precomputed") is True

    def test_csv_with_custom_identifier_column_name(self):
        """Test that CSV files with non-'identifier' first column work correctly."""
        processor = LocalDataProcessor({"n_components": 2})

        with tempfile.TemporaryDirectory() as temp_dir:
            # Create CSV similarity matrix file
            sim_csv_path = Path(temp_dir) / "similarity.csv"
            sim_df = pd.DataFrame(
                SAMPLE_SIMILARITY_MATRIX, index=SAMPLE_HEADERS, columns=SAMPLE_HEADERS
            )
            sim_df.to_csv(sim_csv_path)

            # Create metadata CSV file with "protein_id" as first column (not "identifier")
            custom_metadata = pd.DataFrame(
                {
                    "protein_id": SAMPLE_HEADERS,  # Custom column name
                    "length": ["110", "142", "85"],
                    "organism": ["Homo sapiens", "Homo sapiens", "Mus musculus"],
                }
            )
            annotations_csv_path = Path(temp_dir) / "annotations.csv"
            custom_metadata.to_csv(annotations_csv_path, index=False)

            # Call public methods separately (like CLI does)
            data, headers = processor.load_input_files([sim_csv_path])
            metadata = processor.load_or_generate_metadata(
                headers=headers,
                annotations=str(annotations_csv_path),
                intermediate_dir=Path(temp_dir) / "intermediate",
                delimiter=",",
                non_binary=False,
                keep_tmp=False,
            )

            # Create full metadata using updated merge logic (like CLI does)
            full_metadata = pd.DataFrame({"identifier": headers})
            if len(metadata.columns) > 1:
                metadata = metadata.astype(str)
                # Use first column as identifier regardless of its name
                id_col = metadata.columns[0]
                if id_col != "identifier":
                    metadata = metadata.rename(columns={id_col: "identifier"})
                full_metadata = full_metadata.merge(
                    metadata.drop_duplicates("identifier"),
                    on="identifier",
                    how="left",
                )

            # Verify complete workflow
            assert isinstance(full_metadata, pd.DataFrame)
            assert len(full_metadata) == 3
            assert "identifier" in full_metadata.columns
            assert "protein_id" not in full_metadata.columns  # Should be dropped
            assert "length" in full_metadata.columns
            assert "organism" in full_metadata.columns
            assert list(full_metadata["identifier"]) == SAMPLE_HEADERS

    @patch("src.protspace.data.processors.local_processor.ProteinAnnotationManager")
    def test_error_recovery_workflow(self, mock_annotation_extractor):
        """Test workflow with metadata generation errors."""
        # Setup ProteinAnnotationManager to raise an error
        mock_annotation_extractor.side_effect = Exception("Network error")

        processor = LocalDataProcessor({})

        # Create mock HDF5 data
        with patch(
            "src.protspace.data.processors.local_processor.h5py.File"
        ) as mock_h5py:
            setup_mock_h5_files(mock_h5py, {"P01308": np.array([0.1, 0.2])})

            with tempfile.TemporaryDirectory() as temp_dir:
                input_path = Path(temp_dir) / "embeddings.h5"

                # Call public methods separately (like CLI does)
                data, headers = processor.load_input_files([input_path])
                metadata = processor.load_or_generate_metadata(
                    headers=headers,
                    annotations="length,organism",
                    intermediate_dir=Path(temp_dir) / "intermediate",
                    delimiter=",",
                    non_binary=False,
                    keep_tmp=False,
                )

                # Create full metadata (like CLI does)
                full_metadata = pd.DataFrame({"identifier": headers})
                if len(metadata.columns) > 1:
                    metadata = metadata.astype(str)
                    full_metadata = full_metadata.merge(
                        metadata.drop_duplicates("identifier"),
                        on="identifier",
                        how="left",
                    )

                # Should recover gracefully with empty metadata
                assert isinstance(full_metadata, pd.DataFrame)
                assert len(full_metadata) == 1
                assert "identifier" in full_metadata.columns
                assert headers == ["P01308"]


class TestIncrementalCaching:
    """Test incremental annotation caching functionality."""

    def test_categorize_annotations_by_source(self):
        """Test annotation categorization by API source."""
        annotations = {"reviewed", "length", "kingdom", "pfam"}
        categorized = AnnotationConfiguration.categorize_annotations_by_source(
            annotations
        )

        assert "reviewed" in categorized["uniprot"]
        assert "length" in categorized["uniprot"]
        assert "kingdom" in categorized["taxonomy"]
        assert "pfam" in categorized["interpro"]

    def test_determine_sources_to_fetch_all_missing(self):
        """Test source determination when all annotations are missing."""
        cached = set()
        required = {"reviewed", "kingdom", "pfam"}

        sources = AnnotationConfiguration.determine_sources_to_fetch(cached, required)

        assert sources["uniprot"] is True
        assert sources["taxonomy"] is True
        assert sources["interpro"] is True

    def test_determine_sources_to_fetch_partial_cached(self):
        """Test source determination with partial cache."""
        cached = {"identifier", "reviewed", "length", "organism_id"}
        required = {"reviewed", "length", "kingdom"}

        sources = AnnotationConfiguration.determine_sources_to_fetch(cached, required)

        assert sources["uniprot"] is False  # Already cached
        assert sources["taxonomy"] is True  # Need kingdom
        assert sources["interpro"] is False  # Not requested

    def test_determine_sources_to_fetch_taxonomy_dependency(self):
        """Test that taxonomy fetch triggers UniProt if organism_id is missing."""
        cached = {"identifier"}
        required = {"kingdom"}

        sources = AnnotationConfiguration.determine_sources_to_fetch(cached, required)

        # Should fetch UniProt to get organism_id (dependency for taxonomy)
        assert sources["uniprot"] is True
        assert sources["taxonomy"] is True

    def test_determine_sources_to_fetch_interpro_dependency(self):
        """Test that InterPro fetch triggers UniProt if sequence is missing."""
        cached = {"identifier", "organism_id"}
        required = {"pfam"}

        sources = AnnotationConfiguration.determine_sources_to_fetch(cached, required)

        # Should fetch UniProt to get sequence (dependency for InterPro)
        assert sources["uniprot"] is True
        assert sources["interpro"] is True

    def test_determine_sources_to_fetch_all_cached(self):
        """Test source determination when all annotations are cached."""
        cached = {
            "identifier",
            "reviewed",
            "length",
            "kingdom",
            "pfam",
            "organism_id",
            "sequence",
        }
        required = {"reviewed", "length", "kingdom", "pfam"}

        sources = AnnotationConfiguration.determine_sources_to_fetch(cached, required)

        assert sources["uniprot"] is False
        assert sources["taxonomy"] is False
        assert sources["interpro"] is False

    @patch("src.protspace.data.processors.local_processor.ProteinAnnotationManager")
    def test_cache_hit_returns_cached_data(self, mock_annotation_manager):
        """Test that cached metadata is returned without API calls when all annotations present."""
        with tempfile.TemporaryDirectory() as temp_dir:
            intermediate_dir = Path(temp_dir) / "intermediate"
            intermediate_dir.mkdir(parents=True, exist_ok=True)

            # Create cached metadata file
            cached_metadata = pd.DataFrame(
                {
                    "identifier": SAMPLE_HEADERS,
                    "reviewed": ["True", "True", "False"],
                    "length": ["110", "142", "85"],
                }
            )
            cache_file = intermediate_dir / "all_annotations.parquet"
            cached_metadata.to_parquet(cache_file)

            # Request subset of cached annotations
            result = LocalDataProcessor.load_or_generate_metadata(
                headers=SAMPLE_HEADERS,
                annotations="reviewed,length",
                intermediate_dir=intermediate_dir,
                delimiter=",",
                non_binary=False,
                keep_tmp=True,
                force_refetch=False,
            )

            # Should return cached data without calling ProteinAnnotationManager
            mock_annotation_manager.assert_not_called()
            assert isinstance(result, pd.DataFrame)
            assert set(result.columns) == {"identifier", "reviewed", "length"}

    @patch("src.protspace.data.processors.local_processor.ProteinAnnotationManager")
    def test_cache_miss_triggers_fetch(self, mock_annotation_manager):
        """Test that missing annotations trigger API fetch."""
        mock_instance = Mock()
        mock_instance.to_pd.return_value = pd.DataFrame(
            {
                "identifier": SAMPLE_HEADERS,
                "reviewed": ["True", "True", "False"],
                "length": ["110", "142", "85"],
                "kingdom": ["Animalia", "Animalia", "Animalia"],
            }
        )
        mock_annotation_manager.return_value = mock_instance

        with tempfile.TemporaryDirectory() as temp_dir:
            intermediate_dir = Path(temp_dir) / "intermediate"
            intermediate_dir.mkdir(parents=True, exist_ok=True)

            # Create cached metadata file with only UniProt annotations
            cached_metadata = pd.DataFrame(
                {
                    "identifier": SAMPLE_HEADERS,
                    "reviewed": ["True", "True", "False"],
                    "length": ["110", "142", "85"],
                    "organism_id": ["9606", "9606", "10090"],
                }
            )
            cache_file = intermediate_dir / "all_annotations.parquet"
            cached_metadata.to_parquet(cache_file)

            # Request annotations including taxonomy (not in cache)
            result = LocalDataProcessor.load_or_generate_metadata(
                headers=SAMPLE_HEADERS,
                annotations="reviewed,length,kingdom",
                intermediate_dir=intermediate_dir,
                delimiter=",",
                non_binary=False,
                keep_tmp=True,
                force_refetch=False,
            )

            # Should call ProteinAnnotationManager with incremental fetch
            mock_annotation_manager.assert_called_once()
            call_kwargs = mock_annotation_manager.call_args[1]
            assert call_kwargs["cached_data"] is not None
            assert call_kwargs["sources_to_fetch"]["uniprot"] is False
            assert call_kwargs["sources_to_fetch"]["taxonomy"] is True

    @patch("src.protspace.data.processors.local_processor.ProteinAnnotationManager")
    def test_force_refetch_ignores_cache(self, mock_annotation_manager):
        """Test that force_refetch flag causes cache to be ignored."""
        mock_instance = Mock()
        mock_instance.to_pd.return_value = SAMPLE_METADATA_DF
        mock_annotation_manager.return_value = mock_instance

        with tempfile.TemporaryDirectory() as temp_dir:
            intermediate_dir = Path(temp_dir) / "intermediate"
            intermediate_dir.mkdir(parents=True, exist_ok=True)

            # Create cached metadata file
            cached_metadata = pd.DataFrame(
                {
                    "identifier": SAMPLE_HEADERS,
                    "reviewed": ["True", "True", "False"],
                }
            )
            cache_file = intermediate_dir / "all_annotations.parquet"
            cached_metadata.to_parquet(cache_file)

            # Request with force_refetch=True
            result = LocalDataProcessor.load_or_generate_metadata(
                headers=SAMPLE_HEADERS,
                annotations="reviewed",
                intermediate_dir=intermediate_dir,
                delimiter=",",
                non_binary=False,
                keep_tmp=True,
                force_refetch=True,
            )

            # Should call ProteinAnnotationManager with all sources and no cached data
            mock_annotation_manager.assert_called_once()
            call_kwargs = mock_annotation_manager.call_args[1]
            assert call_kwargs["cached_data"] is None
            assert call_kwargs["sources_to_fetch"]["uniprot"] is True
            assert call_kwargs["sources_to_fetch"]["taxonomy"] is True
            assert call_kwargs["sources_to_fetch"]["interpro"] is True

    @patch("src.protspace.data.processors.local_processor.ProteinAnnotationManager")
    def test_cache_with_csv_format(self, mock_annotation_manager):
        """Test caching works with CSV format (non_binary=True)."""
        with tempfile.TemporaryDirectory() as temp_dir:
            intermediate_dir = Path(temp_dir) / "intermediate"
            intermediate_dir.mkdir(parents=True, exist_ok=True)

            # Create cached metadata CSV file
            cached_metadata = pd.DataFrame(
                {
                    "identifier": SAMPLE_HEADERS,
                    "reviewed": ["True", "True", "False"],
                }
            )
            cache_file = intermediate_dir / "all_annotations.csv"
            cached_metadata.to_csv(cache_file, index=False)

            # Request cached annotations with non_binary=True
            result = LocalDataProcessor.load_or_generate_metadata(
                headers=SAMPLE_HEADERS,
                annotations="reviewed",
                intermediate_dir=intermediate_dir,
                delimiter=",",
                non_binary=True,
                keep_tmp=True,
                force_refetch=False,
            )

            # Should return cached CSV data
            mock_annotation_manager.assert_not_called()
            assert isinstance(result, pd.DataFrame)
            assert "reviewed" in result.columns

    @patch("src.protspace.data.processors.local_processor.ProteinAnnotationManager")
    def test_no_cache_without_keep_tmp(self, mock_annotation_manager):
        """Test that caching doesn't occur when keep_tmp=False."""
        mock_instance = Mock()
        mock_instance.to_pd.return_value = SAMPLE_METADATA_DF
        mock_annotation_manager.return_value = mock_instance

        with tempfile.TemporaryDirectory() as temp_dir:
            # Note: intermediate_dir exists but keep_tmp=False
            intermediate_dir = Path(temp_dir) / "intermediate"
            intermediate_dir.mkdir(parents=True, exist_ok=True)

            result = LocalDataProcessor.load_or_generate_metadata(
                headers=SAMPLE_HEADERS,
                annotations="reviewed,length",
                intermediate_dir=intermediate_dir,
                delimiter=",",
                non_binary=False,
                keep_tmp=False,  # No caching
                force_refetch=False,
            )

            # Should call ProteinAnnotationManager without cache support
            mock_annotation_manager.assert_called_once()
            call_kwargs = mock_annotation_manager.call_args[1]
            assert (
                "cached_data" not in call_kwargs
                or call_kwargs.get("cached_data") is None
            )
