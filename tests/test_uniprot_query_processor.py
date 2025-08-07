import tempfile
import pytest
import gzip
from pathlib import Path
from unittest.mock import Mock, patch, mock_open

import numpy as np
import pandas as pd
import requests

from src.protspace.data.uniprot_query_processor import UniProtQueryProcessor
from src.protspace.utils import REDUCERS


# Test constants
SAMPLE_QUERY = "organism_id:9606 AND keyword:insulin"
SAMPLE_HEADERS = ["P01308", "P01315", "P01316"]
SAMPLE_FASTA_CONTENT = """>sp|P01308|INS_HUMAN Insulin OS=Homo sapiens OX=9606 GN=INS PE=1 SV=1
MALWMRLLPLLALLALWGPDPAAAFVNQHLCGSHLVEALYLVCGERGFFYTPKTRREAEDLQVGQVELGGGPGAGSLQPLALEGSLQKRGIVEQCCTSICSLYQLENYCN
>sp|P01315|INSL3_HUMAN Insulin-like 3 OS=Homo sapiens OX=9606 GN=INSL3 PE=1 SV=1
MDSLLSASLVLLALSLALTCSGQPAAPEMVKLCGRELVRAQIAICGMSTWKRQAAGNKLRRLMYAKRCCESFIRALEDGCFWK
>sp|P01316|INSL4_HUMAN Insulin-like 4 OS=Homo sapiens OX=9606 GN=INSL4 PE=1 SV=1
MDSLLSASLVLLALSLALTCSGQPAAPEMVKLCGRELVRAQIAICGMSTWKRQAAGNKLRRLMYAKRCCESFIRALEDGCFWK
"""

SAMPLE_SIMILARITY_MATRIX = np.array([[1.0, 0.8, 0.7], [0.8, 1.0, 0.9], [0.7, 0.9, 1.0]])

SAMPLE_METADATA_DF = pd.DataFrame(
    {
        "identifier": SAMPLE_HEADERS,
        "length": [110, 142, 142],
        "organism": ["Homo sapiens", "Homo sapiens", "Homo sapiens"],
    }
)


@pytest.fixture
def mock_config():
    """Provide a basic configuration for UniProtQueryProcessor."""
    return {"n_components": 2, "random_state": 42, "n_neighbors": 15, "min_dist": 0.1}


@pytest.fixture
def processor(mock_config):
    """Create a UniProtQueryProcessor instance with mocked config."""
    return UniProtQueryProcessor(mock_config)


@pytest.fixture
def temp_dir():
    """Create a temporary directory for test files."""
    with tempfile.TemporaryDirectory() as tmp_dir:
        yield Path(tmp_dir)


@pytest.fixture
def mock_response():
    """Create a mock HTTP response for UniProt API calls."""
    response = Mock()
    compressed_content = gzip.compress(SAMPLE_FASTA_CONTENT.encode())
    response.headers = {"content-length": str(len(compressed_content))}
    response.iter_content.return_value = [compressed_content]
    response.raise_for_status.return_value = None
    return response


@pytest.fixture
def mock_pymmseqs_df():
    """Create a mock DataFrame for pymmseqs results."""
    return pd.DataFrame(
        {
            "query": ["P01308", "P01308", "P01315", "P01315", "P01316", "P01316"],
            "target": ["P01308", "P01315", "P01315", "P01316", "P01316", "P01308"],
            "fident": [1.0, 0.8, 1.0, 0.9, 1.0, 0.7],
        }
    )


class TestUniProtQueryProcessorInit:
    """Test UniProtQueryProcessor initialization."""

    def test_init_removes_cli_args(self):
        """Test that CLI-specific arguments are removed from config."""
        config_with_cli_args = {
            "query": "test",
            "sp": True,
            "output": "output.json",
            "methods": ["pca"],
            "verbose": True,
            "custom_names": {"pca2": "Custom_PCA"},
            "delimiter": ",",
            "features": "features.csv",
            "save_files": True,
            "no_save_files": False,
            "keep_tmp": True,
            "n_components": 2,
            "random_state": 42,
        }

        processor = UniProtQueryProcessor(config_with_cli_args)

        # Check that CLI args are removed but dimension reduction args remain
        assert "query" not in processor.config
        assert "output" not in processor.config
        assert "n_components" in processor.config
        assert "random_state" in processor.config
        assert set(processor.reducers.keys()) == set(REDUCERS.keys())

    def test_init_with_minimal_config(self):
        """Test initialization with minimal configuration."""
        minimal_config = {}
        processor = UniProtQueryProcessor(minimal_config)

        assert processor.config == {}
        assert set(processor.reducers.keys()) == set(REDUCERS.keys())


