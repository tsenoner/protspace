"""The v3 container boundary (``data/io/bundle``).

``bundle_v3`` owns the codec; this file owns the *container* around it: every
write emits a six-part v3 bundle, every read hands v2-shaped tables back, and a
legacy (v1/v2) bundle is still read exactly as it was written rather than
silently migrated.

The three things that would break the browser if they regressed:

* part 6 is positionally pinned (the reader takes payloads from ``parts[5]``),
  so a v3 container always writes the settings and statistics slots, zero bytes
  when absent;
* part 6 holds the label dictionaries *for* part 1, so any write that changes
  the annotations has to re-encode both;
* the delimiter guard has to cover part 6, where the labels now live.
"""

import logging
from pathlib import Path

import pyarrow as pa
import pyarrow.parquet as pq
import pytest

from protspace.data.annotations.encoding import (
    FORMAT_VERSION_KEY,
    read_format_version,
    stamp_format_version,
    upgrade_cell_grammar,
)
from protspace.data.io.bundle import (
    PARQUET_BUNDLE_DELIMITER,
    _write_parts,
    extract_bundle_to_dir,
    read_bundle,
    read_settings_from_bundle,
    read_tables,
    replace_annotations_in_bundle,
    replace_settings_in_bundle,
    write_bundle,
)
from protspace.data.io.bundle_v3 import write_part
from tests.bundle_v3_helpers import (
    annotations_table,
    parts_of,
    projection_tables,
    read,
)


def pipeline_tables(dimensions=(2, 3)):
    """The three v2-shaped tables the prepare pipeline hands ``write_bundle``."""
    annotations = annotations_table(
        kingdom=["Bacteria", "Archaea", "Bacteria"],
        pfam=["PF00001 (7tm%3B1)|1e-10,2.5", "", "PF00002|0.5;PF00003"],
        go_mf=["GO:0005524|IDA", "GO:0016787|ECO:0000269", ""],
        length=["120", "", "340"],
    )
    metadata, data = projection_tables(annotations.num_rows, dimensions)
    return [annotations, metadata, data]


def legacy_bundle(path: Path, *, stamp: bool = True, settings: bytes | None = None):
    """Write a pre-v3 container by hand and return its raw parts.

    ``write_bundle`` cannot build one any more, and that is the point: a legacy
    bundle has to keep reading back byte-for-byte as it was written.
    """
    annotations = pa.table(
        {"protein_id": ["p0", "p1"], "cat": ["ACC (Name%3B part)|EXP", "plain"]}
    )
    if stamp:
        annotations = stamp_format_version(annotations)
    metadata = pa.table({"projection_name": ["PCA 2"], "dimensions": [2]})
    data = pa.table(
        {
            "projection_name": ["PCA 2", "PCA 2"],
            "identifier": ["p0", "p1"],
            "x": [0.0, 1.0],
            "y": [2.0, 3.0],
        }
    )

    parts = [write_part(t) for t in (annotations, metadata, data)]
    if settings is not None:
        parts.append(settings)
    path.write_bytes(PARQUET_BUNDLE_DELIMITER.join(parts))
    return parts


# --------------------------------------------------------------------------- #
# layout
# --------------------------------------------------------------------------- #


def test_write_bundle_always_emits_six_parts(tmp_path):
    """Part 6 is read positionally, so the settings and statistics slots exist
    even when empty; a five-slot v3 bundle would file the payloads under
    statistics and the browser would report no payloads part."""
    path = tmp_path / "b.parquetbundle"
    write_bundle(pipeline_tables(), path)

    parts = parts_of(path)
    assert len(parts) == 6
    assert parts[3] == b"" and parts[4] == b""
    assert read(parts[0]).schema.metadata[FORMAT_VERSION_KEY] == b"3"
    assert read(parts[5]).column_names == ["name", "data"]


def test_settings_and_statistics_keep_payloads_at_position_six(tmp_path):
    path = tmp_path / "b.parquetbundle"
    write_bundle(
        pipeline_tables(),
        path,
        settings={"k": 1},
        statistics=pa.table({"metric": ["silhouette"], "value": [0.5]}),
    )

    parts = parts_of(path)
    assert len(parts) == 6
    assert parts[3] and parts[4]
    assert read(parts[5]).column_names == ["name", "data"]


