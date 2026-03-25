"""Tests for output file generation with BaseProcessor."""

import tempfile
from pathlib import Path

import numpy as np
import pandas as pd

from src.protspace.data.processors.base_processor import BaseProcessor
from src.protspace.utils import REDUCERS
from tests.test_config import (
    LEGACY_OUTPUT_DATA,
    sample_data,
    sample_query_data,
    temp_dir,
)


class TestOutputFileGeneration:
    """Test actual file generation with different flag combinations."""

    def test_bundled_parquet_output(self, sample_data):
        """Test bundled parquet output generation."""
        with tempfile.TemporaryDirectory() as temp_dir_path:
            temp_path = Path(temp_dir_path)
            processor = BaseProcessor({}, REDUCERS)

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

            output_path = temp_path / "test.parquetbundle"
            processor.save_output(output_data, output_path, bundled=True)

            assert output_path.exists()
            assert output_path.suffix == ".parquetbundle"

    def test_separate_parquet_output(self, sample_data):
        """Test separate parquet files output generation."""
        with tempfile.TemporaryDirectory() as temp_dir_path:
            temp_path = Path(temp_dir_path)
            processor = BaseProcessor({}, REDUCERS)

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

            output_dir = temp_path / "test_output"
            processor.save_output(output_data, output_dir, bundled=False)

            assert output_dir.exists()
            assert output_dir.is_dir()

    def test_json_output(self):
        """Test JSON output generation."""
        with tempfile.TemporaryDirectory() as temp_dir_path:
            temp_path = Path(temp_dir_path)
            processor = BaseProcessor({}, REDUCERS)

            output_path = temp_path / "test.json"
            processor.save_output_legacy(LEGACY_OUTPUT_DATA, output_path)

            assert output_path.exists()
            assert output_path.suffix == ".json"

    def test_bundled_parquet_output_query_data(self, sample_query_data):
        """Test bundled parquet output with query-style data."""
        with tempfile.TemporaryDirectory() as temp_dir_path:
            temp_path = Path(temp_dir_path)
            processor = BaseProcessor({}, REDUCERS)

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

            output_path = temp_path / "query_test.parquetbundle"
            processor.save_output(output_data, output_path, bundled=True)

            assert output_path.exists()
            assert output_path.suffix == ".parquetbundle"

    def test_separate_parquet_output_query_data(self, sample_query_data):
        """Test separate parquet files output with query-style data."""
        with tempfile.TemporaryDirectory() as temp_dir_path:
            temp_path = Path(temp_dir_path)
            processor = BaseProcessor({}, REDUCERS)

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

            output_dir = temp_path / "query_output"
            processor.save_output(output_data, output_dir, bundled=False)

            assert output_dir.exists()
            assert output_dir.is_dir()

    def test_json_output_query_data(self):
        """Test JSON output with query-style data."""
        with tempfile.TemporaryDirectory() as temp_dir_path:
            temp_path = Path(temp_dir_path)
            processor = BaseProcessor({}, REDUCERS)

            output_path = temp_path / "query_test.json"
            processor.save_output_legacy(LEGACY_OUTPUT_DATA, output_path)

            assert output_path.exists()
            assert output_path.suffix == ".json"