class TestProcessQuery:
    """Test the main process_query method."""

    @patch("src.protspace.data.uniprot_query_processor.ProteinFeatureExtractor")
    @patch("src.protspace.data.uniprot_query_processor.UniProtQueryProcessor._get_similarity_matrix")
    @patch("src.protspace.data.uniprot_query_processor.UniProtQueryProcessor._search_and_download_fasta")
    def test_process_query_success(
        self,
        mock_search_fasta,
        mock_similarity,
        mock_feature_extractor,
        processor,
        temp_dir,
    ):
        """Test successful query processing."""
        # Setup mocks
        fasta_path = temp_dir / "temp.fasta"
        fasta_path.write_text(SAMPLE_FASTA_CONTENT)

        mock_search_fasta.return_value = (SAMPLE_HEADERS, fasta_path)
        mock_similarity.return_value = (SAMPLE_SIMILARITY_MATRIX, SAMPLE_HEADERS)

        mock_extractor_instance = Mock()
        mock_extractor_instance.to_pd.return_value = SAMPLE_METADATA_DF
        mock_feature_extractor.return_value = mock_extractor_instance

        # Execute
        output_path = temp_dir / "output.json"
        result = processor.process_query(
            query=SAMPLE_QUERY,
            output_path=output_path,
            features="length,organism",
            keep_tmp=False,
        )

        # Verify
        metadata_df, similarity_matrix, headers, saved_files = result

        assert isinstance(metadata_df, pd.DataFrame)
        assert len(metadata_df) == 3
        assert list(metadata_df["identifier"]) == SAMPLE_HEADERS

        np.testing.assert_array_equal(similarity_matrix, SAMPLE_SIMILARITY_MATRIX)
        assert headers == SAMPLE_HEADERS
        assert saved_files == {}  # No files saved when keep_tmp=False

        # Verify method calls
        mock_search_fasta.assert_called_once_with(SAMPLE_QUERY, save_to=None)
        mock_similarity.assert_called_once_with(fasta_path, SAMPLE_HEADERS)
        mock_feature_extractor.assert_called_once()

    @patch("src.protspace.data.uniprot_query_processor.ProteinFeatureExtractor")
    @patch(
        "src.protspace.data.uniprot_query_processor.UniProtQueryProcessor._get_similarity_matrix"
    )
    @patch(
        "src.protspace.data.uniprot_query_processor.UniProtQueryProcessor._search_and_download_fasta"
    )
    def test_process_query_with_keep_tmp(
        self,
        mock_search_fasta,
        mock_similarity,
        mock_feature_extractor,
        processor,
        temp_dir,
    ):
        """Test query processing with temporary file preservation."""
        # Setup mocks
        fasta_path = temp_dir / "temp.fasta"
        fasta_path.write_text(SAMPLE_FASTA_CONTENT)

        mock_search_fasta.return_value = (SAMPLE_HEADERS, fasta_path)
        mock_similarity.return_value = (SAMPLE_SIMILARITY_MATRIX, SAMPLE_HEADERS)

        mock_extractor_instance = Mock()
        mock_extractor_instance.to_pd.return_value = SAMPLE_METADATA_DF
        mock_feature_extractor.return_value = mock_extractor_instance

        # Execute
        output_path = temp_dir / "output"
        result = processor.process_query(
            query=SAMPLE_QUERY, output_path=output_path, keep_tmp=True, non_binary=True
        )

        # Verify
        metadata_df, similarity_matrix, headers, saved_files = result

        expected_fasta_path = output_path / "sequences.fasta"
        expected_metadata_path = output_path / "all_features.csv"
        expected_similarity_path = output_path / "similarity_matrix.csv"

        assert "fasta" in saved_files
        assert "metadata" in saved_files
        assert "similarity_matrix" in saved_files

        # Verify save paths
        mock_search_fasta.assert_called_once_with(
            SAMPLE_QUERY, save_to=expected_fasta_path
        )

    @patch(
        "src.protspace.data.uniprot_query_processor.UniProtQueryProcessor._search_and_download_fasta"
    )
    def test_process_query_no_sequences_found(
        self, mock_search_fasta, processor, temp_dir
    ):
        """Test error handling when no sequences are found."""
        mock_search_fasta.return_value = ([], None)

        output_path = temp_dir / "output.json"

        with pytest.raises(ValueError, match="No sequences found for query"):
            processor.process_query(query="invalid_query", output_path=output_path)


