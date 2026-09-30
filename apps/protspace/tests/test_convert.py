"""``protspace convert`` and the legacy-format deprecation warning.

v1/v2 bundles stay readable until protspace 5.0.0, but every public read of one
logs a single warning pointing at ``protspace convert``.  The converter itself
rewrites a legacy container as v3, migrating v1 cell grammar and keeping the
settings and statistics parts byte for byte.
"""

import io
import logging
from pathlib import Path

import pyarrow as pa
import pyarrow.parquet as pq
import pytest
from typer.testing import CliRunner

from protspace.cli.app import app
from protspace.data.annotations.encoding import (
    decode_field,
    read_format_version,
    stamp_format_version,
)
from protspace.data.io.bundle import (
    PARQUET_BUNDLE_DELIMITER,
    create_settings_parquet,
    extract_bundle_to_dir,
    read_bundle,
    read_settings_from_bundle,
    read_statistics_from_bundle,
    read_tables,
    replace_annotations_in_bundle,
    replace_settings_in_bundle,
    write_bundle,
)

BUNDLE_LOGGER = "protspace.data.io.bundle"

#: The web app wraps the per-annotation settings in an envelope; convert must
#: carry it through untouched, not re-serialize it.
SETTINGS = {
    "version": 2,
    "settings": {"cat": {"categories": {"plain": {"color": "#FF0000"}}}},
}


@pytest.fixture(autouse=True)
def _restore_root_logging():
    """``setup_logging`` in the CLI swaps the root handlers for one bound to the
    runner's stderr, which is closed once ``invoke`` returns."""
    root = logging.getLogger()
    handlers, level = root.handlers[:], root.level
    yield
    root.handlers[:] = handlers
    root.setLevel(level)


def _serialized(table: pa.Table) -> bytes:
    buf = io.BytesIO()
    pq.write_table(table, buf)
    return buf.getvalue()


def _statistics() -> bytes:
    return _serialized(pa.table({"projection": ["PCA 2"], "trustworthiness": [0.9]}))


def _legacy_bundle(
    path: Path,
    *,
    cells: list[str],
    stamp: bool = True,
    settings: bytes | None = None,
    statistics: bytes | None = None,
    ids: list[str] | None = None,
) -> list[bytes]:
    """Write a v1 (``stamp=False``) or v2 container by hand; return its parts."""
    ids = ids or [f"p{i}" for i in range(len(cells))]
    annotations = pa.table({"protein_id": ids, "cat": cells})
    if stamp:
        annotations = stamp_format_version(annotations)
    metadata = pa.table(
        {"projection_name": ["PCA 2"], "dimensions": [2], "info_json": ["{}"]}
    )
    data = pa.table(
        {
            "projection_name": ["PCA 2"] * len(ids),
            "identifier": ids,
            "x": [float(i) for i in range(len(ids))],
            "y": [0.5] * len(ids),
            "z": pa.array([None] * len(ids), type=pa.float32()),
        }
    )
    parts = [_serialized(t) for t in (annotations, metadata, data)]
    if settings is not None or statistics is not None:
        parts.append(settings if settings is not None else b"")
    if statistics is not None:
        parts.append(statistics)
    path.write_bytes(PARQUET_BUNDLE_DELIMITER.join(parts))
    return parts


def _v3_bundle(path: Path) -> None:
    annotations = stamp_format_version(
        pa.table({"protein_id": ["p0", "p1"], "cat": ["a", "b"]})
    )
    metadata = pa.table({"projection_name": ["PCA 2"], "dimensions": [2]})
    data = pa.table(
        {
            "projection_name": ["PCA 2"] * 2,
            "identifier": ["p0", "p1"],
            "x": [0.0, 1.0],
            "y": [0.0, 1.0],
        }
    )
    write_bundle([annotations, metadata, data], path, settings=SETTINGS)


def _convert(*args: str):
    return CliRunner().invoke(app, ["convert", *args])


def _parts(path: Path) -> list[bytes]:
    return path.read_bytes().split(PARQUET_BUNDLE_DELIMITER)


def _hits(cell: str) -> list[str]:
    return [decode_field(hit) for hit in cell.split(";")]


# --------------------------------------------------------------------------- #
# conversion
# --------------------------------------------------------------------------- #


