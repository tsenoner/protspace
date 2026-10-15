"""The unbundled parquet directory: one writer, one file layout.

`prepare --no-bundled`, `extract_bundle_to_dir`, `protspace project` and
`protspace style <dir>` all write a directory that `ArrowReader` and
`protspace style` read back, so they have to agree on the file names and on
carrying settings and statistics.
"""

import json
from pathlib import Path

import numpy as np
import pandas as pd
import pyarrow as pa
import pyarrow.parquet as pq
from typer.testing import CliRunner

from protspace.cli.app import app
from protspace.data.io.bundle import (
    CORE_FILENAMES,
    SETTINGS_FILENAME,
    STATISTICS_FILENAME,
    VISUALIZATION_STATE_FILENAME,
    extract_bundle_to_dir,
    read_settings_from_bundle,
    read_settings_from_file,
    write_bundle,
    write_directory,
)
from protspace.data.processors.base_processor import BaseProcessor
from protspace.utils.arrow_reader import ArrowReader

IDS = ["P1", "P2", "P3"]
SETTINGS = {"organism": {"selectedPaletteId": "kellys", "categories": {}}}
STATISTICS = pa.table({"projection_name": ["PCA_2"], "value": [0.5]})
STYLES = {"organism": {"colors": {"A": "#ff0000"}, "shapes": {"B": "diamond"}}}


def _tables() -> dict[str, pa.Table]:
    return BaseProcessor({}, {}).create_output(
        pd.DataFrame({"identifier": IDS, "organism": ["A", "B", "A"]}),
        [
            {
                "name": "PCA_2",
                "dimensions": 2,
                "info": {},
                "data": np.array([[0.1, 0.2], [0.3, 0.4], [0.5, 0.6]]),
            }
        ],
        IDS,
    )


def _core() -> list[pa.Table]:
    """The three core tables in bundle part order."""
    tables = _tables()
    return [
        tables["protein_annotations"],
        tables["projections_metadata"],
        tables["projections_data"],
    ]


def _project_dir(tmp_path):
    """A directory as `prepare --no-bundled` writes it, settings and statistics
    included."""
    out = tmp_path / "project"
    BaseProcessor({}, {}).save_output(
        _tables(), out, bundled=False, statistics=STATISTICS, settings=SETTINGS
    )
    return out


def _style(source, target):
    styles = target.parent / f"{target.name}_styles.json"
    styles.write_text(json.dumps(STYLES))
    result = CliRunner().invoke(
        app, ["style", str(source), str(target), "--annotation-styles", str(styles)]
    )
    assert result.exit_code == 0, result.output


def test_write_directory_writes_the_layout_the_reader_reads(tmp_path):
    tables = _core()
    write_directory(tables, tmp_path, settings=SETTINGS, statistics=STATISTICS)

    for table, name in zip(tables, CORE_FILENAMES, strict=True):
        assert pq.read_table(tmp_path / name).equals(table)
    assert read_settings_from_file(tmp_path / SETTINGS_FILENAME) == SETTINGS
    assert pq.read_table(tmp_path / STATISTICS_FILENAME).equals(STATISTICS)
    assert sorted(ArrowReader(tmp_path).get_protein_ids()) == IDS


def test_write_directory_skips_absent_parts(tmp_path):
    """A projections-only directory (`protspace project`) holds no annotations,
    settings or statistics file."""
    _, metadata, projections = _core()
    write_directory([None, metadata, projections], tmp_path)

    assert sorted(p.name for p in tmp_path.iterdir()) == sorted(CORE_FILENAMES[1:])


def test_write_directory_clears_a_stale_visualization_state(tmp_path):
    """A visualization_state.json an older `style` left would win over the
    settings just written, so any rewrite of the directory removes it."""
    (tmp_path / VISUALIZATION_STATE_FILENAME).write_text("{}")
    write_directory(_core(), tmp_path, settings=SETTINGS)

    assert not (tmp_path / VISUALIZATION_STATE_FILENAME).exists()


def test_extracted_bundle_matches_unbundled_output(tmp_path):
    """Extracting a bundle gives the directory `prepare --no-bundled` writes.

    Values, not tables: the v3 decode types an all-missing ``z`` as float where
    the pipeline wrote it as null, one of its documented canonicalisations.
    """
    bundle = tmp_path / "data.parquetbundle"
    write_bundle(_core(), bundle, settings=SETTINGS, statistics=STATISTICS)
    extracted = tmp_path / "extracted"
    extract_bundle_to_dir(bundle, extracted)
    unbundled = _project_dir(tmp_path)

    names = sorted(p.name for p in unbundled.iterdir())
    assert sorted(p.name for p in extracted.iterdir()) == names
    for name in names:
        assert (
            pq.read_table(extracted / name).to_pydict()
            == pq.read_table(unbundled / name).to_pydict()
        ), name


def test_style_directory_keeps_every_part(tmp_path):
    """`protspace style <dir> <newdir>` keeps every other part byte for byte, as
    styling a bundle does, statistics included."""
    source = _project_dir(tmp_path)
    target = tmp_path / "styled"
    _style(source, target)

    for name in [*CORE_FILENAMES, STATISTICS_FILENAME]:
        assert (target / name).read_bytes() == (source / name).read_bytes(), name
    assert sorted(ArrowReader(target).get_protein_ids()) == IDS


