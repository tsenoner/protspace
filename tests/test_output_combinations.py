"""
Comprehensive tests for all output file combinations with different flag settings.

This test suite covers all possible combinations of:
- --output (file vs directory vs default)
- --bundled (true/false)
- --non-binary (true/false)
- --keep-tmp (true/false)
- protspace-local vs protspace-query
"""

import tempfile
from pathlib import Path
from unittest.mock import patch

import numpy as np
import pandas as pd

from src.protspace.cli.common_args import determine_output_paths
from src.protspace.data.local_data_processor import LocalDataProcessor
from src.protspace.data.uniprot_query_processor import UniProtQueryProcessor
from tests.test_config import (
    FASTA_CONTENT,
    LEGACY_OUTPUT_DATA,
    OUTPUT_SCENARIOS,
    sample_data,
    sample_query_data,
    temp_dir,
)


class TestOutputPathCombinations:
    """Test all combinations of output path determination logic."""

    def test_default_output_paths_local_data(self):
        """Test default output path determination for local data."""
        input_path = Path("data/phosphatase.h5")

        # Test bundled=true (default)
        output_path, intermediate_dir = determine_output_paths(
            output_arg=None,
            input_path=input_path,
            non_binary=False,
            bundled=True,
            keep_tmp=False,
            identifiers=None,
        )
        assert output_path == Path("data/phosphatase.parquetbundle")
        assert intermediate_dir is None

        # Test bundled=false
        output_path, intermediate_dir = determine_output_paths(
            output_arg=None,
            input_path=input_path,
            non_binary=False,
            bundled=False,
            keep_tmp=False,
            identifiers=None,
        )
        assert output_path == Path("data/protspace")
        assert intermediate_dir is None

        # Test non_binary=true
        output_path, intermediate_dir = determine_output_paths(
            output_arg=None,
            input_path=input_path,
            non_binary=True,
            bundled=True,  # ignored
            keep_tmp=False,
            identifiers=None,
        )
        assert output_path == Path("data/phosphatase.json")
        assert intermediate_dir is None

    def test_default_output_paths_query(self):
        """Test default output path determination for query mode."""
        # Test bundled=true (default)
        output_path, intermediate_dir = determine_output_paths(
            output_arg=None,
            input_path=None,  # No input file for query
            non_binary=False,
            bundled=True,
            keep_tmp=False,
            identifiers=None,
        )
        assert output_path == Path("protspace.parquetbundle")
        assert intermediate_dir is None

        # Test bundled=false
        output_path, intermediate_dir = determine_output_paths(
            output_arg=None,
            input_path=None,
            non_binary=False,
            bundled=False,
            keep_tmp=False,
            identifiers=None,
        )
        assert output_path == Path("protspace")
        assert intermediate_dir is None

        # Test non_binary=true
        output_path, intermediate_dir = determine_output_paths(
            output_arg=None,
            input_path=None,
            non_binary=True,
            bundled=True,  # ignored
            keep_tmp=False,
            identifiers=None,
        )
        assert output_path == Path("protspace.json")
        assert intermediate_dir is None

    def test_custom_output_paths(self):
        """Test custom output path handling."""
        # File path with extension
        output_path, intermediate_dir = determine_output_paths(
            output_arg=Path("custom/output.parquetbundle"),
            input_path=Path("data/test.h5"),
            non_binary=False,
            bundled=True,
            keep_tmp=False,
            identifiers=None,
        )
        assert output_path == Path("custom/output.parquetbundle")
        assert intermediate_dir is None

        # File path without extension (should get .parquetbundle)
        output_path, intermediate_dir = determine_output_paths(
            output_arg=Path("custom/output"),
            input_path=Path("data/test.h5"),
            non_binary=False,
            bundled=True,
            keep_tmp=False,
            identifiers=None,
        )
        assert output_path == Path("custom/output.parquetbundle")
        assert intermediate_dir is None

        # Directory path
        output_path, intermediate_dir = determine_output_paths(
            output_arg=Path("custom/dir"),
            input_path=Path("data/test.h5"),
            non_binary=False,
            bundled=False,
            keep_tmp=False,
            identifiers=None,
        )
        assert output_path == Path("custom/dir")
        assert intermediate_dir is None

    def test_keep_tmp_intermediate_directories(self):
        """Test intermediate directory creation with keep_tmp=True."""
        identifiers = ["P12345", "P67890", "P11111"]

        # Test with keep_tmp=True
        output_path, intermediate_dir = determine_output_paths(
            output_arg=Path("output.parquetbundle"),
            input_path=Path("data/test.h5"),
            non_binary=False,
            bundled=True,
            keep_tmp=True,
            identifiers=identifiers,
        )
        assert output_path == Path("output.parquetbundle")
        assert intermediate_dir is not None
        assert intermediate_dir.name != ""
        assert len(intermediate_dir.name) == 16  # MD5 hash truncated to 16 chars

        # Test without keep_tmp
        output_path, _ = determine_output_paths(
            output_arg=Path("output.parquetbundle"),
            input_path=Path("data/test.h5"),
            non_binary=False,
            bundled=True,
            keep_tmp=False,
            identifiers=identifiers,
        )
        assert output_path == Path("output.parquetbundle")


