import pytest
import tempfile
from pathlib import Path
from unittest.mock import Mock, patch, MagicMock
import numpy as np
import pandas as pd

from src.protspace.data.local_data_processor import LocalDataProcessor, EMBEDDING_EXTENSIONS
from src.protspace.utils import REDUCERS


# Test data
SAMPLE_HEADERS = ["P01308", "P01315", "P01316"]
SAMPLE_EMBEDDINGS = np.array([
    [0.1, 0.2, 0.3, 0.4],
    [0.5, 0.6, 0.7, 0.8], 
    [0.9, 1.0, 1.1, 1.2]
])
SAMPLE_SIMILARITY_MATRIX = np.array([
    [1.0, 0.8, 0.7],
    [0.8, 1.0, 0.9],
    [0.7, 0.9, 1.0]
])
SAMPLE_METADATA_DF = pd.DataFrame({
    'identifier': SAMPLE_HEADERS,
    'length': ['110', '142', '85'],
    'organism': ['Homo sapiens', 'Homo sapiens', 'Mus musculus']
})


class TestLocalDataProcessorInit:
    """Test LocalDataProcessor initialization."""

    def test_init_removes_cli_args(self):
        """Test that CLI-specific arguments are removed from config."""
        config_with_cli_args = {
            'input': 'input.h5',
            'features': 'features.csv',
            'output': 'output.json',
            'methods': ['pca'],
            'verbose': True,
            'custom_names': {'pca2': 'Custom_PCA'},
            'delimiter': ',',
            'n_components': 2,
            'random_state': 42
        }
        
        processor = LocalDataProcessor(config_with_cli_args)
        
        # Check that CLI args are removed but dimension reduction args remain
        assert 'input' not in processor.config
        assert 'features' not in processor.config
        assert 'output' not in processor.config
        assert 'methods' not in processor.config
        assert 'verbose' not in processor.config
        assert 'custom_names' not in processor.config
        assert 'delimiter' not in processor.config
        
        assert 'n_components' in processor.config
        assert 'random_state' in processor.config
        assert set(processor.reducers.keys()) == set(REDUCERS.keys())

    def test_init_with_minimal_config(self):
        """Test initialization with minimal configuration."""
        minimal_config = {}
        processor = LocalDataProcessor(minimal_config)
        
        assert processor.config == {}
        assert set(processor.reducers.keys()) == set(REDUCERS.keys())