def test_v2_bundle_with_settings_and_statistics(tmp_path):
    src, out = tmp_path / "old.parquetbundle", tmp_path / "new.parquetbundle"
    cells = ["ACC (Name%3B part)|EXP", "plain", ""]
    parts = _legacy_bundle(
        src,
        cells=cells,
        settings=create_settings_parquet(SETTINGS),
        statistics=_statistics(),
    )
    before = read_tables(src)

    result = _convert(str(src), str(out))

    assert result.exit_code == 0, result.output
    assert "(v2) to v3" in result.output
    out_parts = _parts(out)
    assert len(out_parts) == 6
    assert out_parts[3] == parts[3]  # settings, envelope included
    assert out_parts[4] == parts[4]  # statistics, byte for byte
    assert read_settings_from_bundle(out) == SETTINGS

    after = read_tables(out)
    assert after[0].column("cat").to_pylist() == cells
    assert after[0].column("protein_id").to_pylist() == ["p0", "p1", "p2"]
    assert after[2].column("x").to_pylist() == before[2].column("x").to_pylist()
    assert src.read_bytes() == PARQUET_BUNDLE_DELIMITER.join(parts)  # input kept


def test_statistics_without_settings(tmp_path):
    src, out = tmp_path / "old.parquetbundle", tmp_path / "new.parquetbundle"
    parts = _legacy_bundle(
        src, cells=["a", "b"], settings=b"", statistics=_statistics()
    )

    assert _convert(str(src), str(out)).exit_code == 0

    out_parts = _parts(out)
    assert out_parts[3] == b""
    assert out_parts[4] == parts[4]
    assert read_settings_from_bundle(out) is None
    assert read_statistics_from_bundle(out) == parts[4]


def test_v1_grammar_is_migrated(tmp_path):
    """A v1 cell is raw text: ``%`` is literal and a ``;`` inside parentheses
    does not split hits.  Both have to survive as the labels they were."""
    src, out = tmp_path / "v1.parquetbundle", tmp_path / "v3.parquetbundle"
    _legacy_bundle(
        src,
        cells=["50% identity", "Membrane (single-pass; type I)", "A;B"],
        stamp=False,
    )

    result = _convert(str(src), str(out))

    assert result.exit_code == 0, result.output
    assert "(v1) to v3" in result.output
    annotations = read_tables(out)[0]
    assert read_format_version(annotations) == 2
    cells = annotations.column("cat").to_pylist()
    assert _hits(cells[0]) == ["50% identity"]
    assert _hits(cells[1]) == ["Membrane (single-pass; type I)"]
    assert _hits(cells[2]) == ["A", "B"]


def test_v3_input_is_left_untouched(tmp_path):
    src, out = tmp_path / "current.parquetbundle", tmp_path / "out.parquetbundle"
    _v3_bundle(src)
    before = src.read_bytes()

    result = _convert(str(src), str(out))

    assert result.exit_code == 0, result.output
    assert "already a v3" in result.output
    assert src.read_bytes() == before
    assert not out.exists()


@pytest.mark.parametrize("how", ["--in-place", "same-path"])
def test_in_place(tmp_path, how):
    src = tmp_path / "old.parquetbundle"
    _legacy_bundle(src, cells=["a", "b"], statistics=_statistics())

    args = [str(src), "--in-place"] if how == "--in-place" else [str(src), str(src)]
    result = _convert(*args)

    assert result.exit_code == 0, result.output
    assert len(_parts(src)) == 6
    assert read_tables(src)[0].column("cat").to_pylist() == ["a", "b"]
    assert [p.name for p in tmp_path.iterdir()] == ["old.parquetbundle"]


def test_output_or_in_place_is_required(tmp_path):
    src = tmp_path / "old.parquetbundle"
    _legacy_bundle(src, cells=["a"])
    before = src.read_bytes()

    result = _convert(str(src))

    assert result.exit_code != 0
    assert "OUTPUT" in result.output
    assert "--in-place" in result.output
    assert src.read_bytes() == before


def test_output_and_in_place_together_are_rejected(tmp_path):
    src, out = tmp_path / "old.parquetbundle", tmp_path / "new.parquetbundle"
    _legacy_bundle(src, cells=["a"])

    result = _convert(str(src), str(out), "--in-place")

    assert result.exit_code != 0
    assert "not both" in result.output
    assert not out.exists()


def test_input_that_is_not_a_bundle(tmp_path):
    src, out = tmp_path / "notes.parquetbundle", tmp_path / "new.parquetbundle"
    src.write_bytes(b"just some text")

    result = _convert(str(src), str(out))

    assert result.exit_code != 0
    assert "cannot convert" in result.output
    assert not out.exists()


