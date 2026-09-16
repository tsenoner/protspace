"""Decoder half of parquetbundle format v3 (``data/io/bundle_v3.decode_v3``).

Six Python consumers (``utils/arrow_reader``, ``cli/serve``, ``cli/style`` +
``utils/add_annotation_style``, ``cli/transfer``, ``cli/bundle`` and the
``scripts/``) parse the v2 string grammar, so v3 only ever exists between
``write_bundle`` and ``read_tables``.  The contract these tests pin is therefore
``decode_v3(encode_v3(T)) == T`` on pipeline-shaped tables, plus the handful of
places where that equality is deliberately *not* exact: v3 stores what the
browser's v2 reader would have parsed out of a cell, not the cell.
"""

import io
import json
from pathlib import Path

import numpy as np
import pandas as pd
import pyarrow as pa
import pyarrow.parquet as pq
import pytest

from protlabel import Prediction
from protspace.data.annotations.encoding import (
    FORMAT_VERSION_KEY,
    stamp_format_version,
)
from protspace.data.io.bundle_v3 import MANIFEST_KEY, _flat, decode_v3, encode_v3
from protspace.data.io.predictions import add_overlay_columns
from protspace.data.processors.base_processor import BaseProcessor

REAL_BUNDLE = (
    Path(__file__).resolve().parents[3]
    / "apps"
    / "web"
    / "public"
    / "data"
    / "venom_eat_stats.parquetbundle"
)


# --------------------------------------------------------------------------- #
# helpers
# --------------------------------------------------------------------------- #


def annotations_table(**columns: list[str]) -> pa.Table:
    """An annotations table exactly as the pipeline builds it (all-string, v2)."""
    n = len(next(iter(columns.values())))
    frame = pd.DataFrame({"identifier": [f"p{i}" for i in range(n)], **columns})
    return BaseProcessor({}, {})._create_protein_annotations_table(frame)


def projection_tables(num_rows: int, dimensions=(2, 3)):
    """``projections_metadata`` + long ``projections_data`` for ``num_rows`` proteins."""
    processor = BaseProcessor({}, {})
    reductions = [
        {
            "name": f"PCA {dimension}",
            "dimensions": dimension,
            "info": {"components": dimension},
            "data": np.arange(num_rows * dimension, dtype=np.float32).reshape(
                num_rows, dimension
            ),
        }
        for dimension in dimensions
    ]
    headers = [f"p{i}" for i in range(num_rows)]
    return (
        processor._create_projections_metadata_table(reductions),
        processor._create_projections_data_table(reductions, headers),
    )


def round_trip(annotations: pa.Table, dimensions=(2, 3)):
    """Encode then decode ``annotations`` with matching projections."""
    metadata, data = projection_tables(annotations.num_rows, dimensions)
    return decode_v3(encode_v3(annotations, metadata, data))


def cells(annotations: pa.Table, column: str, dimensions=(2, 3)) -> list:
    return round_trip(annotations, dimensions)[0].column(column).to_pylist()


# --------------------------------------------------------------------------- #
# the round trip on pipeline-shaped tables
# --------------------------------------------------------------------------- #


def pipeline_annotations() -> pa.Table:
    """Every cell shape the encoder dispatches on, in one pipeline-built table."""
    table = annotations_table(
        # plain categorical, and one all-empty column
        kingdom=["Bacteria", "Archaea", "Bacteria", "Eukaryota", "Archaea", "Bacteria"],
        unknown=["", "", "", "", "", ""],
        # multi + scores, with zero hits first, interior and last, and labels
        # carrying the encoded ';' and '|' the v2 grammar reserves
        pfam=[
            "",
            "PF00001 (7tm%3B1)|1e-10,2.5;PF00002|0.5",
            "",
            "PF00001 (7tm%3B1)|0.25",
            "PF00003 (a%7Cb)|3;PF00004",
            "",
        ],
        # multi + evidence
        go_mf=[
            "GO:0005524|IDA",
            "",
            "GO:0005524|IDA;GO:0016787|ECO:0000269",
            "GO:0016787|IEA",
            "",
            "GO:0005524|IDA",
        ],
        # numeric int with blanks, numeric float
        length=["100", "", "250", "", "3000", "42"],
        annotation_score=["0.5", "1.25", "", "0.5", "2.0", "0.125"],
    )
    return overlay(table, range(table.num_rows))