class TestSearchAndDownloadFasta:
    """Test _search_and_download_fasta method."""

    @patch("src.protspace.data.uniprot_query_processor.requests.get")
    @patch("src.protspace.data.uniprot_query_processor.gzip.open")
    @patch("src.protspace.data.uniprot_query_processor.tempfile.NamedTemporaryFile")
    def test_search_and_download_success(
        self,
        mock_tempfile,
        mock_gzip_open,
        mock_requests_get,
        processor,
        temp_dir,
        mock_response,
    ):
        """Test successful FASTA download and extraction."""
        # Setup mocks
        temp_gz_path = temp_dir / "temp.fasta.gz"
        mock_temp_file = Mock()
        mock_temp_file.name = str(temp_gz_path)
        mock_tempfile.return_value = mock_temp_file

        # Create compressed FASTA content
        compressed_content = gzip.compress(SAMPLE_FASTA_CONTENT.encode())
        mock_response.iter_content.return_value = [compressed_content]
        mock_requests_get.return_value = mock_response

        # Mock gzip reading
        mock_gzip_open.return_value.__enter__.return_value.read.return_value = (
            SAMPLE_FASTA_CONTENT
        )

        # Mock file operations
        with patch("builtins.open", mock_open()) as mock_file:
            with patch.object(
                processor,
                "_extract_identifiers_from_fasta",
                return_value=SAMPLE_HEADERS,
            ):
                # Execute
                headers, fasta_path = processor._search_and_download_fasta(SAMPLE_QUERY)

                # Verify
                assert headers == SAMPLE_HEADERS
                assert isinstance(fasta_path, Path)

                # Verify API call
                mock_requests_get.assert_called_once()
                call_args = mock_requests_get.call_args
                assert call_args[0][0] == "https://rest.uniprot.org/uniprotkb/stream"
                assert call_args[1]["params"]["query"] == SAMPLE_QUERY
                assert call_args[1]["params"]["format"] == "fasta"
                assert call_args[1]["params"]["compressed"] == "true"

    @patch("src.protspace.data.uniprot_query_processor.requests.get")
    def test_search_and_download_request_error(self, mock_requests_get, processor):
        """Test handling of HTTP request errors."""
        mock_requests_get.side_effect = requests.RequestException("Network error")

        with pytest.raises(requests.RequestException):
            processor._search_and_download_fasta(SAMPLE_QUERY)

    @patch("src.protspace.data.uniprot_query_processor.requests.get")
    @patch("src.protspace.data.uniprot_query_processor.gzip.open")
    @patch("src.protspace.data.uniprot_query_processor.tempfile.NamedTemporaryFile")
    def test_search_and_download_with_save_path(
        self,
        mock_tempfile,
        mock_gzip_open,
        mock_requests_get,
        processor,
        temp_dir,
        mock_response,
    ):
        """Test FASTA download with specified save path."""
        # Setup
        save_path = temp_dir / "custom_sequences.fasta"
        temp_gz_path = temp_dir / "temp.fasta.gz"

        mock_temp_file = Mock()
        mock_temp_file.name = str(temp_gz_path)
        mock_tempfile.return_value = mock_temp_file

        compressed_content = gzip.compress(SAMPLE_FASTA_CONTENT.encode())
        mock_response.iter_content.return_value = [compressed_content]
        mock_requests_get.return_value = mock_response

        mock_gzip_open.return_value.__enter__.return_value.read.return_value = (
            SAMPLE_FASTA_CONTENT
        )

        with patch("builtins.open", mock_open()) as mock_file:
            with patch.object(
                processor,
                "_extract_identifiers_from_fasta",
                return_value=SAMPLE_HEADERS,
            ):
                # Execute
                headers, fasta_path = processor._search_and_download_fasta(
                    SAMPLE_QUERY, save_to=save_path
                )

                # Verify
                assert fasta_path == save_path
                assert headers == SAMPLE_HEADERS


