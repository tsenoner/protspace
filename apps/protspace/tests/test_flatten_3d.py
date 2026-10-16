"""Reading 3-D projections: the deprecation warning, and ``convert --flatten-3d``.

5.0.0 stops reading 3-D projections everywhere but ``protspace convert``, which
stays the upgrade path. Until then every Python read of a bundle's projections
warns once, and ``convert --flatten-3d`` writes them as 2-D projections that keep
their X/Y view (the same as the 2-D projection only for PCA).
"""

import io
import json
import logging
from pathlib import Path

import pyarrow as pa
import pyarrow.parquet as pq
import pytest
from typer.testing import CliRunner

from protspace.cli.app import app
from protspace.cli.stats import _load_reductions
from protspace.data.annotations.encoding import stamp_format_version
from protspace.data.io.bundle import (
    FLATTENED_SUFFIX,
    PARQUET_BUNDLE_DELIMITER,
    Conversion,
    convert_bundle,
    extract_bundle_to_dir,
    read_bundle,
    read_bundle_contents,
    read_settings_from_bundle,
    read_statistics_from_bundle,
    read_tables,
    three_d_projection_names,
    write_bundle,
    write_directory,
)
from protspace.data.io.bundle_v3 import read_part
from protspace.deprecations import THREE_D_RECOMPUTE, THREE_D_XY_VIEW
from tests.cli_output import plain

BUNDLE_LOGGER = "protspace.data.io.bundle"
SETTINGS = {"version": 2, "settings": {"cat": {"categories": {"a": {"color": "#F00"}}}}}
IDS = ["p0", "p1", "p2"]


@pytest.fixture(autouse=True)
def _restore_root_logging():
    """The CLI's ``setup_logging`` binds the root handler to the runner's stderr."""
    root = logging.getLogger()
    handlers, level = root.handlers[:], root.level
    yield
    root.handlers[:] = handlers
    root.setLevel(level)


def _tables(*, three_d: bool = True) -> list[pa.Table]:
    annotations = stamp_format_version(
        pa.table({"protein_id": IDS, "cat": ["a", "b", "a"]})
    )
    names = ["PCA 2", "UMAP 3"] if three_d else ["PCA 2"]
    quality = {"trustworthiness": 0.9}
    metadata = pa.table(
        {
            "projection_name": names,
            "dimensions": [2, 3][: len(names)],
            "info_json": [
                json.dumps({"n_components": 2}),
                json.dumps({"n_components": 3, "quality": quality}),
            ][: len(names)],
        }
    )
    rows = {"projection_name": [], "protein_id": [], "x": [], "y": [], "z": []}
    for name in names:
        for i, ident in enumerate(IDS):
            rows["projection_name"].append(name)
            rows["protein_id"].append(ident)
            rows["x"].append(float(i))
            rows["y"].append(float(i) + 0.5)
            rows["z"].append(float(i) + 0.25 if name == "UMAP 3" else None)
    data = pa.table(
        {
            **{k: rows[k] for k in ("projection_name", "protein_id")},
            **{k: pa.array(rows[k], type=pa.float32()) for k in ("x", "y", "z")},
        }
    )
    return [annotations, metadata, data]


def _statistics() -> pa.Table:
    return pa.table(
        {
            "space_kind": ["embedding", "projection", "projection"],
            "space_name": ["E", "PCA 2", "UMAP 3"],
            "annotation": ["cat", "cat", "cat"],
            "metric": ["silhouette"] * 3,
            "value": [0.1, 0.2, 0.3],
        }
    )


def _v3(path: Path, *, three_d: bool = True) -> Path:
    write_bundle(
        _tables(three_d=three_d), path, settings=SETTINGS, statistics=_statistics()
    )
    return path


def _serialized(table: pa.Table) -> bytes:
    buf = io.BytesIO()
    pq.write_table(table, buf)
    return buf.getvalue()


def _v2(path: Path) -> Path:
    parts = [_serialized(t) for t in _tables()]
    parts += [b"", _serialized(_statistics())]
    path.write_bytes(PARQUET_BUNDLE_DELIMITER.join(parts))
    return path


def _three_d_warnings(caplog) -> list[str]:
    return [
        r.getMessage()
        for r in caplog.records
        if r.name == BUNDLE_LOGGER and "Reading 3-D projections" in r.getMessage()
    ]


# --------------------------------------------------------------------------- #
# the read warning
# --------------------------------------------------------------------------- #