def overlay(table: pa.Table, predicted) -> pa.Table:
    """Attach EAT ``ec__pred_*`` companions for the given row indices."""
    predictions = [
        Prediction(
            query_id=f"p{i}",
            label="3.4.21.- (Serine endopeptidases)",
            source_id="P20005",
            distance=0.5,
            reliability=0.35313386,
            k=1,
            metric="euclidean",
        )
        for i in predicted
    ]
    return add_overlay_columns(
        table,
        "ec",
        predictions,
        identifiers=table.column("protein_id").to_pylist(),
    )


def test_pipeline_round_trip_is_cell_for_cell():
    source = pipeline_annotations()
    metadata, data = projection_tables(source.num_rows)
    decoded, decoded_metadata, decoded_data = decode_v3(
        encode_v3(source, metadata, data)
    )

    assert decoded.column_names == source.column_names
    for name in source.column_names:
        assert decoded.column(name).to_pylist() == source.column(name).to_pylist(), name
    assert decoded.equals(source)

    assert decoded_metadata.equals(metadata)
    assert decoded_data.to_pydict() == data.to_pydict()


def test_a_partial_eat_overlay_keeps_null_confidences_but_blanks_the_strings():
    """float32 nulls survive ``sourceType``; string nulls hit the one missing code."""
    source = overlay(annotations_table(kingdom=["A", "B"]), [1])
    decoded = round_trip(source, (2,))[0]
    assert decoded.schema.field("ec__pred_confidence").type == pa.float32()
    assert decoded.column("ec__pred_confidence").to_pylist() == [
        None,
        pytest.approx(0.35313386),
    ]
    assert decoded.column("ec__pred_source").to_pylist() == ["", "P20005"]


def test_footer_says_two_and_the_manifest_key_is_gone():
    source = pipeline_annotations()
    decoded = round_trip(source)[0]
    assert decoded.schema.metadata[FORMAT_VERSION_KEY] == b"2"
    assert MANIFEST_KEY not in decoded.schema.metadata
    # ``stamp_format_version`` merges, so the pandas key the pipeline wrote lives on.
    assert decoded.schema.metadata == source.schema.metadata


def test_decoded_fields_are_nullable_again():
    """Part 1 is written REQUIRED for hyparquet; a v2-shaped table is not."""
    decoded = round_trip(pipeline_annotations())[0]
    assert all(field.nullable for field in decoded.schema)


# --------------------------------------------------------------------------- #
# projections
# --------------------------------------------------------------------------- #


def test_projections_are_long_manifest_ordered_and_protein_ordered():
    source = annotations_table(kingdom=["A", "B", "C"])
    metadata, data = projection_tables(3, (2, 3))
    _, decoded_metadata, decoded_data = decode_v3(encode_v3(source, metadata, data))

    assert decoded_metadata.column("projection_name").to_pylist() == ["PCA 2", "PCA 3"]
    columns = decoded_data.to_pydict()
    assert columns["projection_name"] == ["PCA 2"] * 3 + ["PCA 3"] * 3
    assert columns["identifier"] == ["p0", "p1", "p2"] * 2
    assert columns["x"] == [0.0, 2.0, 4.0, 0.0, 3.0, 6.0]
    assert columns["z"] == [None, None, None, 2.0, 5.0, 8.0]
    assert decoded_data.schema.field("z").type == pa.float32()


def test_a_protein_absent_from_a_projection_comes_back_at_the_origin():
    """v2's zero-initialised Float32Array is the contract, not NaN."""
    source = annotations_table(kingdom=["A", "B", "C"])
    metadata, data = projection_tables(3, (2,))
    data = data.filter(pa.compute.not_equal(data.column("identifier"), pa.scalar("p1")))
    decoded_data = decode_v3(encode_v3(source, metadata, data))[2]
    assert decoded_data.to_pydict()["x"] == [0.0, 0.0, 4.0]


# --------------------------------------------------------------------------- #
# numeric restoration
# --------------------------------------------------------------------------- #


def test_source_type_restores_non_string_numeric_columns():
    source = stamp_format_version(
        pa.table(
            {
                "protein_id": ["p0", "p1", "p2"],
                "length": pa.array([10, None, 30], type=pa.int32()),
                "confidence": pa.array([0.5, 1.5, None], type=pa.float32()),
            }
        )
    )
    decoded = round_trip(source, (2,))[0]
    assert decoded.schema.field("length").type == pa.int32()
    assert decoded.schema.field("confidence").type == pa.float32()
    assert decoded.column("length").to_pylist() == [10, None, 30]
    assert decoded.column("confidence").to_pylist() == [0.5, 1.5, None]