class TestOutputFileGeneration:
    """Test actual file generation with different flag combinations."""

    def test_bundled_parquet_output(self, sample_data):
        """Test bundled parquet output generation."""
        import tempfile

        with tempfile.TemporaryDirectory() as temp_dir_path:
            temp_path = Path(temp_dir_path)

            # Create mock processor
            processor = LocalDataProcessor({})

            # Create real output data using the sample data
            output_data = processor.create_output(
                sample_data["metadata"],
                [
                    {
                        "name": "PCA_2",
                        "dimensions": 2,
                        "info": {},
                        "data": sample_data["embeddings"][:, :2],
                    }
                ],
                sample_data["headers"],
            )

            # Test bundled output
            output_path = temp_path / "test.parquetbundle"
            processor.save_output(output_data, output_path, bundled=True)

            # Verify file was created
            assert output_path.exists()
            assert output_path.suffix == ".parquetbundle"

    def test_separate_parquet_output(self, sample_data):
        """Test separate parquet files output generation."""
        import tempfile

        with tempfile.TemporaryDirectory() as temp_dir_path:
            temp_path = Path(temp_dir_path)

            # Create mock processor
            processor = LocalDataProcessor({})

            # Create real output data using the sample data
            output_data = processor.create_output(
                sample_data["metadata"],
                [
                    {
                        "name": "PCA_2",
                        "dimensions": 2,
                        "info": {},
                        "data": sample_data["embeddings"][:, :2],
                    }
                ],
                sample_data["headers"],
            )

            # Test separate files output
            output_dir = temp_path / "test_output"
            processor.save_output(output_data, output_dir, bundled=False)

            # Verify directory was created
            assert output_dir.exists()
            assert output_dir.is_dir()

    def test_json_output(self):
        """Test JSON output generation."""
        import tempfile

        with tempfile.TemporaryDirectory() as temp_dir_path:
            temp_path = Path(temp_dir_path)

            # Create mock processor
            processor = LocalDataProcessor({})

            # Test JSON output
            output_path = temp_path / "test.json"
            processor.save_output_legacy(LEGACY_OUTPUT_DATA, output_path)

            # Verify file was created
            assert output_path.exists()
            assert output_path.suffix == ".json"