@pytest.mark.parametrize(
    "read",
    [
        read_tables,
        lambda p: read_tables(p.read_bytes()),
        read_bundle_contents,
        read_bundle,
        extract_bundle_to_dir,
    ],
    ids=["tables", "tables-bytes", "contents", "bundle", "extract"],
)
@pytest.mark.parametrize("container", ["v3", "v2"])
def test_each_projection_read_of_a_3d_bundle_warns_once(
    tmp_path, caplog, read, container
):
    src = (_v3 if container == "v3" else _v2)(tmp_path / "b.parquetbundle")

    with caplog.at_level(logging.WARNING, logger=BUNDLE_LOGGER):
        read(src)
        read(src)

    warnings = _three_d_warnings(caplog)
    assert len(warnings) == 2  # once per read, like the v1/v2 warning
    assert "(UMAP 3)" in warnings[0]
    assert "removed in protspace 5.0.0" in warnings[0]
    assert "protspace convert --flatten-3d" in warnings[0]
    assert THREE_D_RECOMPUTE in warnings[0]
    assert THREE_D_XY_VIEW in warnings[0]


def test_a_2d_bundle_does_not_warn(tmp_path, caplog):
    src = _v3(tmp_path / "b.parquetbundle", three_d=False)
    with caplog.at_level(logging.WARNING, logger=BUNDLE_LOGGER):
        read_tables(src)
        read_bundle_contents(src)
    assert _three_d_warnings(caplog) == []


def test_reads_that_never_touch_projections_do_not_warn(tmp_path, caplog):
    """`protspace style` only reads settings; it has nothing to say about 3-D."""
    src = _v3(tmp_path / "b.parquetbundle")
    with caplog.at_level(logging.WARNING, logger=BUNDLE_LOGGER):
        read_settings_from_bundle(src)
        read_statistics_from_bundle(src)
    assert _three_d_warnings(caplog) == []


def test_warn_3d_false_reads_quietly(tmp_path, caplog):
    src = _v3(tmp_path / "b.parquetbundle")
    with caplog.at_level(logging.WARNING, logger=BUNDLE_LOGGER):
        contents = read_bundle_contents(src, warn_3d=False)
    assert _three_d_warnings(caplog) == []
    assert three_d_projection_names(contents.projections) == ["UMAP 3"]


def test_the_data_decides_what_is_3d():
    """Metadata is not consulted: all-null or NaN z is 2-D, any finite z is 3-D."""
    table = pa.table(
        {
            "projection_name": ["A", "A", "B", "B", "C"],
            "z": pa.array([None, None, float("nan"), None, 1.0], type=pa.float32()),
        }
    )
    assert three_d_projection_names(table) == ["C"]
    assert three_d_projection_names(table.drop_columns(["z"])) == []


def test_stats_warns_on_a_3d_projection_directory(tmp_path, caplog):
    directory = tmp_path / "proj"
    _annotations, metadata, data = _tables()
    write_directory([None, metadata, data], directory)

    with caplog.at_level(logging.WARNING, logger="protspace.cli.stats"):
        reductions = _load_reductions(directory)

    assert [r["data"].shape[1] for r in reductions] == [2, 3]  # still read as before
    [message] = [r.getMessage() for r in caplog.records if "3-D" in r.getMessage()]
    assert "(UMAP 3)" in message and "protspace 5.0.0" in message


# --------------------------------------------------------------------------- #
# convert --flatten-3d
# --------------------------------------------------------------------------- #


def _convert(*args: str):
    return CliRunner().invoke(app, ["convert", *args])


@pytest.mark.parametrize("container", ["v3", "v2"])
def test_flatten_writes_each_3d_projection_as_its_xy_view(tmp_path, container):
    src = (_v3 if container == "v3" else _v2)(tmp_path / "in.parquetbundle")
    out = tmp_path / "out.parquetbundle"

    result = convert_bundle(src, out, flatten_3d=True)

    assert result == Conversion(
        version=3 if container == "v3" else 2,
        three_d=("UMAP 3",),
        flattened=("UMAP 3",),
    )
    assert result.written
    contents = read_bundle_contents(out)
    flat = f"UMAP 3{FLATTENED_SUFFIX}"
    assert contents.metadata.column("projection_name").to_pylist() == ["PCA 2", flat]
    assert contents.metadata.column("dimensions").to_pylist() == [2, 2]
    assert three_d_projection_names(contents.projections) == []

    rows = contents.projections.to_pandas()
    original = _tables()[2].to_pandas()
    for name, written in (("PCA 2", "PCA 2"), ("UMAP 3", flat)):
        got = rows[rows.projection_name == written].sort_values("protein_id")
        want = original[original.projection_name == name].sort_values("protein_id")
        assert got.protein_id.tolist() == want.protein_id.tolist()
        assert got.x.tolist() == want.x.tolist()
        assert got.y.tolist() == want.y.tolist()

    info = [json.loads(i) for i in contents.metadata.column("info_json").to_pylist()]
    assert info[0] == {"n_components": 2}  # 2-D projections are untouched
    assert info[1]["flattened_from_3d"] is True
    assert "quality" not in info[1]  # measured on the 3-D layout

    statistics = contents.statistics.to_pydict()
    assert statistics["space_name"] == ["E", "PCA 2"]  # UMAP 3's rows dropped
    assert contents.settings == (SETTINGS if container == "v3" else None)
    assert contents.container_version == 3