def test_int_columns_never_come_back_with_a_decimal_point():
    assert cells(annotations_table(length=["100", "", "3"]), "length") == [
        "100",
        "",
        "3",
    ]


def test_float_columns_keep_the_python_float_spelling():
    values = ["1.5", "2.0", "1e-10", ""]
    assert cells(annotations_table(score=values), "score") == values


def test_an_unrestorable_source_type_falls_back_to_strings():
    """``str(dictionary<...>)`` is no alias, so the v2 spelling is the fallback."""
    source = stamp_format_version(
        pa.table(
            {
                "protein_id": ["p0", "p1"],
                "species": pa.array(["Human", "Mouse"]).dictionary_encode(),
            }
        )
    )
    decoded = round_trip(source, (2,))[0]
    assert decoded.schema.field("species").type == pa.string()
    assert decoded.column("species").to_pylist() == ["Human", "Mouse"]


# --------------------------------------------------------------------------- #
# deliberate non-identities
# --------------------------------------------------------------------------- #


def test_hits_and_cells_are_trimmed_and_empty_hits_collapse():
    table = annotations_table(pfam=[" A ;B ", "A;;B", "A; ;B"])
    assert cells(table, "pfam") == ["A;B", "A;B", "A;B"]


def test_only_null_and_blank_cells_come_back_as_the_empty_string():
    """``none``/``NA``/``null`` are labels, not missing values.

    ``protspace style`` resolves a legend entry by its literal cell value, so
    collapsing these would delete a real category (1383 of the 1587
    ``phosphatase.predicted_transmembrane`` rows are literally ``none``).
    """
    table = annotations_table(col=["A", "NA", "n/a", "None", "__NA__", "  "])
    assert cells(table, "col") == ["A", "NA", "n/a", "None", "__NA__", ""]


def test_null_cells_come_back_as_the_empty_string():
    """v3 has one missing code, so a null and a blank are the same cell."""
    source = stamp_format_version(
        pa.table({"protein_id": ["p0", "p1"], "col": ["A", None]})
    )
    assert round_trip(source, (2,))[0].column("col").to_pylist() == ["A", ""]


def test_a_raw_pipe_in_a_label_comes_back_percent_encoded():
    """v2 requires ``|`` inside a label to be escaped; decode emits the legal form."""
    table = annotations_table(col=["PF3 (a|b)|0.5"])
    assert cells(table, "col") == ["PF3 (a%7Cb)|0.5"]


def test_percent_encoding_is_normalised_to_upper_case():
    table = annotations_table(col=["a%3bb|0.5", "a%3Bb|0.5"])
    assert cells(table, "col") == ["a%3Bb|0.5", "a%3Bb|0.5"]


def test_an_unscored_hit_in_a_scored_column_keeps_no_suffix():
    """``score_count`` is per hit, so a bare hit must not gain a dangling ``|``."""
    table = annotations_table(col=["PF1|0.5;PF2", "PF3"])
    assert cells(table, "col") == ["PF1|0.5;PF2", "PF3"]


def test_scores_round_trip_through_float64():
    table = annotations_table(col=["A|0.5700", "A|1", "A|0.1", "A|1e-10,2.5"])
    # 0.5700 loses its trailing zero (a float has no such notion) and an integral
    # score keeps the JavaScript spelling ``[1].join(',') === '1'``.
    assert cells(table, "col") == ["A|0.57", "A|1", "A|0.1", "A|1e-10,2.5"]


def test_e_values_survive_the_round_trip():
    """float32 scores would spell these ``0``, ``0``, ``inf`` and ``1.2345679e+08``."""
    table = annotations_table(col=["A|1e-200", "A|1e-300", "A|1e40", "A|123456789"])
    assert cells(table, "col") == [
        "A|1e-200",
        "A|1e-300",
        "A|1e+40",
        "A|123456789",
    ]


def test_an_int_column_re_spells_its_cells_canonically():
    table = annotations_table(col=["1", "2.0", "+3", "4e1"])
    assert cells(table, "col") == ["1", "2", "3", "40"]


