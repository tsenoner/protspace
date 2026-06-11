"""Round-trip tests for replacing the annotations part of a bundle."""

import io

import pyarrow as pa
import pyarrow.parquet as pq

from protspace.data.io.bundle import (
    read_bundle,
    replace_annotations_in_bundle,
    write_bundle,
)


def _tables():
    annotations = pa.table({"identifier": ["A", "B"], "cat": ["x", "y"]})
    proj_meta = pa.table({"name": ["PCA 2"], "dims": [2]})
    proj_data = pa.table({"id": ["A", "B"], "x": [0.0, 1.0], "y": [0.0, 1.0]})
    return [annotations, proj_meta, proj_data]


def _read_part(part_bytes):
    return pq.read_table(io.BytesIO(part_bytes))


def test_replaces_annotations_keeps_other_parts(tmp_path):
    src = tmp_path / "in.parquetbundle"
    out = tmp_path / "out.parquetbundle"
    write_bundle(_tables(), src)

    new_annotations = pa.table(
        {"identifier": ["A", "B"], "cat": ["x", "y"], "cat__pred_value": [None, "z"]}
    )
    replace_annotations_in_bundle(src, out, new_annotations)

    parts, settings = read_bundle(out)
    assert "cat__pred_value" in _read_part(parts[0]).column_names
    # Projections preserved byte-for-byte.
    assert _read_part(parts[1]).column_names == ["name", "dims"]
    assert _read_part(parts[2]).to_pydict()["x"] == [0.0, 1.0]


def test_preserves_settings_when_present(tmp_path):
    src = tmp_path / "in.parquetbundle"
    out = tmp_path / "out.parquetbundle"
    write_bundle(_tables(), src, settings={"foo": 1})

    new_annotations = pa.table({"identifier": ["A", "B"], "cat": ["x", "y"]})
    replace_annotations_in_bundle(src, out, new_annotations)

    _parts, settings = read_bundle(out)
    assert settings == {"foo": 1}