def test_flatten_rewrites_in_place(tmp_path):
    src = _v3(tmp_path / "in.parquetbundle")
    result = _convert(str(src), "--in-place", "--flatten-3d")

    assert result.exit_code == 0, result.output
    output = plain(result.output)
    assert f"Rewrote {src} (v3) with 2-D projections" in output
    assert f"UMAP 3 -> UMAP 3{FLATTENED_SUFFIX}" in output
    assert f"{THREE_D_XY_VIEW} {THREE_D_RECOMPUTE}" in output
    assert three_d_projection_names(read_bundle_contents(src).projections) == []


def test_flatten_with_nothing_to_flatten_writes_nothing(tmp_path):
    src = _v3(tmp_path / "in.parquetbundle", three_d=False)
    out = tmp_path / "out.parquetbundle"

    result = _convert(str(src), str(out), "--flatten-3d")

    assert result.exit_code == 0, result.output
    assert "already a v3 parquetbundle; nothing to do" in plain(result.output)
    assert not out.exists()


def test_without_the_flag_a_3d_v3_bundle_is_left_untouched_with_a_warning(tmp_path):
    src = _v3(tmp_path / "in.parquetbundle")
    before = src.read_bytes()

    result = _convert(str(src), "--in-place")

    assert result.exit_code == 0, result.output
    output = plain(result.output)
    assert "nothing to do" in output
    assert "holds 3-D projections (UMAP 3)" in output
    assert "removed in protspace 5.0.0" in output
    assert THREE_D_RECOMPUTE in output
    assert "--flatten-3d" in output
    assert THREE_D_XY_VIEW in output
    assert "Kept them as 3-D; protspace 5.0.0 writes them as 2-D" in output
    assert src.read_bytes() == before


def test_without_the_flag_a_v2_bundle_keeps_its_3d_projection(tmp_path):
    src = _v2(tmp_path / "in.parquetbundle")
    out = tmp_path / "out.parquetbundle"

    result = _convert(str(src), str(out))

    assert result.exit_code == 0, result.output
    assert "Kept them as 3-D" in plain(result.output)
    assert three_d_projection_names(read_bundle_contents(out).projections) == ["UMAP 3"]


def test_a_name_that_would_collide_is_refused(tmp_path):
    annotations, metadata, data = _tables()
    taken = f"UMAP 3{FLATTENED_SUFFIX}"
    metadata = pa.concat_tables(
        [
            metadata,
            pa.table(
                {"projection_name": [taken], "dimensions": [2], "info_json": ["{}"]}
            ),
        ]
    )
    extra = pa.table(
        {
            "projection_name": [taken] * 3,
            "protein_id": IDS,
            "x": pa.array([0.0, 1.0, 2.0], type=pa.float32()),
            "y": pa.array([0.0, 1.0, 2.0], type=pa.float32()),
            "z": pa.array([None] * 3, type=pa.float32()),
        }
    )
    src = tmp_path / "in.parquetbundle"
    write_bundle([annotations, metadata, pa.concat_tables([data, extra])], src)

    result = _convert(str(src), str(tmp_path / "out.parquetbundle"), "--flatten-3d")

    assert result.exit_code != 0
    assert f"{taken} already exist" in plain(result.output)


def test_convert_help_names_flatten_3d():
    result = CliRunner().invoke(app, ["convert", "--help"])
    output = plain(result.output)
    assert "--flatten-3d" in output
    assert THREE_D_XY_VIEW in output
    assert THREE_D_RECOMPUTE in output
    assert "protspace 5.0.0" in output


def test_flattened_statistics_part_is_still_readable(tmp_path):
    src = _v2(tmp_path / "in.parquetbundle")
    out = tmp_path / "out.parquetbundle"
    convert_bundle(src, out, flatten_3d=True)
    assert read_part(read_statistics_from_bundle(out)).num_rows == 2