class TestExtractIdentifiersFromFasta:
    """Test _extract_identifiers_from_fasta method."""

    def test_extract_identifiers_swissprot_format(self, processor, temp_dir):
        """Test identifier extraction from SwissProt format headers."""
        fasta_content = """>sp|P01308|INS_HUMAN Insulin
SEQUENCE1
>sp|P01315|INSL3_HUMAN Insulin-like 3
SEQUENCE2
"""

        # Create compressed file
        gz_path = temp_dir / "test.fasta.gz"
        with gzip.open(gz_path, "wt") as f:
            f.write(fasta_content)

        identifiers = processor._extract_identifiers_from_fasta(str(gz_path))

        assert identifiers == ["P01308", "P01315"]

    def test_extract_identifiers_trembl_format(self, processor, temp_dir):
        """Test identifier extraction from TrEMBL format headers."""
        fasta_content = """>tr|A0A0A0MRZ7|A0A0A0MRZ7_HUMAN Description
SEQUENCE1
>tr|Q8N2C7|Q8N2C7_HUMAN Description
SEQUENCE2
"""

        gz_path = temp_dir / "test.fasta.gz"
        with gzip.open(gz_path, "wt") as f:
            f.write(fasta_content)

        identifiers = processor._extract_identifiers_from_fasta(str(gz_path))

        assert identifiers == ["A0A0A0MRZ7", "Q8N2C7"]

    def test_extract_identifiers_simple_format(self, processor, temp_dir):
        """Test identifier extraction from simple format headers."""
        fasta_content = """>P01308 Insulin
SEQUENCE1
>P01315 Insulin-like
SEQUENCE2
"""

        gz_path = temp_dir / "test.fasta.gz"
        with gzip.open(gz_path, "wt") as f:
            f.write(fasta_content)

        identifiers = processor._extract_identifiers_from_fasta(str(gz_path))

        assert identifiers == ["P01308", "P01315"]


class TestGetSimilarityMatrix:
    """Test _get_similarity_matrix method."""

    @patch("src.protspace.data.uniprot_query_processor.easy_search")
    @patch("src.protspace.data.uniprot_query_processor.shutil.rmtree")
    def test_get_similarity_matrix_success(
        self, mock_rmtree, mock_easy_search, processor, temp_dir, mock_pymmseqs_df
    ):
        """Test successful similarity matrix generation."""
        # Setup mocks
        mock_result = Mock()
        mock_result.to_pandas.return_value = mock_pymmseqs_df
        mock_easy_search.return_value = mock_result

        fasta_path = temp_dir / "sequences.fasta"
        fasta_path.write_text(SAMPLE_FASTA_CONTENT)

        # Execute
        similarity_matrix, headers = processor._get_similarity_matrix(
            fasta_path, SAMPLE_HEADERS
        )

        # Verify matrix properties
        assert similarity_matrix.shape == (3, 3)
        assert headers == SAMPLE_HEADERS

        # Verify diagonal elements (self-similarity should be 1.0)
        for i in range(3):
            assert similarity_matrix[i, i] == 1.0

        # Verify symmetry
        np.testing.assert_array_equal(similarity_matrix, similarity_matrix.T)

        # Verify pymmseqs call
        mock_easy_search.assert_called_once()
        call_kwargs = mock_easy_search.call_args[1]
        assert call_kwargs["query_fasta"] == str(fasta_path.absolute())
        assert call_kwargs["target_fasta_or_db"] == str(fasta_path.absolute())
        assert call_kwargs["max_seqs"] == 9  # 3 * 3
        assert call_kwargs["e"] == 1000000
        assert call_kwargs["s"] == 8

        # Verify cleanup
        mock_rmtree.assert_called_once()

    @patch("src.protspace.data.uniprot_query_processor.easy_search")
    @patch("src.protspace.data.uniprot_query_processor.shutil.rmtree")
    def test_get_similarity_matrix_with_missing_pairs(
        self, mock_rmtree, mock_easy_search, processor, temp_dir
    ):
        """Test similarity matrix with missing sequence pairs."""
        # Create DataFrame with only some pairs
        incomplete_df = pd.DataFrame(
            {
                "query": ["P01308", "P01315"],
                "target": ["P01308", "P01315"],
                "fident": [1.0, 1.0],
            }
        )

        mock_result = Mock()
        mock_result.to_pandas.return_value = incomplete_df
        mock_easy_search.return_value = mock_result

        fasta_path = temp_dir / "sequences.fasta"
        fasta_path.write_text(SAMPLE_FASTA_CONTENT)

        # Execute
        similarity_matrix, headers = processor._get_similarity_matrix(
            fasta_path, SAMPLE_HEADERS
        )

        # Verify
        assert similarity_matrix.shape == (3, 3)
        assert similarity_matrix[0, 0] == 1.0  # P01308 self-similarity
        assert similarity_matrix[1, 1] == 1.0  # P01315 self-similarity
        assert similarity_matrix[2, 2] == 0.0  # P01316 missing, should be 0


