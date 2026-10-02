"""A bundle never carries the internal lookup columns ``organism_id``/``sequence``.

UniProt's ``organism_id`` and ``sequence`` are fetched only to drive the taxonomy
and sequence-based lookups (``INTERNAL_ANNOTATIONS``). ``prepare`` already strips
them, but ``bundle``, ``transfer`` and the Python bundle-writing functions passed
them through, so a bundle built from the annotation cache showed them in the web
app as near-unique categorical columns. ``annotate``'s parquet is not a bundle
and keeps a column the user asked for.
"""

import io

import h5py
import numpy as np
import pandas as pd
import pyarrow as pa
import pyarrow.parquet as pq
import pytest
from typer.testing import CliRunner

from protspace.cli.app import app
from protspace.data.annotations.configuration import INTERNAL_ANNOTATIONS
from protspace.data.annotations.encoding import (
    FORMAT_VERSION_KEY,
    read_format_version,
    stamp_format_version,
)
from protspace.data.annotations.retrievers.uniprot_retriever import (
    ProteinAnnotations,
    UniProtRetriever,
)
from protspace.data.io.bundle import (
    read_bundle,
    replace_annotations_in_bundle,
    write_bundle,
)

IDS = ["P00561", "P27708"]


def _cache_shaped_annotations(id_col="protein_id"):
    """Columns as ``all_annotations.parquet`` holds them, internal ones included."""
    return pa.table(
        {
            id_col: IDS,
            "organism_id": ["562", "10036"],
            "sequence": ["MRVLKFGG", "MAALVLED"],
            "protein_families": [
                "aspartokinase family|IC;homoserine dehydrogenase family|IC",
                "CarA family|IC;CarB family|IC",
            ],
            "length": ["820", "2225"],
        }
    )


def _projections():
    meta = pa.table({"projection_name": ["PCA_2"], "dimensions": [2]})
    data = pa.table(
        {
            "projection_name": ["PCA_2", "PCA_2"],
            "identifier": IDS,
            "x": [0.0, 1.0],
            "y": [0.0, 1.0],
        }
    )
    return meta, data


def _annotations_part(bundle_path):
    parts, _ = read_bundle(bundle_path)
    return pq.read_table(io.BytesIO(parts[0]))


def _assert_internal_dropped(table, id_col="protein_id"):
    assert not set(INTERNAL_ANNOTATIONS) & set(table.column_names)
    assert table.column_names == [id_col, "protein_families", "length"]
    rows = {r[id_col]: r for r in table.to_pylist()}
    assert rows["P27708"]["protein_families"] == "CarA family|IC;CarB family|IC"
    assert rows["P00561"]["length"] == "820"


def test_internal_annotations_are_the_lookup_columns():
    assert set(INTERNAL_ANNOTATIONS) == {"organism_id", "sequence"}


def test_write_bundle_drops_internal_columns_and_keeps_the_stamp(tmp_path):
    out = tmp_path / "out.parquetbundle"
    meta, data = _projections()
    write_bundle([stamp_format_version(_cache_shaped_annotations()), meta, data], out)

    table = _annotations_part(out)
    _assert_internal_dropped(table)
    assert read_format_version(table) == 2


def test_write_bundle_still_refuses_an_unstamped_table(tmp_path):
    """Dropping the lookup columns does not stamp the grammar: v3 never guesses it."""
    out = tmp_path / "out.parquetbundle"
    meta, data = _projections()
    with pytest.raises(ValueError, match=FORMAT_VERSION_KEY.decode()):
        write_bundle([_cache_shaped_annotations(), meta, data], out)
    assert not out.exists()


def test_write_bundle_leaves_the_projection_parts_alone(tmp_path):
    out = tmp_path / "out.parquetbundle"
    meta, data = _projections()
    write_bundle([stamp_format_version(_cache_shaped_annotations()), meta, data], out)

    parts, _ = read_bundle(out)
    decoded = pq.read_table(io.BytesIO(parts[2]))
    assert decoded.select(["projection_name", "identifier", "x", "y"]).to_pylist() == (
        data.to_pylist()
    )


def test_write_bundle_without_internal_columns_is_unchanged(tmp_path):
    out = tmp_path / "out.parquetbundle"
    meta, data = _projections()
    clean = stamp_format_version(
        _cache_shaped_annotations().drop_columns(list(INTERNAL_ANNOTATIONS))
    )
    write_bundle([clean, meta, data], out)

    assert _annotations_part(out).equals(clean)