def test_an_int_past_the_int64_range_only_re_spells_itself():
    """The magnitude guard is per value: one huge cell is not a column-wide float."""
    table = annotations_table(col=["100", "250", "10000000000000000000"])
    assert cells(table, "col") == ["100", "250", "1e+19"]


def test_a_large_string_column_comes_back_as_its_v2_spelling():
    """``large_string`` is a parseable alias but not a numeric type to restore."""
    source = stamp_format_version(
        pa.table(
            {
                "protein_id": ["p0", "p1"],
                "length": pa.array(["100", "200"], type=pa.large_string()),
            }
        )
    )
    decoded = round_trip(source, (2,))[0]
    assert (
        json.loads(
            pq.read_table(
                io.BytesIO(encode_v3(source, *projection_tables(2, (2,)))[0])
            ).schema.metadata[MANIFEST_KEY]
        )["columns"]["length"]["sourceType"]
        == "large_string"
    )
    assert decoded.schema.field("length").type == pa.string()
    assert decoded.column("length").to_pylist() == ["100", "200"]


def test_a_bool_column_comes_back_as_the_python_spelling():
    """``sourceType`` restoration is numeric-only; a bool stays v2's ``True``/``False``."""
    source = stamp_format_version(
        pa.table({"protein_id": ["p0", "p1"], "flag": [True, False]})
    )
    decoded = round_trip(source, (2,))[0]
    assert decoded.schema.field("flag").type == pa.string()
    assert decoded.column("flag").to_pylist() == ["True", "False"]


# --------------------------------------------------------------------------- #
# guards
# --------------------------------------------------------------------------- #


def test_rejects_a_part_list_that_is_not_the_encoder_output():
    with pytest.raises(ValueError, match="expects the 4 parts"):
        decode_v3([b"", b"", b""])


def test_rejects_an_annotations_part_without_a_manifest():
    source = annotations_table(col=["A", "B"])
    parts = list(encode_v3(source, *projection_tables(2, (2,))))
    without = pq.read_table(io.BytesIO(parts[0])).replace_schema_metadata(
        {FORMAT_VERSION_KEY: b"3"}
    )
    buffer = io.BytesIO()
    pq.write_table(without, buffer)
    parts[0] = buffer.getvalue()
    with pytest.raises(ValueError, match="not a v3 part"):
        decode_v3(parts)


def test_rejects_an_unknown_kind():
    source = annotations_table(col=["A", "B"])
    parts = list(encode_v3(source, *projection_tables(2, (2,))))
    table = pq.read_table(io.BytesIO(parts[0]))
    manifest = json.loads(table.schema.metadata[MANIFEST_KEY])
    manifest["columns"]["col"]["kind"] = "sparse"
    buffer = io.BytesIO()
    pq.write_table(
        table.replace_schema_metadata(
            {**table.schema.metadata, MANIFEST_KEY: json.dumps(manifest).encode()}
        ),
        buffer,
    )
    parts[0] = buffer.getvalue()
    with pytest.raises(ValueError, match="unknown v3 kind"):
        decode_v3(parts)


# --------------------------------------------------------------------------- #
# corrupt payloads (a v3 bundle is user-supplied input)
# --------------------------------------------------------------------------- #


def rewrite(part: bytes, edit) -> bytes:
    """Read a part, hand the table to ``edit``, write the result back."""
    buffer = io.BytesIO()
    pq.write_table(edit(pq.read_table(io.BytesIO(part))), buffer)
    return buffer.getvalue()


def corrupt_payload(parts: list[bytes], name: str, data: bytes) -> list[bytes]:
    """Replace one payload row of part 6."""

    def edit(table):
        names = table.column("name").to_pylist()
        blobs = table.column("data").to_pylist()
        blobs[names.index(name)] = data
        return pa.table({"name": names, "data": blobs})

    return [*parts[:3], rewrite(parts[3], edit)]


def encoded(**columns: list[str]) -> list[bytes]:
    source = annotations_table(**columns)
    return list(encode_v3(source, *projection_tables(source.num_rows, (2,))))


def test_rejects_label_lengths_that_do_not_tile_the_blob():
    """Python slicing clamps, so this would yield duplicated and empty labels."""
    parts = corrupt_payload(
        encoded(col=["Alpha", "Beta", "Gamma"]),
        "dict:col:len",
        np.array([100, 100, 100], dtype="<i4").tobytes(),
    )
    with pytest.raises(ValueError, match="dict:col:len' is corrupt"):
        decode_v3(parts)