class TestLoadInputFile:
    """Test the _load_input_file method."""

    @patch('src.protspace.data.local_data_processor.h5py.File')
    def test_load_input_file_hdf5(self, mock_h5py_file):
        """Test loading embeddings from HDF5 file."""
        # Setup mock HDF5 file
        mock_file = MagicMock()
        mock_h5py_file.return_value.__enter__.return_value = mock_file
        
        # Mock HDF5 file structure
        mock_file.items.return_value = [
            ('P01308', np.array([0.1, 0.2, 0.3, 0.4])),
            ('P01315', np.array([0.5, 0.6, 0.7, 0.8])),
            ('P01316', np.array([0.9, 1.0, 1.1, 1.2]))
        ]
        
        processor = LocalDataProcessor({})
        input_path = Path("test_embeddings.h5")
        
        data, headers = processor._load_input_file(input_path)
        
        # Verify results
        assert len(headers) == 3
        assert headers == SAMPLE_HEADERS
        assert data.shape == (3, 4)
        np.testing.assert_array_almost_equal(data, SAMPLE_EMBEDDINGS)
        
        # Verify HDF5 file was opened
        mock_h5py_file.assert_called_once_with(input_path, "r")

    def test_load_input_file_csv(self):
        """Test loading similarity matrix from CSV file."""
        processor = LocalDataProcessor({})
        
        # Create mock CSV data
        csv_data = pd.DataFrame(
            SAMPLE_SIMILARITY_MATRIX,
            index=SAMPLE_HEADERS,
            columns=SAMPLE_HEADERS
        )
        
        with patch('pandas.read_csv', return_value=csv_data):
            input_path = Path("test_similarity.csv")
            
            data, headers = processor._load_input_file(input_path)
            
            # Verify results
            assert headers == SAMPLE_HEADERS
            np.testing.assert_array_almost_equal(data, SAMPLE_SIMILARITY_MATRIX)
            assert processor.config.get('precomputed') is True

    def test_load_input_file_csv_asymmetric_matrix(self):
        """Test loading asymmetric similarity matrix gets symmetrized."""
        processor = LocalDataProcessor({})
        
        # Create asymmetric matrix
        asymmetric_matrix = np.array([
            [1.0, 0.8, 0.7],
            [0.9, 1.0, 0.9],  # Changed from 0.8 to 0.9
            [0.6, 0.8, 1.0]   # Changed from 0.7, 0.9
        ])
        
        csv_data = pd.DataFrame(
            asymmetric_matrix,
            index=SAMPLE_HEADERS,
            columns=SAMPLE_HEADERS
        )
        
        with patch('pandas.read_csv', return_value=csv_data):
            input_path = Path("test_asymmetric.csv")
            
            data, headers = processor._load_input_file(input_path)
            
            # Verify matrix was symmetrized
            np.testing.assert_array_equal(data, data.T)
            assert headers == SAMPLE_HEADERS

    def test_load_input_file_csv_mismatched_labels(self):
        """Test error handling for CSV with mismatched row/column labels."""
        processor = LocalDataProcessor({})
        
        # Create CSV with mismatched labels
        csv_data = pd.DataFrame(
            SAMPLE_SIMILARITY_MATRIX,
            index=SAMPLE_HEADERS,
            columns=['A', 'B', 'C']  # Different column labels
        )
        
        with patch('pandas.read_csv', return_value=csv_data):
            input_path = Path("test_mismatched.csv")
            
            with pytest.raises(ValueError, match="Similarity matrix must have matching row and column labels"):
                processor._load_input_file(input_path)

    def test_load_input_file_unsupported_format(self):
        """Test error handling for unsupported file format."""
        processor = LocalDataProcessor({})
        input_path = Path("test_file.txt")
        
        with pytest.raises(ValueError, match="Input file must be either HDF"):
            processor._load_input_file(input_path)