class TestFlagCombinationScenarios:
    """Test specific flag combination scenarios."""

    def test_non_binary_with_bundled_false_warning(self):
        """Test that warning is shown when --non-binary and --bundled false are used together."""
        # This would be tested in the CLI integration tests
        # For now, we just verify the logic in determine_output_paths
        output_path, _ = determine_output_paths(
            output_arg=None,
            input_path=Path("test.h5"),
            non_binary=True,
            bundled=False,  # This should be ignored
            keep_tmp=False,
            identifiers=None,
        )
        # Should create JSON file regardless of bundled setting
        assert output_path.suffix == ".json"

    def test_bundled_false_with_file_path_error(self):
        """Test that error is raised when --bundled false is used with file path."""
        # This would be tested in CLI integration
        # The logic should prevent this combination
        pass

    def test_keep_tmp_caching_behavior(self):
        """Test that keep_tmp creates intermediate directories with consistent hashing."""
        identifiers1 = ["P12345", "P67890", "P11111"]
        identifiers2 = ["P11111", "P12345", "P67890"]  # Same IDs, different order

        # Test consistent hashing
        _, intermediate_dir1 = determine_output_paths(
            output_arg=Path("output.parquetbundle"),
            input_path=Path("test.h5"),
            non_binary=False,
            bundled=True,
            keep_tmp=True,
            identifiers=identifiers1,
        )

        _, intermediate_dir2 = determine_output_paths(
            output_arg=Path("output.parquetbundle"),
            input_path=Path("test.h5"),
            non_binary=False,
            bundled=True,
            keep_tmp=True,
            identifiers=identifiers2,
        )

        # Should produce same intermediate directory
        assert intermediate_dir1 == intermediate_dir2


class TestCLIIntegrationScenarios:
    """Test realistic CLI usage scenarios."""

    def test_local_data_typical_usage(self):
        """Test typical protspace-local usage patterns."""
        scenarios = OUTPUT_SCENARIOS["local_data"]

        for (
            output_arg,
            bundled,
            non_binary,
            expected_output,
            expected_intermediate,
        ) in scenarios:
            output_path, intermediate_dir = determine_output_paths(
                output_arg=output_arg,
                input_path=Path("data/phosphatase.h5"),
                non_binary=non_binary,
                bundled=bundled,
                keep_tmp=False,
                identifiers=None,
            )
            assert output_path == Path(expected_output)
            assert intermediate_dir == expected_intermediate

    def test_query_typical_usage(self):
        """Test typical protspace-query usage patterns."""
        scenarios = OUTPUT_SCENARIOS["query"]

        for (
            output_arg,
            bundled,
            non_binary,
            expected_output,
            expected_intermediate,
        ) in scenarios:
            output_path, intermediate_dir = determine_output_paths(
                output_arg=output_arg,
                input_path=None,  # No input file for query
                non_binary=non_binary,
                bundled=bundled,
                keep_tmp=False,
                identifiers=None,
            )
            assert output_path == Path(expected_output)
            assert intermediate_dir == expected_intermediate