def test_delimiter_in_a_label_is_caught_in_part_six(tmp_path):
    """v3 moves labels out of part 1 and into the part 6 dictionary blob, so the
    guard has to run there or a label carrying the reserved bytes corrupts the
    split on read-back."""
    label = "x" + PARQUET_BUNDLE_DELIMITER.decode() + "y"
    annotations, metadata, data = pipeline_tables()
    annotations = annotations.set_column(
        annotations.column_names.index("kingdom"),
        "kingdom",
        pa.array([label, "Archaea", "Bacteria"]),
    )

    with pytest.raises(ValueError, match="bundle delimiter"):
        write_bundle(
            [stamp_format_version(annotations), metadata, data],
            tmp_path / "b.parquetbundle",
        )


def test_write_parts_checks_the_payloads_slot(tmp_path):
    """The guard above only bites because ``_write_parts`` checks all six parts."""
    with pytest.raises(ValueError, match="bundle delimiter"):
        _write_parts(
            tmp_path / "b.parquetbundle",
            [b"a", b"b", b"c"],
            payloads=b"pay" + PARQUET_BUNDLE_DELIMITER + b"load",
        )


def test_six_parts_with_a_non_v3_footer_is_rejected(tmp_path):
    """Six parts means v3; the part-1 footer has to agree, or the file is not a
    bundle this reader understands."""
    path = tmp_path / "b.parquetbundle"
    parts = legacy_bundle(tmp_path / "legacy.parquetbundle")
    path.write_bytes(PARQUET_BUNDLE_DELIMITER.join([*parts, b"", b"", b"payloads"]))

    with pytest.raises(ValueError, match="container version 2"):
        read_tables(path)


def test_too_many_parts_is_rejected(tmp_path):
    path = tmp_path / "b.parquetbundle"
    path.write_bytes(PARQUET_BUNDLE_DELIMITER.join([b""] * 7))

    with pytest.raises(ValueError, match="Expected 3 to 6 parts"):
        read_tables(path)


# --------------------------------------------------------------------------- #
# read_tables
# --------------------------------------------------------------------------- #


def test_write_then_read_tables_round_trips_pipeline_tables(tmp_path):
    tables = pipeline_tables()
    path = tmp_path / "b.parquetbundle"
    write_bundle(tables, path)

    annotations, metadata, data = read_tables(path)
    assert annotations.equals(tables[0])
    assert metadata.equals(tables[1])
    # Cell-for-cell, but not type-for-type: an all-null `z` leaves the pipeline
    # as float64 and comes back float32 (a documented decode_v3 non-identity).
    assert data.to_pydict() == tables[2].to_pydict()
    assert data.schema.field("z").type == pa.float32()
    # What comes back is the v2 cell grammar every Python consumer parses.
    assert read_format_version(annotations) == 2


def test_read_tables_accepts_raw_bytes(tmp_path):
    tables = pipeline_tables()
    path = tmp_path / "b.parquetbundle"
    write_bundle(tables, path)

    assert read_tables(path.read_bytes())[0].equals(tables[0])


def test_legacy_bundle_reads_back_unchanged(tmp_path):
    path = tmp_path / "legacy.parquetbundle"
    parts = legacy_bundle(path)

    annotations, metadata, data = read_tables(path)
    assert annotations.equals(read(parts[0]))
    assert metadata.equals(read(parts[1]))
    assert data.equals(read(parts[2]))
    assert read_format_version(annotations) == 2


def test_legacy_v1_bundle_is_not_migrated_by_a_read(tmp_path):
    """Reading must not upgrade: a v1 cell keeps its raw ``%XX`` spelling and its
    missing stamp, so a consumer that gates decoding on the version still sees
    v1 (double-escaping it here would be unrecoverable)."""
    path = tmp_path / "legacy.parquetbundle"
    legacy_bundle(path, stamp=False)

    annotations, _metadata, _data = read_tables(path)
    assert read_format_version(annotations) == 1
    assert annotations.column("cat").to_pylist() == [
        "ACC (Name%3B part)|EXP",
        "plain",
    ]


# --------------------------------------------------------------------------- #
# rewrites
# --------------------------------------------------------------------------- #