def test_style_directory_writes_the_settings_a_bundle_gets(tmp_path):
    """Styling a directory lands the same settings as styling the bundle of the
    same data, in settings.parquet, keeping what the settings held before."""
    bundle = tmp_path / "data.parquetbundle"
    write_bundle(_core(), bundle, settings=SETTINGS, statistics=STATISTICS)
    styled_bundle = tmp_path / "styled.parquetbundle"
    _style(bundle, styled_bundle)

    target = tmp_path / "styled"
    _style(_project_dir(tmp_path), target)

    assert not (target / VISUALIZATION_STATE_FILENAME).exists()
    assert read_settings_from_file(
        target / SETTINGS_FILENAME
    ) == read_settings_from_bundle(styled_bundle)
    reader, bundle_reader = ArrowReader(target), ArrowReader(styled_bundle)
    assert reader.get_annotation_colors("organism") == (
        bundle_reader.get_annotation_colors("organism")
    )
    assert reader.get_marker_shape("organism")["B"] == "diamond"


def test_style_directory_in_place_is_not_shadowed_by_old_state(tmp_path):
    """A visualization_state.json an older `style` left behind would win over
    the new settings.parquet on read, so restyling replaces it."""
    source = _project_dir(tmp_path)
    (source / VISUALIZATION_STATE_FILENAME).write_text(
        '{"annotation_colors": {"organism": {"A": "#00ff00"}}, "marker_shapes": {}}'
    )
    _style(source, source)

    assert not (source / VISUALIZATION_STATE_FILENAME).exists()
    # settings store colours as rgba; the old state's #00ff00 is gone
    assert ArrowReader(source).get_annotation_colors("organism") == {
        "A": "rgba(255, 0, 0, 0.8)"
    }
    settings = read_settings_from_file(source / SETTINGS_FILENAME)
    assert settings["organism"]["selectedPaletteId"] == "kellys"


def _two_column_bundle(tmp_path):
    """A bundle whose settings style `kingdom`, which the tests leave alone."""
    tables = BaseProcessor({}, {}).create_output(
        pd.DataFrame(
            {"identifier": IDS, "organism": ["A", "B", "A"], "kingdom": ["x", "y", "x"]}
        ),
        [{"name": "PCA_2", "dimensions": 2, "info": {}, "data": np.zeros((3, 2))}],
        IDS,
    )
    bundle = tmp_path / "two.parquetbundle"
    write_bundle(
        [
            tables["protein_annotations"],
            tables["projections_metadata"],
            tables["projections_data"],
        ],
        bundle,
        settings={"kingdom": KINGDOM_SETTINGS},
    )
    return bundle


KINGDOM_SETTINGS = {
    "selectedPaletteId": "okabeIto",
    "maxVisibleValues": 3,
    "categories": {},
}


def test_style_keeps_the_settings_of_an_annotation_it_does_not_style(tmp_path):
    """Styling `organism` leaves the settings stored for `kingdom` as they were,
    in a bundle and in its directory alike."""
    bundle = _two_column_bundle(tmp_path)
    styled_bundle = tmp_path / "styled.parquetbundle"
    _style(bundle, styled_bundle)
    directory = Path(extract_bundle_to_dir(bundle, tmp_path / "dir"))
    _style(directory, directory)

    assert read_settings_from_bundle(styled_bundle)["kingdom"] == KINGDOM_SETTINGS
    settings = read_settings_from_file(directory / SETTINGS_FILENAME)
    assert settings["kingdom"] == KINGDOM_SETTINGS
    assert "organism" in settings


def test_write_directory_without_settings_keeps_the_old_state(tmp_path):
    """No settings written, nothing shadows the old styles: they stay."""
    (tmp_path / VISUALIZATION_STATE_FILENAME).write_text("{}")
    write_directory([None, *_core()[1:]], tmp_path)

    assert (tmp_path / VISUALIZATION_STATE_FILENAME).exists()


def test_unreadable_statistics_do_not_stop_a_directory_loading(tmp_path):
    """The reader does not use statistics; it carries them through unread."""
    source = _project_dir(tmp_path)
    (source / STATISTICS_FILENAME).write_bytes(b"not parquet")

    reader = ArrowReader(source)
    assert sorted(reader.get_protein_ids()) == IDS
    reader.save_data(tmp_path / "saved")
    assert (tmp_path / "saved" / STATISTICS_FILENAME).read_bytes() == b"not parquet"


def test_style_into_a_used_directory_drops_parts_the_input_lacks(tmp_path):
    source = _project_dir(tmp_path)
    (source / STATISTICS_FILENAME).unlink()
    target = tmp_path / "styled"
    target.mkdir()
    (target / STATISTICS_FILENAME).write_bytes(b"another dataset's")
    _style(source, target)

    assert not (target / STATISTICS_FILENAME).exists()


def test_style_in_place_leaves_the_other_files_untouched(tmp_path):
    source = _project_dir(tmp_path)
    before = {n: (source / n).stat().st_ino for n in CORE_FILENAMES}
    _style(source, source)

    assert {n: (source / n).stat().st_ino for n in CORE_FILENAMES} == before
