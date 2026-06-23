"""Round-trip tests for the optional fifth (statistics) bundle part."""

from __future__ import annotations

import pyarrow as pa
import pyarrow.parquet as pq

from protspace.data.io.bundle import (
    PARQUET_BUNDLE_DELIMITER,
    extract_bundle_to_dir,
    read_bundle,
    read_statistics_from_bundle,
    replace_settings_in_bundle,
    write_bundle,
)


def _core() -> list[pa.Table]:
    return [
        pa.table({"protein_id": ["a", "b"]}),
        pa.table({"projection_name": ["PCA_2"]}),
        pa.table({"projection_name": ["PCA_2", "PCA_2"], "identifier": ["a", "b"]}),
    ]


def _stats() -> pa.Table:
    return pa.table({"space_name": ["PCA_2"], "metric": ["silhouette"], "value": [0.5]})


def _ndelims(path) -> int:
    return path.read_bytes().count(PARQUET_BUNDLE_DELIMITER)


def test_three_part_bundle_roundtrips(tmp_path):
    p = tmp_path / "b.parquetbundle"
    write_bundle(_core(), p)
    assert _ndelims(p) == 2
    core, settings = read_bundle(p)
    assert len(core) == 3 and settings is None
    assert read_statistics_from_bundle(p) is None


def test_four_part_settings_only(tmp_path):
    p = tmp_path / "b.parquetbundle"
    write_bundle(_core(), p, settings={"hello": "world"})
    assert _ndelims(p) == 3
    _, settings = read_bundle(p)
    assert settings == {"hello": "world"}
    assert read_statistics_from_bundle(p) is None


def test_five_part_settings_and_stats(tmp_path):
    p = tmp_path / "b.parquetbundle"
    write_bundle(_core(), p, settings={"k": 1}, statistics=_stats())
    assert _ndelims(p) == 4
    _, settings = read_bundle(p)
    assert settings == {"k": 1}
    stats_bytes = read_statistics_from_bundle(p)
    assert stats_bytes is not None
    table = pq.read_table(pa.BufferReader(stats_bytes))
    assert table.column("metric")[0].as_py() == "silhouette"


def test_five_part_stats_only_empty_settings(tmp_path):
    p = tmp_path / "b.parquetbundle"
    write_bundle(_core(), p, statistics=_stats())
    assert _ndelims(p) == 4  # zero-byte settings slot keeps stats at position 5
    core, settings = read_bundle(p)
    assert len(core) == 3 and settings is None
    assert read_statistics_from_bundle(p) is not None


def test_extract_to_dir_writes_statistics(tmp_path):
    p = tmp_path / "b.parquetbundle"
    write_bundle(_core(), p, statistics=_stats())
    out = extract_bundle_to_dir(p, tmp_path / "out")
    assert (tmp_path / "out" / "statistics.parquet").exists()
    assert not (tmp_path / "out" / "settings.parquet").exists()
    assert out


def test_style_preserves_stats_with_settings(tmp_path):
    src = tmp_path / "b.parquetbundle"
    write_bundle(_core(), src, settings={"old": 1}, statistics=_stats())
    out = tmp_path / "styled.parquetbundle"
    replace_settings_in_bundle(src, out, {"new": 2})
    _, settings = read_bundle(out)
    assert settings == {"new": 2}
    assert read_statistics_from_bundle(out) is not None


def test_style_preserves_stats_on_stats_only_input(tmp_path):
    src = tmp_path / "b.parquetbundle"
    write_bundle(_core(), src, statistics=_stats())  # empty settings slot
    out = tmp_path / "styled.parquetbundle"
    replace_settings_in_bundle(src, out, {"new": 2})
    _, settings = read_bundle(out)
    assert settings == {"new": 2}
    assert read_statistics_from_bundle(out) is not None