def test_replace_settings_keeps_a_legacy_bundle_legacy(tmp_path):
    src = tmp_path / "legacy.parquetbundle"
    out = tmp_path / "styled.parquetbundle"
    parts = legacy_bundle(src)

    replace_settings_in_bundle(src, out, {"new": 2})

    out_parts = parts_of(out)
    assert len(out_parts) == 4  # no payload slot invented
    assert out_parts[:3] == parts[:3]  # core preserved byte-for-byte
    assert read_bundle(out)[1] == {"new": 2}


def test_replace_settings_keeps_the_payloads_of_a_v3_bundle(tmp_path):
    src = tmp_path / "b.parquetbundle"
    out = tmp_path / "styled.parquetbundle"
    write_bundle(pipeline_tables(), src, settings={"old": 1})

    replace_settings_in_bundle(src, out, {"new": 2})

    in_parts, out_parts = parts_of(src), parts_of(out)
    assert len(out_parts) == 6
    assert out_parts[5] == in_parts[5]
    assert read_bundle(out)[1] == {"new": 2}
    assert read_tables(out)[0].equals(pipeline_tables()[0])


def test_replace_annotations_re_encodes_the_payloads(tmp_path):
    """Part 6 holds part 1's label dictionaries, so rewriting part 1 while
    carrying the old part 6 over would leave the codes pointing at stale labels.
    Every label here is replaced, so a stale payload decodes to the old ones."""
    src = tmp_path / "b.parquetbundle"
    out = tmp_path / "out.parquetbundle"
    tables = pipeline_tables()
    write_bundle(tables, src)

    replacement = annotations_table(
        kingdom=["Fungi", "Viridiplantae", "Fungi"],
        pfam=["PF09999|0.75", "", "PF08888"],
        go_mf=["GO:0000001|IEA", "", ""],
        length=["1", "2", "3"],
    )
    replace_annotations_in_bundle(src, out, replacement)

    annotations, metadata, data = read_tables(out)
    assert annotations.equals(replacement)
    # The projections ride along untouched.
    assert metadata.equals(tables[1])
    assert data.to_pydict() == tables[2].to_pydict()

    payload_blob = b"".join(
        read(parts_of(out)[5]).column("data").to_pylist(),
    )
    assert b"Fungi" in payload_blob
    assert b"Bacteria" not in payload_blob  # no stale dictionary left behind


def test_replace_annotations_refuses_an_unstamped_table(tmp_path):
    """``transfer`` rebuilds the table with ``rename_columns``, which drops the
    grammar stamp, so what it holds is v2 cells that *read* as v1.  Migrating
    them again would turn ``%3B`` into ``%253B``, unrecoverably, and stamping
    them blindly would mislabel a genuine v1 table.  Neither guess is made: the
    write is refused and the input left alone."""
    src = tmp_path / "b.parquetbundle"
    out = tmp_path / "out.parquetbundle"
    write_bundle(pipeline_tables(), src)

    cells = ["G3DSA:1.1 (Ribosomal L15%3B Chain: K)", "PF1 (a%7Cb)|0.5", "plain"]
    unstamped = pa.table({"protein_id": ["p0", "p1", "p2"], "cath": cells})
    assert FORMAT_VERSION_KEY not in (unstamped.schema.metadata or {})

    with pytest.raises(ValueError, match="no protspace_format_version stamp"):
        replace_annotations_in_bundle(src, out, unstamped)
    assert not out.exists()

    # The caller that knows its cells are v2 says so, and they survive as written.
    replace_annotations_in_bundle(src, out, upgrade_cell_grammar(unstamped, 2))
    assert read_tables(out)[0].column("cath").to_pylist() == cells