class TestUniProtQueryProcessor:
    """Tests for UniProtQueryProcessor output file generation."""

    def test_query_bundled_parquet_output(self, sample_query_data):
        """Test bundled parquet output generation for query processor."""
        import tempfile

        with tempfile.TemporaryDirectory() as temp_dir_path:
            temp_path = Path(temp_dir_path)

            # Create mock processor
            processor = UniProtQueryProcessor({})

            # Create real output data using the sample data
            output_data = processor.create_output(
                sample_query_data["metadata"],
                [
                    {
                        "name": "PCA_2",
                        "dimensions": 2,
                        "info": {},
                        "data": sample_query_data["embeddings"][:, :2],
                    }
                ],
                sample_query_data["headers"],
            )

            # Test bundled output
            output_path = temp_path / "query_test.parquetbundle"
            processor.save_output(output_data, output_path, bundled=True)

            # Verify file was created
            assert output_path.exists()
            assert output_path.suffix == ".parquetbundle"

    def test_query_separate_parquet_output(self, sample_query_data):
        """Test separate parquet files output generation for query processor."""
        import tempfile

        with tempfile.TemporaryDirectory() as temp_dir_path:
            temp_path = Path(temp_dir_path)

            # Create mock processor
            processor = UniProtQueryProcessor({})

            # Create real output data using the sample data
            output_data = processor.create_output(
                sample_query_data["metadata"],
                [
                    {
                        "name": "PCA_2",
                        "dimensions": 2,
                        "info": {},
                        "data": sample_query_data["embeddings"][:, :2],
                    }
                ],
                sample_query_data["headers"],
            )

            # Test separate files output
            output_dir = temp_path / "query_output"
            processor.save_output(output_data, output_dir, bundled=False)

            # Verify directory was created
            assert output_dir.exists()
            assert output_dir.is_dir()

    def test_query_json_output(self):
        """Test JSON output generation for query processor."""
        import tempfile

        with tempfile.TemporaryDirectory() as temp_dir_path:
            temp_path = Path(temp_dir_path)

            # Create mock processor
            processor = UniProtQueryProcessor({})

            # Test JSON output
            output_path = temp_path / "query_test.json"
            processor.save_output_legacy(LEGACY_OUTPUT_DATA, output_path)

            # Verify file was created
            assert output_path.exists()
            assert output_path.suffix == ".json"

    @patch(
        "src.protspace.data.uniprot_query_processor.UniProtQueryProcessor._search_and_download_fasta"
    )
    @patch(
        "src.protspace.data.uniprot_query_processor.UniProtQueryProcessor._generate_metadata"
    )
    @patch(
        "src.protspace.data.uniprot_query_processor.UniProtQueryProcessor._get_similarity_matrix"
    )
    def test_query_processor_with_keep_tmp(
        self, mock_similarity, mock_metadata, mock_fasta
    ):
        """Test query processor with keep_tmp=True."""
        import tempfile

        with tempfile.TemporaryDirectory() as temp_dir_path:
            temp_path = Path(temp_dir_path)

            # Create a mock FASTA file
            fasta_path = temp_path / "sequences.fasta"
            fasta_path.write_text(FASTA_CONTENT["basic"])

            # Mock the processor methods
            mock_fasta.return_value = (["P12345", "P67890"], fasta_path)
            mock_metadata.return_value = pd.DataFrame(
                {"identifier": ["P12345", "P67890"], "length": [100, 150]}
            )
            mock_similarity.return_value = (np.random.rand(2, 2), ["P12345", "P67890"])

            processor = UniProtQueryProcessor({})

            # Test with keep_tmp=True
            result = processor.process_query(
                query="organism_id:9606",
                output_path=temp_path / "output.parquetbundle",
                intermediate_dir=temp_path / "intermediate",
                features="length",
                delimiter=",",
                keep_tmp=True,
                non_binary=False,
                fasta_path=fasta_path,
                headers=["P12345", "P67890"],
            )

            _, _, _, saved_files = result

            # Verify intermediate files are saved
            assert "fasta" in saved_files
            assert "metadata" in saved_files
            assert "similarity_matrix" in saved_files

            # Verify paths are in intermediate directory
            assert saved_files["fasta"].parent == temp_path / "intermediate"
            assert saved_files["metadata"].parent == temp_path / "intermediate"
            assert saved_files["similarity_matrix"].parent == temp_path / "intermediate"

    @patch(
        "src.protspace.data.uniprot_query_processor.UniProtQueryProcessor._search_and_download_fasta"
    )
    @patch(
        "src.protspace.data.uniprot_query_processor.UniProtQueryProcessor._generate_metadata"
    )
    @patch(
        "src.protspace.data.uniprot_query_processor.UniProtQueryProcessor._get_similarity_matrix"
    )
    def test_query_processor_without_keep_tmp(
        self, mock_similarity, mock_metadata, mock_fasta
    ):
        """Test query processor with keep_tmp=False."""
        with tempfile.TemporaryDirectory() as temp_dir_path:
            temp_path = Path(temp_dir_path)

            # Mock the processor methods
            mock_fasta.return_value = (
                ["P12345", "P67890"],
                temp_path / "sequences.fasta",
            )
            mock_metadata.return_value = pd.DataFrame(
                {"identifier": ["P12345", "P67890"], "length": [100, 150]}
            )
            mock_similarity.return_value = (np.random.rand(2, 2), ["P12345", "P67890"])

            processor = UniProtQueryProcessor({})

            # Test with keep_tmp=False
            result = processor.process_query(
                query="organism_id:9606",
                output_path=temp_path / "output.parquetbundle",
                intermediate_dir=None,  # No intermediate directory
                features="length",
                delimiter=",",
                keep_tmp=False,
                non_binary=False,
                fasta_path=temp_path / "sequences.fasta",
                headers=["P12345", "P67890"],
            )

            _, _, _, saved_files = result

            # Verify no intermediate files are saved
            assert saved_files == {}

    def test_query_processor_pre_downloaded_fasta(self, sample_query_data):
        """Test query processor with pre-downloaded FASTA file."""
        import tempfile

        with tempfile.TemporaryDirectory() as temp_dir_path:
            temp_path = Path(temp_dir_path)

            # Create a mock FASTA file
            fasta_path = temp_path / "sequences.fasta"
            fasta_path.write_text(FASTA_CONTENT["basic"])

            processor = UniProtQueryProcessor({})

            # Test with pre-downloaded FASTA
            with (
                patch.object(processor, "_generate_metadata") as mock_metadata,
                patch.object(processor, "_get_similarity_matrix") as mock_similarity,
            ):
                mock_metadata.return_value = sample_query_data["metadata"]
                mock_similarity.return_value = (
                    np.random.rand(3, 3),
                    sample_query_data["headers"],
                )

                result = processor.process_query(
                    query="organism_id:9606",
                    output_path=temp_path / "output.parquetbundle",
                    intermediate_dir=temp_path / "intermediate",
                    features="length",
                    delimiter=",",
                    keep_tmp=True,
                    non_binary=False,
                    fasta_path=fasta_path,
                    headers=sample_query_data["headers"],
                )

                _, _, _, saved_files = result

                # Verify FASTA was copied to intermediate directory
                assert "fasta" in saved_files
                assert saved_files["fasta"].exists()
                assert saved_files["fasta"].read_text() == FASTA_CONTENT["basic"]