class TestSaveSimilarityMatrix:
    """Test _save_similarity_matrix method."""

    def test_save_similarity_matrix(self, processor, temp_dir):
        """Test saving similarity matrix to CSV."""
        save_path = temp_dir / "similarity.csv"

        processor._save_similarity_matrix(
            SAMPLE_SIMILARITY_MATRIX, SAMPLE_HEADERS, save_path
        )

        # Verify file was created
        assert save_path.exists()

        # Verify content
        loaded_df = pd.read_csv(save_path, index_col=0)

        assert list(loaded_df.index) == SAMPLE_HEADERS
        assert list(loaded_df.columns) == SAMPLE_HEADERS
        np.testing.assert_array_almost_equal(loaded_df.values, SAMPLE_SIMILARITY_MATRIX)

    def test_save_similarity_matrix_creates_directory(self, processor, temp_dir):
        """Test that save method creates parent directories."""
        save_path = temp_dir / "subdir" / "nested" / "similarity.csv"

        processor._save_similarity_matrix(
            SAMPLE_SIMILARITY_MATRIX, SAMPLE_HEADERS, save_path
        )

        assert save_path.exists()
        assert save_path.parent.exists()


class TestGenerateMetadata:
    """Test _generate_metadata method."""

    @patch("src.protspace.data.uniprot_query_processor.ProteinFeatureExtractor")
    def test_generate_metadata_with_feature_extractor(
        self, mock_feature_extractor, processor, temp_dir
    ):
        """Test metadata generation using ProteinFeatureExtractor."""
        # Setup mock
        mock_extractor_instance = Mock()
        mock_extractor_instance.to_pd.return_value = SAMPLE_METADATA_DF
        mock_feature_extractor.return_value = mock_extractor_instance

        # Execute
        result_df = processor._generate_metadata(
            headers=SAMPLE_HEADERS,
            features="length,organism",
            delimiter=",",
            metadata_save_path=temp_dir / "metadata.csv",
            non_binary=False,
            keep_tmp=True,
        )

        # Verify
        assert isinstance(result_df, pd.DataFrame)
        # The actual method converts data to strings, so we need to account for that
        expected_df = SAMPLE_METADATA_DF.copy()
        for col in expected_df.columns:
            if col != "identifier":
                expected_df[col] = expected_df[col].astype(str)
        pd.testing.assert_frame_equal(result_df, expected_df)

        # Verify ProteinFeatureExtractor call
        mock_feature_extractor.assert_called_once()
        call_kwargs = mock_feature_extractor.call_args[1]
        assert call_kwargs["headers"] == SAMPLE_HEADERS
        assert call_kwargs["features"] == ["length", "organism"]
        assert call_kwargs["output_path"] == temp_dir / "metadata.csv"
        assert call_kwargs["non_binary"] == False

    def test_generate_metadata_from_csv(self, processor, temp_dir):
        """Test metadata generation from existing CSV file."""
        # Create CSV file
        csv_path = temp_dir / "metadata.csv"
        SAMPLE_METADATA_DF.to_csv(csv_path, index=False)

        # Execute
        result_df = processor._generate_metadata(
            headers=SAMPLE_HEADERS,
            features=str(csv_path),
            delimiter=",",
            metadata_save_path=None,
            non_binary=False,
            keep_tmp=False,
        )

        # Verify
        assert isinstance(result_df, pd.DataFrame)
        assert len(result_df) == 3
        assert list(result_df["identifier"]) == SAMPLE_HEADERS

    @patch("src.protspace.data.uniprot_query_processor.ProteinFeatureExtractor")
    def test_generate_metadata_error_handling(self, mock_feature_extractor, processor):
        """Test error handling in metadata generation."""
        # Setup mock to raise exception
        mock_feature_extractor.side_effect = Exception("Feature extraction failed")

        # Execute
        result_df = processor._generate_metadata(
            headers=SAMPLE_HEADERS,
            features="length,organism",
            delimiter=",",
            metadata_save_path=None,
            non_binary=False,
            keep_tmp=False,
        )

        # Verify fallback behavior
        assert isinstance(result_df, pd.DataFrame)
        assert list(result_df.columns) == ["identifier"]
        assert len(result_df) == 3
        assert list(result_df["identifier"]) == SAMPLE_HEADERS

    def test_generate_metadata_merging_behavior(self, processor):
        """Test metadata merging with missing entries."""
        # Create metadata with only partial entries
        partial_metadata = pd.DataFrame(
            {"identifier": ["P01308", "P01316"], "length": [110, 142]}  # Missing P01315
        )

        with patch("pandas.read_csv", return_value=partial_metadata):
            result_df = processor._generate_metadata(
                headers=SAMPLE_HEADERS,
                features="dummy.csv",
                delimiter=",",
                metadata_save_path=None,
                non_binary=False,
                keep_tmp=False,
            )

        # Verify
        assert len(result_df) == 3
        assert list(result_df["identifier"]) == SAMPLE_HEADERS

        # Check that missing entries are filled with NaN
        assert pd.isna(
            result_df.loc[result_df["identifier"] == "P01315", "length"].iloc[0]
        )


