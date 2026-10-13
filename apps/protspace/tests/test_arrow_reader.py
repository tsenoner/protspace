"""ArrowReader rejects a path that cannot yield any ProtSpace table.

Every probe in ``_load_data`` falls back to an empty frame when its file is
missing, so without the up-front check a bad path read as an empty dataset.
"""

import pyarrow as pa
import pyarrow.parquet as pq
import pytest

from protspace.utils.arrow_reader import ArrowReader


def test_bundle_file_points_at_extract_bundle_to_dir(tmp_path):
    bundle = tmp_path / "data.parquetbundle"
    bundle.write_bytes(b"")
    with pytest.raises(ValueError, match="extract_bundle_to_dir"):
        ArrowReader(bundle)


def test_other_file_is_rejected(tmp_path):
    other = tmp_path / "selected_annotations.parquet"
    pq.write_table(pa.table({"protein_id": ["P1"]}), other)
    with pytest.raises(ValueError, match="expects a directory of .parquet files.$"):
        ArrowReader(other)


def test_missing_directory_is_not_found(tmp_path):
    with pytest.raises(FileNotFoundError):
        ArrowReader(tmp_path / "missing")


def test_directory_without_core_tables_is_rejected(tmp_path):
    pq.write_table(pa.table({"x": [1]}), tmp_path / "statistics.parquet")
    with pytest.raises(ValueError, match="contains none of"):
        ArrowReader(tmp_path)


def test_annotations_only_directory_still_loads(tmp_path):
    pq.write_table(
        pa.table({"protein_id": ["P1", "P2"], "cath": ["a", "b"]}),
        tmp_path / "selected_annotations.parquet",
    )
    reader = ArrowReader(tmp_path)
    assert sorted(reader.get_protein_ids()) == ["P1", "P2"]
    assert reader.get_projection_names() == []
