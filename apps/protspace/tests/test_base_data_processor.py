import numpy as np
import pandas as pd
import pyarrow as pa
import pyarrow.parquet as pq
import pytest

from protspace.data.processors.base_processor import BaseProcessor

# Use new name
BaseDataProcessor = BaseProcessor  # For test compatibility

# Sample data for tests
SAMPLE_CONFIG = {"n_neighbors": 5, "custom_names": {"pca2": "CustomPCA"}}
SAMPLE_HEADERS = ["P1", "P2", "P3"]
SAMPLE_DATA = np.array([[1.0, 0.5], [0.5, 1.0], [0.2, 0.8]])
SAMPLE_METADATA = pd.DataFrame(
    {
        "identifier": SAMPLE_HEADERS,
        "length": ["100", "200", "300"],
        "organism": ["A", "B", "C"],
    }
)
SAMPLE_REDUCED = np.array([[0.1, 0.2], [0.3, 0.4], [0.5, 0.6]])
SAMPLE_REDUCTIONS = [
    {
        "name": "PCA_2",
        "dimensions": 2,
        "info": {"n_components": 2},
        "data": SAMPLE_REDUCED,
    }
]


class DummyReducer:
    def __init__(self, config):
        self.config = config

    def fit_transform(self, _):
        return SAMPLE_REDUCED

    def get_params(self):
        return {"n_components": 2}


class TestProcessReduction:
    def test_process_reduction_success(self):
        reducers = {"pca": DummyReducer}
        processor = BaseDataProcessor(SAMPLE_CONFIG, reducers)
        result = processor.process_reduction(SAMPLE_DATA, "pca", 2)
        assert result["name"] == "CustomPCA"
        assert result["dimensions"] == 2
        assert result["info"] == {"n_components": 2}
        np.testing.assert_array_equal(result["data"], SAMPLE_REDUCED)

    def test_process_reduction_unknown_method(self):
        processor = BaseDataProcessor(SAMPLE_CONFIG, {})
        with pytest.raises(ValueError, match="Unknown reduction method: umap"):
            processor.process_reduction(SAMPLE_DATA, "umap", 2)

    @pytest.mark.parametrize(
        "data, expected",
        [
            # Diagonal is all 1: a similarity matrix, so d = sqrt(max(s) - s)
            (np.eye(3), np.sqrt(1 - np.eye(3))),
            # Diagonal is not 1: already a distance matrix, passed through as is
            (1 - np.eye(3), 1 - np.eye(3)),
        ],
    )
    def test_process_reduction_mds_precomputed(self, data, expected):
        # DummyReducer ignores its input, so record what MDS is actually fed.
        received = []

        class RecordingReducer(DummyReducer):
            def fit_transform(self, data):
                received.append(data)
                return super().fit_transform(data)

        processor = BaseDataProcessor({"precomputed": True}, {"mds": RecordingReducer})
        result = processor.process_reduction(data, "mds", 2)

        assert len(received) == 1
        np.testing.assert_array_equal(received[0], expected)
        np.testing.assert_array_equal(result["data"], SAMPLE_REDUCED)


class TestCreateOutput:
    def test_create_output_tables(self):
        processor = BaseDataProcessor(SAMPLE_CONFIG, {"pca": DummyReducer})
        reductions = SAMPLE_REDUCTIONS
        tables = processor.create_output(SAMPLE_METADATA, reductions, SAMPLE_HEADERS)
        assert set(tables.keys()) == {
            "protein_annotations",
            "projections_metadata",
            "projections_data",
        }
        assert isinstance(tables["protein_annotations"], pa.Table)
        assert isinstance(tables["projections_metadata"], pa.Table)
        assert isinstance(tables["projections_data"], pa.Table)

    def test_create_output_removes_internal_columns(self):
        """Test that internal columns (organism_id, sequence) are removed from output."""
        processor = BaseDataProcessor(SAMPLE_CONFIG, {"pca": DummyReducer})

        # Create metadata with internal columns
        metadata_with_internal = pd.DataFrame(
            {
                "identifier": SAMPLE_HEADERS,
                "reviewed": ["Swiss-Prot", "Swiss-Prot", "TrEMBL"],
                "organism_id": ["9606", "9606", "10090"],
                "length": ["100", "200", "300"],
                "sequence": ["MVLSPADKTN", "MVLSGEDKSN", "MVLSAADKGN"],
            }
        )

        tables = processor.create_output(
            metadata_with_internal, SAMPLE_REDUCTIONS, SAMPLE_HEADERS
        )

        # Convert Arrow table to pandas for easier assertion
        annotations_df = tables["protein_annotations"].to_pandas()

        # Internal columns should be removed
        assert "organism_id" not in annotations_df.columns
        assert "sequence" not in annotations_df.columns

        # length is now a user-facing annotation and should remain
        assert "length" in annotations_df.columns
        assert "reviewed" in annotations_df.columns


class TestSaveOutput:
    def test_save_output_separate_files(self, tmp_path):
        processor = BaseDataProcessor(SAMPLE_CONFIG, {"pca": DummyReducer})
        tables = processor.create_output(
            SAMPLE_METADATA, SAMPLE_REDUCTIONS, SAMPLE_HEADERS
        )
        out = tmp_path / "output_dir"
        processor.save_output(tables, out, bundled=False)

        expected = {
            "selected_annotations.parquet": tables["protein_annotations"],
            "projections_metadata.parquet": tables["projections_metadata"],
            "projections_data.parquet": tables["projections_data"],
        }
        assert {p.name for p in out.iterdir()} == set(expected)
        for filename, table in expected.items():
            assert pq.read_table(out / filename).equals(table)

    def test_save_output_separate_files_writes_settings(self, tmp_path):
        """Unbundled output must persist `settings` (e.g. auto cluster legend), not
        silently drop it the way the bundled path preserves it as the 4th part."""
        from protspace.data.io.bundle import read_settings_from_file

        processor = BaseDataProcessor(SAMPLE_CONFIG, {"pca": DummyReducer})
        tables = processor.create_output(
            SAMPLE_METADATA, SAMPLE_REDUCTIONS, SAMPLE_HEADERS
        )
        settings = {"cluster_PCA_2": {"selectedPaletteId": "kellys", "categories": {}}}
        out = tmp_path / "out"
        processor.save_output(tables, out, bundled=False, settings=settings)

        assert (out / "settings.parquet").exists()
        assert read_settings_from_file(out / "settings.parquet") == settings

    def test_save_output_bundled(self, tmp_path):
        from protspace.data.io.bundle import read_bundle

        processor = BaseDataProcessor(SAMPLE_CONFIG, {"pca": DummyReducer})
        tables = processor.create_output(
            SAMPLE_METADATA, SAMPLE_REDUCTIONS, SAMPLE_HEADERS
        )
        out_dir = tmp_path / "output_dir"
        processor.save_output(tables, out_dir, bundled=True)

        bundle_path = out_dir / "data.parquetbundle"
        assert bundle_path.exists()
        parts, _settings = read_bundle(bundle_path)
        assert len(parts) == 3