class TestIntegration:
    """Integration tests for complete workflows."""

    @patch("src.protspace.data.uniprot_query_processor.ProteinFeatureExtractor")
    @patch("src.protspace.data.uniprot_query_processor.easy_search")
    @patch("src.protspace.data.uniprot_query_processor.requests.get")
    @patch("src.protspace.data.uniprot_query_processor.gzip.open")
    @patch("src.protspace.data.uniprot_query_processor.tempfile.NamedTemporaryFile")
    def test_full_workflow_integration(
        self,
        mock_tempfile,
        mock_gzip_open,
        mock_requests_get,
        mock_easy_search,
        mock_feature_extractor,
        processor,
        temp_dir,
        mock_response,
        mock_pymmseqs_df,
    ):
        """Test complete workflow from query to final output."""
        # Setup all mocks
        temp_gz_path = temp_dir / "temp.fasta.gz"
        mock_temp_file = Mock()
        mock_temp_file.name = str(temp_gz_path)
        mock_tempfile.return_value = mock_temp_file

        compressed_content = gzip.compress(SAMPLE_FASTA_CONTENT.encode())
        mock_response.iter_content.return_value = [compressed_content]
        mock_requests_get.return_value = mock_response

        mock_gzip_open.return_value.__enter__.return_value.read.return_value = (
            SAMPLE_FASTA_CONTENT
        )

        mock_mmseqs_result = Mock()
        mock_mmseqs_result.to_pandas.return_value = mock_pymmseqs_df
        mock_easy_search.return_value = mock_mmseqs_result

        mock_extractor_instance = Mock()
        mock_extractor_instance.to_pd.return_value = SAMPLE_METADATA_DF
        mock_feature_extractor.return_value = mock_extractor_instance

        # Execute full workflow
        with patch("builtins.open", mock_open()):
            with patch("src.protspace.data.uniprot_query_processor.shutil.rmtree"):
                with patch.object(
                    processor,
                    "_extract_identifiers_from_fasta",
                    return_value=SAMPLE_HEADERS,
                ):
                    output_path = temp_dir / "output"
                    result = processor.process_query(
                        query=SAMPLE_QUERY,
                        output_path=output_path,
                        features="length,organism",
                        keep_tmp=True,
                        non_binary=False,
                    )

        # Verify complete result
        metadata_df, similarity_matrix, headers, saved_files = result

        assert isinstance(metadata_df, pd.DataFrame)
        assert len(metadata_df) == 3
        assert isinstance(similarity_matrix, np.ndarray)
        assert similarity_matrix.shape == (3, 3)
        assert headers == SAMPLE_HEADERS
        assert len(saved_files) == 3  # fasta, metadata, similarity_matrix


