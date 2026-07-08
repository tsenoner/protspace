"""Tests for Task E1: format_version=2 stamped into the annotations parquet.

Covers both production write paths:
- BaseProcessor._create_protein_annotations_table (used by `protspace prepare`,
  both bundled and separate-file output).
- The standalone `protspace bundle` subcommand, which reads a pre-existing
  annotations parquet and must stamp it before handing it to write_bundle.
"""

import io
import tempfile
from pathlib import Path

import pandas as pd
import pyarrow.parquet as pq

from protspace.data.annotations.encoding import FORMAT_VERSION_KEY
from protspace.data.io.bundle import read_bundle
from protspace.data.processors.base_processor import BaseProcessor
from tests.test_config import sample_data  # noqa: F401 (pytest fixture)


def test_create_protein_annotations_table_stamps_format_version():
    """Direct unit test of the table factory used by the prepare pipeline."""
    proc = BaseProcessor.__new__(BaseProcessor)  # bypass heavy __init__
    proc.identifier_col = "protein_id"
    tbl = proc._create_protein_annotations_table(
        pd.DataFrame({"protein_id": ["P1"], "cath": ["6.20.10.10"]})
    )

    buf = io.BytesIO()
    pq.write_table(tbl, buf)
    buf.seek(0)

    footer_meta = pq.read_metadata(buf).metadata
    assert footer_meta[FORMAT_VERSION_KEY] == b"2"


def test_prepare_pipeline_bundle_carries_format_version(sample_data):
    """End-to-end: create_output -> save_output (bundled) -> read_bundle ->
    the annotations part's parquet footer carries the stamp.
    """
    from protspace.utils import get_reducers as _get_reducers

    with tempfile.TemporaryDirectory() as tmp:
        temp_path = Path(tmp)
        processor = BaseProcessor({}, _get_reducers())

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

        bundle_path = temp_path / "test.parquetbundle"
        processor.save_output(output_data, bundle_path, bundled=True)

        core_parts, _settings = read_bundle(bundle_path)
        annotations_bytes = core_parts[0]  # protein_annotations is written first

        footer_meta = pq.read_metadata(io.BytesIO(annotations_bytes)).metadata
        assert footer_meta[FORMAT_VERSION_KEY] == b"2"


def test_cli_bundle_command_stamps_format_version(tmp_path):
    """The standalone `protspace bundle` subcommand reads a pre-existing
    annotations parquet and must stamp it before writing the bundle.
    """
    import pyarrow as pa
    from typer.testing import CliRunner

    from protspace.cli.app import app

    # Minimal projections_metadata / projections_data / annotations inputs.
    proj_dir = tmp_path / "projections"
    proj_dir.mkdir()

    metadata_df = pd.DataFrame(
        {
            "projection_name": ["PCA_2"],
            "dimensions": [2],
            "info_json": ["{}"],
            "source": [""],
        }
    )
    pq.write_table(
        pa.Table.from_pandas(metadata_df), proj_dir / "projections_metadata.parquet"
    )

    data_df = pd.DataFrame(
        {"identifier": ["P1", "P2"], "PCA_2_1": [0.1, 0.2], "PCA_2_2": [0.3, 0.4]}
    )
    pq.write_table(pa.Table.from_pandas(data_df), proj_dir / "projections_data.parquet")

    annotations_path = tmp_path / "annotations.parquet"
    annotations_df = pd.DataFrame({"identifier": ["P1", "P2"], "cath": ["a", "b"]})
    pq.write_table(pa.Table.from_pandas(annotations_df), annotations_path)

    output_path = tmp_path / "out.parquetbundle"

    runner = CliRunner()
    result = runner.invoke(
        app,
        [
            "bundle",
            "-p",
            str(proj_dir),
            "-a",
            str(annotations_path),
            "-o",
            str(output_path),
        ],
    )
    assert result.exit_code == 0, result.output

    core_parts, _settings = read_bundle(output_path)
    annotations_bytes = core_parts[0]
    footer_meta = pq.read_metadata(io.BytesIO(annotations_bytes)).metadata
    assert footer_meta[FORMAT_VERSION_KEY] == b"2"