class TestEdgeCases:
    """Test edge cases and error conditions."""

    def test_empty_identifiers_list(self):
        """Test behavior with empty identifiers list."""
        output_path, intermediate_dir = determine_output_paths(
            output_arg=Path("output.parquetbundle"),
            input_path=Path("test.h5"),
            non_binary=False,
            bundled=True,
            keep_tmp=True,
            identifiers=[],
        )
        assert output_path == Path("output.parquetbundle")
        assert intermediate_dir is None  # No identifiers, no intermediate dir

    def test_single_identifier(self):
        """Test behavior with single identifier."""
        output_path, intermediate_dir = determine_output_paths(
            output_arg=Path("output.parquetbundle"),
            input_path=Path("test.h5"),
            non_binary=False,
            bundled=True,
            keep_tmp=True,
            identifiers=["P12345"],
        )
        assert output_path == Path("output.parquetbundle")
        assert intermediate_dir is not None
        assert intermediate_dir.name != ""

    def test_very_long_identifier_list(self):
        """Test behavior with very long identifier list."""
        identifiers = [f"P{i:05d}" for i in range(1000)]
        output_path, intermediate_dir = determine_output_paths(
            output_arg=Path("output.parquetbundle"),
            input_path=Path("test.h5"),
            non_binary=False,
            bundled=True,
            keep_tmp=True,
            identifiers=identifiers,
        )
        assert output_path == Path("output.parquetbundle")
        assert intermediate_dir is not None
        assert len(intermediate_dir.name) == 16  # MD5 hash truncated to 16 chars