def test_bundle_cli_drops_internal_columns_from_a_cache_parquet(tmp_path):
    projections = tmp_path / "projections"
    projections.mkdir()
    meta, data = _projections()
    pq.write_table(meta, projections / "projections_metadata.parquet")
    pq.write_table(data, projections / "projections_data.parquet")
    cache = tmp_path / "all_annotations.parquet"
    pq.write_table(_cache_shaped_annotations(id_col="identifier"), cache)

    out = tmp_path / "out.parquetbundle"
    result = CliRunner().invoke(
        app,
        ["bundle", "-p", str(projections), "-a", str(cache), "-o", str(out)],
    )

    assert result.exit_code == 0, result.output
    table = _annotations_part(out)
    _assert_internal_dropped(table)
    assert read_format_version(table) == 2


def test_replace_annotations_drops_internal_columns(tmp_path):
    src = tmp_path / "in.parquetbundle"
    out = tmp_path / "out.parquetbundle"
    meta, data = _projections()
    write_bundle([stamp_format_version(pa.table({"protein_id": IDS})), meta, data], src)

    replace_annotations_in_bundle(
        src, out, stamp_format_version(_cache_shaped_annotations())
    )

    table = _annotations_part(out)
    _assert_internal_dropped(table)
    assert read_format_version(table) == 2


def _legacy_bundle_with_internal_columns(path):
    """A bundle written before the drop existed (the shipped venom bundle's shape)."""
    meta, data = _projections()
    annotations = stamp_format_version(
        _cache_shaped_annotations().append_column(
            "protein_category", pa.array(["", "enzyme"])
        )
    )
    parts = [annotations, meta, data]
    from protspace.data.io.bundle import PARQUET_BUNDLE_DELIMITER

    buffers = []
    for table in parts:
        buf = io.BytesIO()
        pq.write_table(table, buf)
        buffers.append(buf.getvalue())
    path.write_bytes(PARQUET_BUNDLE_DELIMITER.join(buffers))


def test_transfer_cli_drops_internal_columns_from_a_bundle_that_had_them(tmp_path):
    bundle = tmp_path / "in.parquetbundle"
    _legacy_bundle_with_internal_columns(bundle)
    assert "sequence" in _annotations_part(bundle).column_names  # precondition

    h5_path = tmp_path / "emb.h5"
    with h5py.File(h5_path, "w") as f:
        f.attrs["model_name"] = "test_model"
        f.create_dataset("P00561", data=np.array([1.0, 0.05], dtype=np.float32))
        f.create_dataset("P27708", data=np.array([1.0, 0.0], dtype=np.float32))

    out = tmp_path / "out.parquetbundle"
    result = CliRunner().invoke(
        app,
        [
            "transfer",
            "-b",
            str(bundle),
            "-e",
            str(h5_path),
            "-t",
            "protein_category",
            "-o",
            str(out),
        ],
    )

    assert result.exit_code == 0, result.output
    table = _annotations_part(out)
    assert not set(INTERNAL_ANNOTATIONS) & set(table.column_names)
    rows = {r["protein_id"]: r for r in table.to_pylist()}
    assert rows["P00561"]["protein_category__pred_value"] == "enzyme"
    assert rows["P27708"]["protein_families"] == "CarA family|IC;CarB family|IC"
    assert read_format_version(table) == 2


def test_annotate_keeps_a_requested_sequence_column(tmp_path, monkeypatch):
    """``annotate``'s parquet is the user's own table, not a bundle."""
    fasta = tmp_path / "input.fasta"
    fasta.write_text(">sp|P00561|AK1H_ECOLI\nMRVLKFGG\n")
    output = tmp_path / "annotations.parquet"
    monkeypatch.setattr(
        UniProtRetriever,
        "fetch_annotations",
        lambda self: [
            ProteinAnnotations(
                identifier="P00561",
                annotations={"sequence": "MRVLKFGG", "organism_id": "562"},
            )
        ],
    )

    result = CliRunner().invoke(
        app, ["annotate", "-i", str(fasta), "-a", "sequence", "-o", str(output)]
    )

    assert result.exit_code == 0, result.output
    df = pd.read_parquet(output)
    assert df.loc[0, "sequence"] == "MRVLKFGG"
    assert "organism_id" not in df.columns  # fetched, but not asked for