class TestLoadOrGenerateMetadata:
    """Test the _load_or_generate_metadata static method."""

    def test_load_metadata_from_csv(self):
        """Test loading metadata from existing CSV file."""
        with tempfile.TemporaryDirectory() as temp_dir:
            # Create test CSV file
            csv_path = Path(temp_dir) / "metadata.csv"
            SAMPLE_METADATA_DF.to_csv(csv_path, index=False)
            
            output_path = Path(temp_dir) / "output.json"
            
            result = LocalDataProcessor._load_or_generate_metadata(
                headers=SAMPLE_HEADERS,
                features=str(csv_path),
                output_path=output_path,
                delimiter=",",
                non_binary=False,
                keep_tmp=False
            )
            
            # Verify result
            assert isinstance(result, pd.DataFrame)
            assert len(result) == 3
            assert list(result['identifier']) == SAMPLE_HEADERS

    def test_load_metadata_csv_with_custom_delimiter(self):
        """Test loading CSV with custom delimiter."""
        with tempfile.TemporaryDirectory() as temp_dir:
            # Create test CSV with semicolon delimiter
            csv_path = Path(temp_dir) / "metadata.csv"
            SAMPLE_METADATA_DF.to_csv(csv_path, index=False, sep=';')
            
            output_path = Path(temp_dir) / "output.json"
            
            result = LocalDataProcessor._load_or_generate_metadata(
                headers=SAMPLE_HEADERS,
                features=str(csv_path),
                output_path=output_path,
                delimiter=";",
                non_binary=False,
                keep_tmp=False
            )
            
            # Verify result
            assert isinstance(result, pd.DataFrame)
            assert len(result) == 3

    @patch('src.protspace.data.local_data_processor.ProteinFeatureExtractor')
    def test_generate_metadata_with_features(self, mock_feature_extractor):
        """Test metadata generation with specified features."""
        # Setup mock
        mock_extractor_instance = Mock()
        mock_extractor_instance.to_pd.return_value = SAMPLE_METADATA_DF
        mock_feature_extractor.return_value = mock_extractor_instance
        
        with tempfile.TemporaryDirectory() as temp_dir:
            output_path = Path(temp_dir) / "output.json"
            
            result = LocalDataProcessor._load_or_generate_metadata(
                headers=SAMPLE_HEADERS,
                features="length,organism",
                output_path=output_path,
                delimiter=",",
                non_binary=True,
                keep_tmp=True
            )
            
            # Verify ProteinFeatureExtractor was called correctly
            mock_feature_extractor.assert_called_once()
            call_kwargs = mock_feature_extractor.call_args[1]
            assert call_kwargs['headers'] == SAMPLE_HEADERS
            assert call_kwargs['features'] == ['length', 'organism']
            assert call_kwargs['non_binary'] is True
            
            # Verify result
            pd.testing.assert_frame_equal(result, SAMPLE_METADATA_DF)

    @patch('src.protspace.data.local_data_processor.ProteinFeatureExtractor')
    def test_generate_metadata_no_features(self, mock_feature_extractor):
        """Test metadata generation without specifying features."""
        # Setup mock
        mock_extractor_instance = Mock()
        mock_extractor_instance.to_pd.return_value = SAMPLE_METADATA_DF
        mock_feature_extractor.return_value = mock_extractor_instance
        
        with tempfile.TemporaryDirectory() as temp_dir:
            output_path = Path(temp_dir) / "output.json"
            
            result = LocalDataProcessor._load_or_generate_metadata(
                headers=SAMPLE_HEADERS,
                features=None,
                output_path=output_path,
                delimiter=",",
                non_binary=False,
                keep_tmp=False
            )
            
            # Verify ProteinFeatureExtractor was called with None features
            call_kwargs = mock_feature_extractor.call_args[1]
            assert call_kwargs['features'] is None

    @patch('src.protspace.data.local_data_processor.ProteinFeatureExtractor')
    def test_generate_metadata_file_cleanup(self, mock_feature_extractor):
        """Test metadata file cleanup when keep_tmp=False."""
        # Setup mock
        mock_extractor_instance = Mock()
        mock_extractor_instance.to_pd.return_value = SAMPLE_METADATA_DF
        mock_feature_extractor.return_value = mock_extractor_instance
        
        with tempfile.TemporaryDirectory() as temp_dir:
            output_path = Path(temp_dir) / "output.json"
            metadata_file = output_path.with_suffix('') / "all_features.csv"
            
            # Create the metadata file to simulate it being created
            metadata_file.parent.mkdir(parents=True, exist_ok=True)
            metadata_file.touch()
            
            with patch('pathlib.Path.exists', return_value=True), \
                 patch('pathlib.Path.unlink') as mock_unlink:
                
                LocalDataProcessor._load_or_generate_metadata(
                    headers=SAMPLE_HEADERS,
                    features="length",
                    output_path=output_path,
                    delimiter=",",
                    non_binary=True,
                    keep_tmp=False
                )
                
                # Verify file was deleted
                mock_unlink.assert_called_once()

    def test_load_metadata_error_handling(self):
        """Test error handling in metadata loading."""
        with tempfile.TemporaryDirectory() as temp_dir:
            output_path = Path(temp_dir) / "output.json"
            
            # Test with non-existent CSV file
            result = LocalDataProcessor._load_or_generate_metadata(
                headers=SAMPLE_HEADERS,
                features="nonexistent.csv",
                output_path=output_path,
                delimiter=",",
                non_binary=False,
                keep_tmp=False
            )
            
            # Should return empty DataFrame
            assert isinstance(result, pd.DataFrame)
            assert list(result.columns) == ["identifier"]