def test_missing_input(tmp_path):
    result = _convert(str(tmp_path / "absent.parquetbundle"), str(tmp_path / "o"))
    assert result.exit_code != 0


def test_failed_in_place_conversion_leaves_the_input(tmp_path):
    """Encoding refuses duplicated identifiers; the input must survive intact
    and no staging file may be left beside it."""
    src = tmp_path / "old.parquetbundle"
    _legacy_bundle(src, cells=["a", "b"], ids=["p0", "p0"])
    before = src.read_bytes()

    result = _convert(str(src), "--in-place")

    assert result.exit_code != 0
    assert "duplicated" in result.output
    assert src.read_bytes() == before
    assert [p.name for p in tmp_path.iterdir()] == ["old.parquetbundle"]


# --------------------------------------------------------------------------- #
# deprecation warning
# --------------------------------------------------------------------------- #


def _legacy_warnings(caplog) -> list[logging.LogRecord]:
    return [
        r
        for r in caplog.records
        if r.name == BUNDLE_LOGGER and "deprecated" in r.getMessage()
    ]


@pytest.mark.parametrize(
    "read",
    [
        read_tables,
        lambda p: read_tables(p.read_bytes()),
        read_bundle,
        read_settings_from_bundle,
        read_statistics_from_bundle,
        extract_bundle_to_dir,
    ],
    ids=["tables", "tables-bytes", "bundle", "settings", "statistics", "extract"],
)
def test_each_legacy_read_warns_once(tmp_path, caplog, read):
    src = tmp_path / "old.parquetbundle"
    _legacy_bundle(src, cells=["a"])

    with caplog.at_level(logging.WARNING, logger=BUNDLE_LOGGER):
        read(src)
        read(src)

    warnings = _legacy_warnings(caplog)
    assert len(warnings) == 2  # once per read, not once per process
    message = warnings[0].getMessage()
    assert "protspace convert" in message
    assert "5.0.0" in message


def test_v3_read_does_not_warn(tmp_path, caplog):
    src = tmp_path / "current.parquetbundle"
    _v3_bundle(src)

    with caplog.at_level(logging.WARNING, logger=BUNDLE_LOGGER):
        read_tables(src)
        read_settings_from_bundle(src)
        extract_bundle_to_dir(src, tmp_path / "x")

    assert _legacy_warnings(caplog) == []


def test_writers_read_their_input_silently(tmp_path, caplog):
    """A write re-encodes to v3 or keeps the parts; it is not a legacy read, so
    ``transfer`` (read_tables + replace_annotations) warns once, not twice."""
    src = tmp_path / "old.parquetbundle"
    _legacy_bundle(src, cells=["a"])

    with caplog.at_level(logging.WARNING, logger=BUNDLE_LOGGER):
        replace_settings_in_bundle(src, tmp_path / "styled.parquetbundle", {"x": 1})
        annotations = read_tables(src)[0]
        replace_annotations_in_bundle(src, tmp_path / "t.parquetbundle", annotations)

    assert len(_legacy_warnings(caplog)) == 1


def test_style_warns_once_per_run(tmp_path, caplog):
    from protspace.utils.add_annotation_style import add_annotation_styles

    src = tmp_path / "old.parquetbundle"
    _legacy_bundle(src, cells=["a", "b"], settings=create_settings_parquet(SETTINGS))

    out = tmp_path / "styled.parquetbundle"
    with caplog.at_level(logging.WARNING, logger=BUNDLE_LOGGER):
        add_annotation_styles(str(src), {"cat": {"colors": {"a": "#00FF00"}}}, str(out))

    assert len(_legacy_warnings(caplog)) == 1
    # ...and the styled output is v3, which it says once.
    upgrades = [r for r in caplog.records if "writing" in r.getMessage()]
    assert len(upgrades) == 1
    assert len(out.read_bytes().split(PARQUET_BUNDLE_DELIMITER)) == 6
    assert read_tables(out)[0].column("cat").to_pylist() == ["a", "b"]


def test_convert_does_not_warn(tmp_path):
    src, out = tmp_path / "old.parquetbundle", tmp_path / "new.parquetbundle"
    _legacy_bundle(src, cells=["a"])

    result = _convert(str(src), str(out))

    assert result.exit_code == 0, result.output
    assert "deprecated" not in result.output