def test_write_bundle_refuses_an_unstamped_table(tmp_path):
    """An unstamped v1 table is indistinguishable from a v2 one that lost its
    metadata, so ``write_bundle`` does not pick one: the caller migrates v1
    cells explicitly, and a v2 table keeps its stamp."""
    metadata, data = projection_tables(2, (2,))
    unstamped = pa.table({"protein_id": ["p0", "p1"], "cath": ["ACC (a%3Bb)", "x"]})
    path = tmp_path / "b.parquetbundle"

    with pytest.raises(ValueError, match="no protspace_format_version stamp"):
        write_bundle([unstamped, metadata, data], path)
    assert not path.exists()

    write_bundle([stamp_format_version(unstamped), metadata, data], path)
    assert read_tables(path)[0].column("cath").to_pylist() == ["ACC (a%3Bb)", "x"]

    # The same cells, declared v1, are migrated: the literal ``%`` is escaped.
    write_bundle([upgrade_cell_grammar(unstamped, 1), metadata, data], path)
    assert read_tables(path)[0].column("cath").to_pylist() == ["ACC (a%253Bb)", "x"]


def test_write_bundle_rejects_a_fourth_table(tmp_path):
    """Untested until now: removing the guard passes the whole suite.  Without
    it the tuple unpack below still raises, but as a bare "too many values to
    unpack" naming neither the function nor what it wanted."""
    tables = pipeline_tables()
    with pytest.raises(ValueError, match="expects 3 core tables"):
        write_bundle([*tables, tables[0]], tmp_path / "b.parquetbundle")


def test_corrupt_first_part_of_a_six_part_bundle_is_a_bundle_error(tmp_path):
    """Every six-part read parses part 1's footer, ``read_settings_from_bundle``
    included -- so a corrupt part 1 must not surface as a raw ``ArrowInvalid``
    traceback out of ``protspace style --dump-settings``, which never touched
    part 1 before."""
    path = tmp_path / "b.parquetbundle"
    write_bundle(pipeline_tables(), path, settings={"k": 1})
    parts = parts_of(path)
    path.write_bytes(PARQUET_BUNDLE_DELIMITER.join([b"not parquet", *parts[1:]]))

    with pytest.raises(ValueError, match="part 1 is not readable as parquet"):
        read_settings_from_bundle(path)
    with pytest.raises(ValueError, match="part 1 is not readable as parquet"):
        read_tables(path)


def test_replace_annotations_upgrades_a_legacy_bundle(tmp_path):
    """A rewrite is a write, and every write emits v3."""
    src = tmp_path / "legacy.parquetbundle"
    out = tmp_path / "out.parquetbundle"
    legacy_bundle(src)

    replacement = stamp_format_version(
        pa.table({"protein_id": ["p0", "p1"], "cat": ["alpha", "beta"]})
    )
    replace_annotations_in_bundle(src, out, replacement)

    parts = parts_of(out)
    assert len(parts) == 6
    assert read(parts[0]).schema.metadata[FORMAT_VERSION_KEY] == b"3"
    annotations, _metadata, data = read_tables(out)
    assert annotations.column("cat").to_pylist() == ["alpha", "beta"]
    assert data.column("x").to_pylist() == [0.0, 1.0]


# --------------------------------------------------------------------------- #
# extraction
# --------------------------------------------------------------------------- #


def test_extract_v3_bundle_writes_v2_shaped_files(tmp_path):
    src = tmp_path / "b.parquetbundle"
    tables = pipeline_tables()
    write_bundle(tables, src, settings={"k": 1})

    out_dir = Path(extract_bundle_to_dir(src, tmp_path / "out"))

    extracted = [
        pq.read_table(str(out_dir / name))
        for name in (
            "selected_annotations.parquet",
            "projections_metadata.parquet",
            "projections_data.parquet",
        )
    ]
    assert extracted[0].equals(tables[0])
    assert extracted[1].equals(tables[1])
    assert extracted[2].to_pydict() == tables[2].to_pydict()
    assert extracted[0].schema.metadata[FORMAT_VERSION_KEY] == b"2"
    assert (out_dir / "settings.parquet").exists()


def test_extract_legacy_bundle_writes_the_raw_parts(tmp_path):
    src = tmp_path / "legacy.parquetbundle"
    parts = legacy_bundle(src, settings=b"")

    out_dir = Path(extract_bundle_to_dir(src, tmp_path / "out"))

    assert (out_dir / "selected_annotations.parquet").read_bytes() == parts[0]
    assert (out_dir / "projections_metadata.parquet").read_bytes() == parts[1]
    assert (out_dir / "projections_data.parquet").read_bytes() == parts[2]
    assert not (out_dir / "settings.parquet").exists()  # zero-byte slot
