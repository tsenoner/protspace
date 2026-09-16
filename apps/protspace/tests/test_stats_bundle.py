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
        pa.table({"projection_name": ["PCA_2"], "dimensions": [2]}),
        pa.table(
            {
                "projection_name": ["PCA_2", "PCA_2"],
                "identifier": ["a", "b"],
                "x": [0.0, 1.0],
                "y": [0.0, 1.0],
            }
        ),
    ]


def _stats() -> pa.Table:
    return pa.table({"space_name": ["PCA_2"], "metric": ["silhouette"], "value": [0.5]})


def _parts(path) -> list[bytes]:
    return path.read_bytes().split(PARQUET_BUNDLE_DELIMITER)


def test_bundle_without_settings_or_stats_roundtrips(tmp_path):
    """Every write is v3, so the container always has six slots — the settings
    and statistics ones are zero bytes here, which is what keeps the payloads
    part at position six where the browser reads it."""
    p = tmp_path / "b.parquetbundle"
    write_bundle(_core(), p)
    parts = _parts(p)
    assert len(parts) == 6
    assert parts[3] == b"" and parts[4] == b"" and parts[5]
    core, settings = read_bundle(p)
    assert len(core) == 3 and settings is None
    assert read_statistics_from_bundle(p) is None


def test_settings_only(tmp_path):
    p = tmp_path / "b.parquetbundle"
    write_bundle(_core(), p, settings={"hello": "world"})
    parts = _parts(p)
    assert len(parts) == 6 and parts[3] and parts[4] == b""
    _, settings = read_bundle(p)
    assert settings == {"hello": "world"}
    assert read_statistics_from_bundle(p) is None


def test_settings_and_stats(tmp_path):
    p = tmp_path / "b.parquetbundle"
    write_bundle(_core(), p, settings={"k": 1}, statistics=_stats())
    parts = _parts(p)
    assert len(parts) == 6 and parts[3] and parts[4]
    _, settings = read_bundle(p)
    assert settings == {"k": 1}
    stats_bytes = read_statistics_from_bundle(p)
    assert stats_bytes is not None
    table = pq.read_table(pa.BufferReader(stats_bytes))
    assert table.column("metric")[0].as_py() == "silhouette"


def test_stats_only_empty_settings(tmp_path):
    p = tmp_path / "b.parquetbundle"
    write_bundle(_core(), p, statistics=_stats())
    parts = _parts(p)
    # zero-byte settings slot keeps stats at position 5 and payloads at 6
    assert len(parts) == 6 and parts[3] == b"" and parts[4]
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


def test_extract_to_dir_writes_both_settings_and_statistics(tmp_path):
    """Extract a full 5-part bundle where BOTH the settings (4th) and statistics
    (5th) parts are non-empty — both files must land with the right content, not
    just the stats-only case the sibling test covers."""
    from protspace.data.io.bundle import read_settings_from_file

    p = tmp_path / "b.parquetbundle"
    write_bundle(_core(), p, settings={"k": 1}, statistics=_stats())
    out_dir = tmp_path / "out"
    extract_bundle_to_dir(p, out_dir)

    assert read_settings_from_file(out_dir / "settings.parquet") == {"k": 1}
    stats = pq.read_table(str(out_dir / "statistics.parquet"))
    assert stats.column("metric")[0].as_py() == "silhouette"
    for name in ("selected_annotations", "projections_metadata", "projections_data"):
        assert (out_dir / f"{name}.parquet").exists()


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