class TestLoadData:
    """Test the main load_data method."""

    @patch('src.protspace.data.local_data_processor.LocalDataProcessor._load_or_generate_metadata')
    @patch('src.protspace.data.local_data_processor.LocalDataProcessor._load_input_file')
    def test_load_data_success(self, mock_load_input, mock_load_metadata):
        """Test successful data loading."""
        # Setup mocks
        mock_load_input.return_value = (SAMPLE_EMBEDDINGS, SAMPLE_HEADERS)
        mock_load_metadata.return_value = SAMPLE_METADATA_DF
        
        processor = LocalDataProcessor({})
        
        with tempfile.TemporaryDirectory() as temp_dir:
            input_path = Path(temp_dir) / "input.h5"
            features_path = Path(temp_dir) / "metadata.csv"
            output_path = Path(temp_dir) / "output.json"
            
            result = processor.load_data(
                input_path=input_path,
                features=features_path,
                output_path=output_path,
                delimiter=",",
                non_binary=False,
                keep_tmp=False
            )
            
            # Verify results
            metadata_df, data, headers = result
            
            assert isinstance(metadata_df, pd.DataFrame)
            assert len(metadata_df) == 3
            assert list(metadata_df['identifier']) == SAMPLE_HEADERS
            np.testing.assert_array_equal(data, SAMPLE_EMBEDDINGS)
            assert headers == SAMPLE_HEADERS
            
            # Verify method calls
            mock_load_input.assert_called_once_with(input_path)
            mock_load_metadata.assert_called_once()

    @patch('src.protspace.data.local_data_processor.LocalDataProcessor._load_or_generate_metadata')
    @patch('src.protspace.data.local_data_processor.LocalDataProcessor._load_input_file')
    def test_load_data_with_partial_metadata(self, mock_load_input, mock_load_metadata):
        """Test data loading with partial metadata (missing entries)."""
        # Setup mocks
        mock_load_input.return_value = (SAMPLE_EMBEDDINGS, SAMPLE_HEADERS)
        
        # Partial metadata missing one entry
        partial_metadata = pd.DataFrame({
            'identifier': ['P01308', 'P01316'],  # Missing P01315
            'length': ['110', '85']
        })
        mock_load_metadata.return_value = partial_metadata
        
        processor = LocalDataProcessor({})
        
        with tempfile.TemporaryDirectory() as temp_dir:
            input_path = Path(temp_dir) / "input.h5"
            output_path = Path(temp_dir) / "output.json"
            
            result = processor.load_data(
                input_path=input_path,
                features="length,organism",
                output_path=output_path,
                delimiter=",",
                non_binary=False,
                keep_tmp=False
            )
            
            metadata_df, data, headers = result
            
            # Verify all headers are present in metadata with NaN for missing entries
            assert len(metadata_df) == 3
            assert list(metadata_df['identifier']) == SAMPLE_HEADERS
            
            # Check that missing entries are filled with NaN
            p01315_row = metadata_df[metadata_df['identifier'] == 'P01315']
            assert len(p01315_row) == 1
            assert pd.isna(p01315_row['length'].iloc[0])


class TestConstants:
    """Test module constants."""

    def test_embedding_extensions_constant(self):
        """Test EMBEDDING_EXTENSIONS constant."""
        expected_extensions = {".hdf", ".hdf5", ".h5"}
        assert EMBEDDING_EXTENSIONS == expected_extensions