def test_rejects_a_negative_label_length():
    parts = corrupt_payload(
        encoded(col=["Alpha", "Beta"]),
        "dict:col:len",
        np.array([-4, 13], dtype="<i4").tobytes(),
    )
    with pytest.raises(ValueError, match="dict:col:len' is corrupt"):
        decode_v3(parts)


def test_rejects_score_counts_that_do_not_tile_the_scores():
    """A short total silently empties the tail cells instead of raising."""
    parts = corrupt_payload(
        encoded(col=["A|0.5;B|0.25", "C|1"]),
        "score_count:col",
        np.array([1, 1, 0], dtype="<i4").tobytes(),
    )
    with pytest.raises(ValueError, match="score_count:col' is corrupt"):
        decode_v3(parts)


def test_rejects_hit_counts_that_do_not_tile_the_codes():
    parts = encoded(col=["A|0.5;B|0.25", "C|1"])
    parts[0] = rewrite(
        parts[0],
        lambda table: table.set_column(
            table.schema.get_field_index("col__count"),
            "col__count",
            pa.array([1, 1], type=pa.int32()),
        ),
    )
    with pytest.raises(ValueError, match=r"col__count' is corrupt"):
        decode_v3(parts)


def test_rejects_a_negative_hit_count():
    """A negative count keeps the total right but misaligns every later row."""
    parts = encoded(col=["A;B;C", "D"])
    parts[0] = rewrite(
        parts[0],
        lambda table: table.set_column(
            table.schema.get_field_index("col__count"),
            "col__count",
            pa.array([-1, 5], type=pa.int32()),
        ),
    )
    with pytest.raises(ValueError, match=r"col__count' is corrupt"):
        decode_v3(parts)


def test_flat_concatenates_a_multi_chunk_column():
    """Every v3 part is one row group, but a >2 GB column reads back chunked."""
    chunked = pa.chunked_array(
        [pa.array([1, 2], type=pa.int32()), pa.array([3], type=pa.int32())]
    )
    assert _flat(chunked).to_pylist() == [1, 2, 3]
    assert isinstance(_flat(chunked), pa.Array)


# --------------------------------------------------------------------------- #
# the real shipped bundle
# --------------------------------------------------------------------------- #


@pytest.mark.skipif(not REAL_BUNDLE.exists(), reason="web sample data not checked out")
def test_real_bundle_round_trip():
    """``venom_eat_stats`` (v2, 811 x 38) end to end, with its non-identities named.

    Every column that is not byte-identical is one of the two documented losses,
    and nothing else drifts: 4 cluster columns whose ``%.4f`` scores lose a
    trailing zero to float32, and 4 all-or-partly-null overlay columns whose
    nulls become ``""``.
    """
    parts = REAL_BUNDLE.read_bytes().split(b"---PARQUET_DELIMITER---")
    source = pq.read_table(io.BytesIO(parts[0]))
    metadata = pq.read_table(io.BytesIO(parts[1]))
    data = pq.read_table(io.BytesIO(parts[2]))

    decoded, decoded_metadata, decoded_data = decode_v3(
        encode_v3(source, metadata, data)
    )
    assert decoded.column_names == source.column_names
    assert decoded.schema.metadata == source.schema.metadata

    differing = {
        name
        for name in source.column_names
        if decoded.column(name).to_pylist() != source.column(name).to_pylist()
    }
    assert differing == {
        "cluster_elbow_ProtT5 — PCA 2",
        "cluster_silhouette_ProtT5 — PCA 2",
        "cluster_elbow_ProtT5 — UMAP 2",
        "cluster_silhouette_ProtT5 — UMAP 2",
        "ec__pred_value",
        "ec__pred_source",
        "protein_families__pred_value",
        "protein_families__pred_source",
    }
    for name in differing:
        for before, after in zip(
            source.column(name).to_pylist(),
            decoded.column(name).to_pylist(),
            strict=True,
        ):
            if before == after:
                continue
            if before is None:
                assert after == ""  # the null / blank collapse
            else:  # "cluster 4|0.5700" -> "cluster 4|0.57"
                label, _, score = before.rpartition("|")
                assert after == f"{label}|{float(score):g}"

    assert decoded_metadata.equals(metadata)
    assert decoded_data.to_pydict() == data.to_pydict()
