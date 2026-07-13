"""Round-trip tests for replacing the annotations part of a bundle."""

import io

import pyarrow as pa
import pyarrow.parquet as pq
import pytest

from protspace.data.io.bundle import (
    PARQUET_BUNDLE_DELIMITER,
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


def test_projection_parts_preserved_byte_for_byte(tmp_path):
    src = tmp_path / "in.parquetbundle"
    out = tmp_path / "out.parquetbundle"
    write_bundle(_tables(), src, settings={"foo": 1})

    new_annotations = pa.table(
        {"identifier": ["A", "B"], "cat": ["x", "y"], "cat__pred_value": [None, "z"]}
    )
    replace_annotations_in_bundle(src, out, new_annotations)

    in_parts = src.read_bytes().split(PARQUET_BUNDLE_DELIMITER)
    out_parts = out.read_bytes().split(PARQUET_BUNDLE_DELIMITER)
    assert out_parts[1] == in_parts[1]  # projections_metadata, byte-identical
    assert out_parts[2] == in_parts[2]  # projections_data, byte-identical
    assert out_parts[3] == in_parts[3]  # settings, byte-identical


def test_delimiter_in_annotation_cell_raises(tmp_path):
    # If an annotation value contains the bundle delimiter, the written part
    # would corrupt the split on read-back; this must fail loudly instead.
    src = tmp_path / "in.parquetbundle"
    out = tmp_path / "out.parquetbundle"
    write_bundle(_tables(), src)

    evil = "ev" + PARQUET_BUNDLE_DELIMITER.decode() + "il"
    bad = pa.table({"identifier": ["A", "B"], "cat": ["x", evil]})
    with pytest.raises(ValueError):
        replace_annotations_in_bundle(src, out, bad)


def test_in_place_overwrite_works_and_leaves_no_temp(tmp_path):
    # The documented -b == -o workflow must produce the augmented bundle and
    # leave no stray temp file behind.
    path = tmp_path / "b.parquetbundle"
    write_bundle(_tables(), path)
    new_annotations = pa.table(
        {"identifier": ["A", "B"], "cat": ["x", "y"], "cat__pred_value": [None, "z"]}
    )
    replace_annotations_in_bundle(path, path, new_annotations)  # same path
    parts, _ = read_bundle(path)
    assert "cat__pred_value" in pq.read_table(io.BytesIO(parts[0])).column_names
    assert not list(tmp_path.glob("*.tmp"))


def test_failed_replace_preserves_original_in_place(tmp_path, monkeypatch):
    # If the rename is interrupted, the original bundle must survive intact
    # (atomic write) rather than being left truncated.
    import protspace.data.io.bundle as bundle_mod

    path = tmp_path / "b.parquetbundle"
    write_bundle(_tables(), path)
    original = path.read_bytes()
    new_annotations = pa.table(
        {"identifier": ["A", "B"], "cat": ["x", "y"], "cat__pred_value": [None, "z"]}
    )

    def boom(*args, **kwargs):
        raise OSError("simulated interrupt before rename")

    monkeypatch.setattr(bundle_mod.os, "replace", boom)
    with pytest.raises(OSError):
        replace_annotations_in_bundle(path, path, new_annotations)
    assert path.read_bytes() == original  # untouched
    assert not list(tmp_path.glob("*.tmp"))  # temp cleaned up


def test_preserves_settings_when_present(tmp_path):
    src = tmp_path / "in.parquetbundle"
    out = tmp_path / "out.parquetbundle"
    write_bundle(_tables(), src, settings={"foo": 1})

    new_annotations = pa.table({"identifier": ["A", "B"], "cat": ["x", "y"]})
    replace_annotations_in_bundle(src, out, new_annotations)

    _parts, settings = read_bundle(out)
    assert settings == {"foo": 1}


def test_preserves_statistics_part_when_present(tmp_path):
    # A statistics-bearing (5-part) bundle must round-trip: replacing annotations
    # keeps both the settings and the statistics parts intact.
    from protspace.data.io.bundle import read_statistics_from_bundle

    src = tmp_path / "in.parquetbundle"
    out = tmp_path / "out.parquetbundle"
    stats = pa.table({"metric": ["silhouette"], "value": [0.7]})
    write_bundle(_tables(), src, settings={"foo": 1}, statistics=stats)

    new_annotations = pa.table(
        {"identifier": ["A", "B"], "cat": ["x", "y"], "cat__pred_value": [None, "z"]}
    )
    replace_annotations_in_bundle(src, out, new_annotations)

    parts, settings = read_bundle(out)
    assert "cat__pred_value" in _read_part(parts[0]).column_names
    assert settings == {"foo": 1}
    stats_bytes = read_statistics_from_bundle(out)
    assert stats_bytes is not None
    assert _read_part(stats_bytes).to_pydict()["metric"] == ["silhouette"]


def test_preserves_statistics_with_zero_byte_settings_slot(tmp_path):
    # Statistics without settings uses a zero-byte settings slot; replacing
    # annotations must keep the sentinel so statistics stay at position five.
    from protspace.data.io.bundle import read_statistics_from_bundle

    src = tmp_path / "in.parquetbundle"
    out = tmp_path / "out.parquetbundle"
    stats = pa.table({"metric": ["silhouette"], "value": [0.7]})
    write_bundle(_tables(), src, statistics=stats)

    new_annotations = pa.table({"identifier": ["A", "B"], "cat": ["x", "y"]})
    replace_annotations_in_bundle(src, out, new_annotations)

    _parts, settings = read_bundle(out)
    assert settings is None  # zero-byte settings slot preserved
    stats_bytes = read_statistics_from_bundle(out)
    assert stats_bytes is not None
    assert _read_part(stats_bytes).to_pydict()["metric"] == ["silhouette"]