class TestIntegration:
    """Integration tests for complete workflows."""

    @patch('src.protspace.data.local_data_processor.ProteinFeatureExtractor')
    @patch('src.protspace.data.local_data_processor.h5py.File')
    def test_end_to_end_hdf5_workflow(self, mock_h5py_file, mock_feature_extractor):
        """Test complete workflow from HDF5 input to final data."""
        # Setup HDF5 mock
        mock_file = MagicMock()
        mock_h5py_file.return_value.__enter__.return_value = mock_file
        mock_file.items.return_value = [
            ('P01308', np.array([0.1, 0.2, 0.3, 0.4])),
            ('P01315', np.array([0.5, 0.6, 0.7, 0.8])),
            ('P01316', np.array([0.9, 1.0, 1.1, 1.2]))
        ]
        
        # Setup ProteinFeatureExtractor mock
        mock_extractor_instance = Mock()
        mock_extractor_instance.to_pd.return_value = SAMPLE_METADATA_DF
        mock_feature_extractor.return_value = mock_extractor_instance
        
        processor = LocalDataProcessor({'random_state': 42})
        
        with tempfile.TemporaryDirectory() as temp_dir:
            input_path = Path(temp_dir) / "embeddings.h5"
            output_path = Path(temp_dir) / "output.json"
            
            result = processor.load_data(
                input_path=input_path,
                features="length,organism",
                output_path=output_path,
                delimiter=",",
                non_binary=True,
                keep_tmp=True
            )
            
            metadata_df, data, headers = result
            
            # Verify complete workflow
            assert isinstance(metadata_df, pd.DataFrame)
            assert len(metadata_df) == 3
            assert data.shape == (3, 4)
            assert headers == SAMPLE_HEADERS
            
            # Verify all components were called
            mock_h5py_file.assert_called_once()
            mock_feature_extractor.assert_called_once()

    def test_end_to_end_csv_workflow(self):
        """Test complete workflow from CSV input to final data."""
        processor = LocalDataProcessor({'n_components': 2})
        
        with tempfile.TemporaryDirectory() as temp_dir:
            # Create CSV similarity matrix file
            sim_csv_path = Path(temp_dir) / "similarity.csv"
            sim_df = pd.DataFrame(
                SAMPLE_SIMILARITY_MATRIX,
                index=SAMPLE_HEADERS,
                columns=SAMPLE_HEADERS
            )
            sim_df.to_csv(sim_csv_path)
            
            # Create metadata CSV file
            features_csv_path = Path(temp_dir) / "features.csv"
            SAMPLE_METADATA_DF.to_csv(features_csv_path, index=False)
            
            output_path = Path(temp_dir) / "output.json"
            
            result = processor.load_data(
                input_path=sim_csv_path,
                features=str(features_csv_path),
                output_path=output_path,
                delimiter=",",
                non_binary=False,
                keep_tmp=False
            )
            
            metadata_df, data, headers = result
            
            # Verify complete workflow
            assert isinstance(metadata_df, pd.DataFrame)
            assert len(metadata_df) == 3
            assert data.shape == (3, 3)
            assert headers == SAMPLE_HEADERS
            assert processor.config.get('precomputed') is True

    @patch('src.protspace.data.local_data_processor.ProteinFeatureExtractor')
    def test_error_recovery_workflow(self, mock_feature_extractor):
        """Test workflow with metadata generation errors."""
        # Setup ProteinFeatureExtractor to raise an error
        mock_feature_extractor.side_effect = Exception("Network error")
        
        processor = LocalDataProcessor({})
        
        # Create mock HDF5 data
        with patch('src.protspace.data.local_data_processor.h5py.File') as mock_h5py:
            mock_file = MagicMock()
            mock_h5py.return_value.__enter__.return_value = mock_file
            mock_file.items.return_value = [('P01308', np.array([0.1, 0.2]))]
            
            with tempfile.TemporaryDirectory() as temp_dir:
                input_path = Path(temp_dir) / "embeddings.h5"
                output_path = Path(temp_dir) / "output.json"
                
                result = processor.load_data(
                    input_path=input_path,
                    features="length,organism",
                    output_path=output_path,
                    delimiter=",",
                    non_binary=False,
                    keep_tmp=False
                )
                
                metadata_df, data, headers = result
                
                # Should recover gracefully with empty metadata
                assert isinstance(metadata_df, pd.DataFrame)
                assert len(metadata_df) == 1
                assert 'identifier' in metadata_df.columns
                assert headers == ['P01308'] 