@pytest.mark.parametrize(
    "non_binary,expected_extension", [(True, "csv"), (False, "parquet")]
)
def test_metadata_file_extension(non_binary, expected_extension, processor, temp_dir):
    """Test that metadata file extension depends on non_binary flag."""
    with patch(
        "src.protspace.data.uniprot_query_processor.ProteinFeatureExtractor"
    ) as mock_fe:
        with patch.object(processor, "_search_and_download_fasta") as mock_search:
            with patch.object(processor, "_get_similarity_matrix") as mock_sim:

                # Setup mocks
                fasta_path = temp_dir / "temp.fasta"
                mock_search.return_value = (SAMPLE_HEADERS, fasta_path)
                mock_sim.return_value = (SAMPLE_SIMILARITY_MATRIX, SAMPLE_HEADERS)

                mock_extractor_instance = Mock()
                mock_extractor_instance.to_pd.return_value = SAMPLE_METADATA_DF
                mock_fe.return_value = mock_extractor_instance

                # Execute
                output_path = temp_dir / "output"
                processor.process_query(
                    query=SAMPLE_QUERY,
                    output_path=output_path,
                    keep_tmp=True,
                    non_binary=non_binary,
                )

                # Verify correct file extension was used
                call_kwargs = mock_fe.call_args[1]
                assert call_kwargs["non_binary"] == non_binary
                expected_path = output_path / f"all_features.{expected_extension}"
                assert call_kwargs["output_path"] == expected_path


class TestErrorScenarios:
    """Test various error scenarios and edge cases."""

    def test_empty_query_string(self, processor, temp_dir):
        """Test behavior with empty query string."""
        with patch.object(processor, "_search_and_download_fasta") as mock_search:
            mock_search.return_value = ([], None)

            output_path = temp_dir / "output.json"

            with pytest.raises(ValueError, match="No sequences found for query"):
                processor.process_query(query="", output_path=output_path)

    @patch("src.protspace.data.uniprot_query_processor.easy_search")
    def test_pymmseqs_failure(self, mock_easy_search, processor, temp_dir):
        """Test handling of pymmseqs failures."""
        mock_easy_search.side_effect = Exception("MMseqs2 failed")

        fasta_path = temp_dir / "sequences.fasta"
        fasta_path.write_text(SAMPLE_FASTA_CONTENT)

        with pytest.raises(Exception, match="MMseqs2 failed"):
            processor._get_similarity_matrix(fasta_path, SAMPLE_HEADERS)

    def test_malformed_fasta_headers(self, processor, temp_dir):
        """Test handling of malformed FASTA headers."""
        malformed_fasta = """>malformed_header_without_pipes
SEQUENCE1
>another|incomplete
SEQUENCE2
"""

        gz_path = temp_dir / "malformed.fasta.gz"
        with gzip.open(gz_path, "wt") as f:
            f.write(malformed_fasta)

        identifiers = processor._extract_identifiers_from_fasta(str(gz_path))

        # First header has no pipes, so uses first word after >
        # Second header has pipes, so uses second part (parts[1])
        assert identifiers == ["malformed_header_without_pipes", "incomplete"]
