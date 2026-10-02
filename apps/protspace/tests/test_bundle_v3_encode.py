"""Encoder half of parquetbundle format v3 (``data/io/bundle_v3.encode_v3``).

The assertions here pin the two contracts the encoder has to honour:

* the *physical* contract that makes the browser's zero-copy read possible
  (non-nullable, PLAIN, one row group, little-endian payload buffers), and
* the *semantic* contract that a v3 bundle must classify and order categories
  exactly like the browser's v2 reader (``conversion.ts``), so both paths
  produce the same colours and legend.
"""

import io

import numpy as np
import pandas as pd
import pyarrow as pa
import pyarrow.compute as pc
import pyarrow.parquet as pq
import pytest

from protspace.data.annotations.encoding import (
    FORMAT_VERSION_KEY,
    migrate_legacy_annotation_table,
    read_format_version,
    stamp_format_version,
)
from protspace.data.io.bundle_v3 import CONTAINER_VERSION_KEY, decode_v3, encode_v3
from tests.bundle_v3_helpers import labels_of, manifest_of, payloads_of, read


def make_annotations(**columns: list) -> pa.Table:
    """Annotations table shaped like ``BaseProcessor._create_protein_annotations_table``."""
    n = len(next(iter(columns.values())))
    data = {"protein_id": [f"p{i}" for i in range(n)], **columns}
    return stamp_format_version(pa.table(data))


def make_projections(names_dims=(("A", 2),), ids=None):
    ids = ids or ["p0"]
    meta = pa.table(
        {
            "projection_name": [n for n, _ in names_dims],
            "dimensions": [d for _, d in names_dims],
            "info_json": ["{}"] * len(names_dims),
            "source": [""] * len(names_dims),
        }
    )
    rows = []
    for name, dim in names_dims:
        for i, pid in enumerate(ids):
            rows.append(
                {
                    "projection_name": name,
                    "identifier": pid,
                    "x": float(i),
                    "y": float(-i),
                    "z": float(i * 2) if dim == 3 else None,
                }
            )
    frame = pd.DataFrame(rows).astype({"x": "float32", "y": "float32", "z": "float32"})
    return meta, pa.Table.from_pandas(frame)


def encode(annotations: pa.Table, names_dims=(("A", 2),)):
    """Encode ``annotations`` with matching projections; return the four parts."""
    ids = annotations.column("protein_id").to_pylist()
    meta, data = make_projections(names_dims, ids)
    return encode_v3(annotations, meta, data)


# --------------------------------------------------------------------------- #
# physical layout
# --------------------------------------------------------------------------- #


def test_parts_and_footer():
    parts = encode(
        make_annotations(kingdom=["Bacteria", "Archaea"]), (("A", 2), ("B", 3))
    )
    assert len(parts) == 4
    part1 = read(parts[0])
    assert part1.schema.metadata[CONTAINER_VERSION_KEY] == b"3"
    # The grammar stamp is not carried over: a v3 part 1 has no cells to parse.
    assert FORMAT_VERSION_KEY not in part1.schema.metadata
    assert part1.column_names == ["protein_id", "kingdom"]
    assert read(parts[1]).column("projection_name").to_pylist() == ["A", "B"]
    assert read(parts[2]).column_names == ["A__x", "A__y", "B__x", "B__y", "B__z"]
    assert read(parts[2]).schema.field("A__x").type == pa.float32()


def test_manifest_contents():
    parts = encode(
        make_annotations(
            kingdom=["Bacteria", "Archaea"],
            pfam=["PF1|0.5;PF2", "PF1"],
            loc=["Cyto|IDA", "Nuc"],
            length=["10", "20"],
        ),
        (("A", 2), ("B", 3)),
    )
    manifest = manifest_of(parts[0])
    assert manifest["idColumn"] == "protein_id"
    assert manifest["projections"] == [
        {"name": "A", "dimension": 2},
        {"name": "B", "dimension": 3},
    ]
    assert manifest["columns"] == {
        "kingdom": {"kind": "categorical", "sourceType": "string"},
        "pfam": {"kind": "multi", "sourceType": "string", "scores": True},
        "loc": {"kind": "multi", "sourceType": "string", "evidence": True},
        "length": {"kind": "numeric", "numericType": "int", "sourceType": "string"},
    }


@pytest.mark.parametrize("part_index", [0, 2, 3])
def test_parts_are_required_plain_single_row_group(part_index):
    """hyparquet only returns typed arrays for REQUIRED flat PLAIN columns."""
    parts = encode(
        make_annotations(
            kingdom=["Bacteria", "Archaea"],
            pfam=["PF1|0.5;PF2", "PF1"],
            length=["10", "20"],
        )
    )
    part = parts[part_index]
    assert all(not field.nullable for field in read(part).schema)
    metadata = pq.read_metadata(io.BytesIO(part))
    assert metadata.num_row_groups == 1
    for column in range(metadata.num_columns):
        assert set(metadata.row_group(0).column(column).encodings) <= {"PLAIN", "RLE"}


def test_source_type_records_non_string_arrow_types():
    table = stamp_format_version(
        pa.table(
            {
                "protein_id": ["p0", "p1"],
                "length": pa.array([10, 20], type=pa.int32()),
                "conf": pa.array([0.5, 1.5], type=pa.float32()),
                "flag": pa.array([True, False]),
            }
        )
    )
    columns = manifest_of(encode(table)[0])["columns"]
    assert columns["length"] == {
        "kind": "numeric",
        "numericType": "int",
        "sourceType": "int32",
    }
    assert columns["conf"]["sourceType"] == "float"
    assert columns["flag"] == {"kind": "categorical", "sourceType": "bool"}
    assert pa.type_for_alias(columns["conf"]["sourceType"]) == pa.float32()


def test_source_type_marks_types_that_cannot_be_restored():
    """``str(dictionary<...>)`` is no alias, so record the marker, not the spelling."""
    table = stamp_format_version(
        pa.table(
            {
                "protein_id": ["p0", "p1"],
                "species": pa.array(["Human", "Mouse"]).dictionary_encode(),
            }
        )
    )
    parts = encode(table)
    assert manifest_of(parts[0])["columns"]["species"] == {
        "kind": "categorical",
        "sourceType": "?",
    }
    assert labels_of(payloads_of(parts[3]), "species") == ["Human", "Mouse"]


# --------------------------------------------------------------------------- #
# semantics mirrored from conversion.ts
# --------------------------------------------------------------------------- #


def test_code_order_is_frequency_then_first_occurrence():
    # counts: rare=1, common=3, tie_b=2, tie_a=2 (tie_b appears first).
    table = make_annotations(
        col=["rare", "common", "tie_b", "tie_a", "common", "tie_b", "tie_a", "common"]
    )
    parts = encode(table)
    assert labels_of(payloads_of(parts[3]), "col") == [
        "common",
        "tie_b",
        "tie_a",
        "rare",
    ]
    assert read(parts[0]).column("col").to_pylist() == [3, 0, 1, 2, 0, 1, 2, 0]


def test_only_blank_cells_are_minus_one():
    """A cell literally spelled ``none`` is a category, not a missing value.

    v3 is a container encoding: collapsing the ``BROWSER_MISSING_TOKENS`` spellings
    would rewrite the data (``phosphatase.predicted_transmembrane`` is 1383 of
    1587 rows of literal ``none``, and ``protspace style`` keys on that label).
    The browser still folds them into NA at read time, on v2 and v3 alike.
    """
    table = make_annotations(col=["A", "", "NA", "n/a", "None", "__NA__", "  ", "A"])
    parts = encode(table)
    assert labels_of(payloads_of(parts[3]), "col") == [
        "A",
        "NA",
        "n/a",
        "None",
        "__NA__",
    ]
    assert read(parts[0]).column("col").to_pylist() == [0, -1, 1, 2, 3, 4, -1, 0]


def test_missing_tokens_only_gate_numeric_inference():
    """``BROWSER_MISSING_TOKENS`` has exactly one job: keeping ``NA`` non-numeric."""
    parts = encode(make_annotations(col=["1", "NA", "none"]))
    assert manifest_of(parts[0])["columns"]["col"]["kind"] == "numeric"

    # ...so a column made only of them cannot become an all-NaN numeric column,
    # and lands in the categorical path with its spellings intact.
    parts = encode(make_annotations(col=["NA", "none", "NA"]))
    assert manifest_of(parts[0])["columns"]["col"]["kind"] == "categorical"
    assert labels_of(payloads_of(parts[3]), "col") == ["NA", "none"]


def test_scored_multi_column_csr_and_payloads():
    table = make_annotations(pfam=["PF1|1e-10,2.5;PF2|0.5", "PF1|1.0", "", "PF3"])
    parts = encode(table)
    payloads = payloads_of(parts[3])
    assert labels_of(payloads, "pfam") == ["PF1", "PF2", "PF3"]
    assert read(parts[0]).column("pfam__count").to_pylist() == [2, 1, 0, 1]
    assert list(np.frombuffer(payloads["csr:pfam"], "<i4")) == [0, 1, 0, 2]
    # score_count is per HIT (4 hits), not per row, so unscored PF3 contributes 0.
    assert list(np.frombuffer(payloads["score_count:pfam"], "<i4")) == [2, 1, 1, 0]
    scores = np.frombuffer(payloads["scores:pfam"], "<f8")
    assert scores == pytest.approx([1e-10, 2.5, 0.5, 1.0], rel=1e-6)
    assert "evidence:pfam" not in payloads


def test_scores_are_float64_so_e_values_survive():
    """float32 would flush ``1e-200`` to 0 and overflow ``1e40`` to ``inf``.

    ``inf`` is not valid v2 either, so a float32 store would make a second round
    trip re-classify the hit and spell the cell ``A%7Cinf``.  E-values are the
    canonical Pfam and InterPro score, so the payload is float64.
    """
    table = make_annotations(col=["A|1e-200,1e-300", "A|1e40", "A|123456789"])
    payloads = payloads_of(encode(table)[3])
    assert list(np.frombuffer(payloads["scores:col"], "<f8")) == [
        1e-200,
        1e-300,
        1e40,
        123456789.0,
    ]


def test_evidence_column_uses_the_global_dictionary():
    table = make_annotations(
        loc=["Cyto|IDA;Nuc|ECO:0000269", "Cyto|EXP", "Nuc"],
        other=["X|IDA", "Y", "Z"],
    )
    parts = encode(table)
    payloads = payloads_of(parts[3])
    assert labels_of(payloads, "__evidence") == ["IDA", "ECO:0000269", "EXP"]
    assert list(np.frombuffer(payloads["evidence:loc"], "<i4")) == [0, 1, 2, -1]
    assert list(np.frombuffer(payloads["evidence:other"], "<i4")) == [0, -1, -1]
    assert read(parts[0]).column("loc__count").to_pylist() == [2, 1, 1]


def test_single_hit_scored_column_is_multi():
    """``maxValuesPerProtein <= 1`` is not enough: scores force list storage."""
    columns = manifest_of(encode(make_annotations(col=["A|0.5", "B|0.25"]))[0])[
        "columns"
    ]
    assert columns["col"]["kind"] == "multi"
    assert columns["col"]["scores"] is True

    columns = manifest_of(encode(make_annotations(col=["A|IDA", "B|IDA"]))[0])[
        "columns"
    ]
    assert columns["col"] == {"kind": "multi", "sourceType": "string", "evidence": True}

    columns = manifest_of(encode(make_annotations(col=["A", "B"]))[0])["columns"]
    assert columns["col"]["kind"] == "categorical"


def test_labels_are_percent_decoded():
    table = make_annotations(col=["a%3Bb|0.5", "a%3bb|0.5", "c%7Cd"])
    parts = encode(table)
    payloads = payloads_of(parts[3])
    # %3B and %3b decode to the same label, so they collapse to one code.
    assert labels_of(payloads, "col") == ["a;b", "c|d"]
    assert list(np.frombuffer(payloads["csr:col"], "<i4")) == [0, 0, 1]


def test_hit_without_a_recognised_suffix_keeps_the_whole_string():
    table = make_annotations(col=["GO:0005524|ATP binding", "x|", "y|not_a_code"])
    labels = labels_of(payloads_of(encode(table)[3]), "col")
    assert set(labels) == {"GO:0005524|ATP binding", "x|", "y|not_a_code"}


def test_hit_is_split_on_the_last_pipe():
    """A ``|`` inside the label stays there: only the LAST one opens a suffix."""
    table = make_annotations(col=["GO:1|ATP binding|0.5", "GO:1|ATP binding|0.25"])
    payloads = payloads_of(encode(table)[3])
    assert labels_of(payloads, "col") == ["GO:1|ATP binding"]
    assert np.frombuffer(payloads["scores:col"], "<f8") == pytest.approx([0.5, 0.25])


def test_label_is_trimmed_before_it_becomes_a_category():
    """``"Cytoplasm |IDA"`` must not fork a category on its trailing space."""
    payloads = payloads_of(
        encode(make_annotations(col=["Cytoplasm |IDA", "Cyto|IDA"]))[3]
    )
    assert labels_of(payloads, "col") == ["Cytoplasm", "Cyto"]


def test_bool_cells_use_the_browser_spelling():
    """The v2 browser reader displayed a ``BOOLEAN`` column as ``true``/``false``.

    Legend colours saved against a v2 bundle are keyed on that spelling, so a
    v3 write that said ``True``/``False`` would silently drop them.
    """
    table = stamp_format_version(
        pa.table({"protein_id": ["p0", "p1", "p2"], "flag": [True, False, None]})
    )
    parts = encode(table)
    assert labels_of(payloads_of(parts[3]), "flag") == ["true", "false"]
    assert read(parts[0]).column("flag").to_pylist() == [0, 1, -1]


# --------------------------------------------------------------------------- #
# numeric inference (must match the browser)
# --------------------------------------------------------------------------- #


@pytest.mark.parametrize(
    ("values", "kind", "numeric_type"),
    [
        (["1", "2", "3"], "numeric", "int"),
        (["1.5", "2", ""], "numeric", "float"),
        (["1", "2.0", "3"], "numeric", "int"),  # Number.isInteger(2.0) is true
        (["+1", ".5", "1e3"], "numeric", "float"),
        (["1", "NA", "N/A", "None", "__NA__", "nan", "null"], "numeric", "int"),
        (["1;2", "3"], "multi", None),  # ';' blocks numeric parsing
        (["1|2", "3"], "multi", None),  # '|' blocks numeric parsing
        (["0x10", "1"], "categorical", None),  # documented deviation from Number()
        (["1e999", "1"], "categorical", None),  # Infinity is not finite
        (["", "NA", "none"], "categorical", None),  # no numeric value seen at all
        (["abc", "1"], "categorical", None),
    ],
)
def test_numeric_inference(values, kind, numeric_type):
    columns = manifest_of(encode(make_annotations(col=values))[0])["columns"]
    assert columns["col"]["kind"] == kind
    assert columns["col"].get("numericType") == numeric_type


def test_numeric_column_uses_nan_for_missing():
    parts = encode(make_annotations(col=["1", "NA", "3"]))
    values = read(parts[0]).column("col").to_pylist()
    assert values[0] == 1.0 and values[2] == 3.0
    assert np.isnan(values[1])
    assert read(parts[0]).schema.field("col").type == pa.float64()


# --------------------------------------------------------------------------- #
# payload buffers
# --------------------------------------------------------------------------- #


def test_payload_buffers_are_little_endian():
    parts = encode(make_annotations(col=["A|0.5;B|0.5", "A|0.5"]))
    payloads = payloads_of(parts[3])
    assert payloads["csr:col"] == b"\x00\x00\x00\x00\x01\x00\x00\x00\x00\x00\x00\x00"
    assert (
        np.frombuffer(payloads["scores:col"], "<f4").tobytes() == payloads["scores:col"]
    )
    for name, blob in payloads.items():
        if name.startswith("dict:") and not name.endswith(":len"):
            continue
        assert len(blob) % 4 == 0, name


def test_projection_rows_align_to_part_one_and_missing_is_nan():
    """A protein absent from a projection is NaN there, never the origin."""
    annotations = make_annotations(col=["A", "B", "C"])
    meta, data = make_projections((("A", 3),), ["p2", "p0"])
    parts = encode_v3(annotations, meta, data)
    projections = read(parts[2]).to_pydict()
    # Part 1 follows the projection rows (p2, p0), then the unprojected p1.
    assert read(parts[0]).column("protein_id").to_pylist() == ["p2", "p0", "p1"]
    assert projections["A__x"][0] == 0.0  # p2 is the first row, and really at 0.0
    assert projections["A__x"][1] == 1.0  # p0 is the second row of the long table
    # p1 is absent from the projection, and so is every one of its axes.
    assert all(np.isnan(projections[f"A__{axis}"][2]) for axis in "xyz")
    # Still one row per protein: the annotation-only protein stays in part 1,
    # and its annotations moved with it.
    assert labels_of(payloads_of(parts[3]), "col") == ["C", "A", "B"]
    assert read(parts[0]).column("col").to_pylist() == [0, 1, 2]


def test_part_one_rows_follow_the_projection_rows_as_the_v2_browser_did():
    """The v2 browser listed proteins in order of first appearance in the
    projection rows, and broke every frequency tie in that order.  Part 1's row
    order breaks the ties in v3, so an annotations table sorted otherwise must
    not change the legend order, the default colours or the dataset hash."""
    annotations = stamp_format_version(
        pa.table(
            {
                "protein_id": ["P4", "P3", "P2", "P1"],
                "family": ["D", "C", "B", "A"],
                "kingdom": ["y", "y", "x", "x"],
            }
        )
    )
    meta, data = make_projections((("A", 2), ("B", 2)), ["P1", "P2", "P3", "P4"])
    parts = encode_v3(annotations, meta, data)

    part1 = read(parts[0])
    assert part1.column("protein_id").to_pylist() == ["P1", "P2", "P3", "P4"]
    payloads = payloads_of(parts[3])
    assert labels_of(payloads, "family") == ["A", "B", "C", "D"]
    assert labels_of(payloads, "kingdom") == ["x", "y"]
    assert part1.column("kingdom").to_pylist() == [0, 0, 1, 1]
    assert read(parts[2]).column("A__x").to_pylist() == [0.0, 1.0, 2.0, 3.0]
    # The metadata survives the reorder, so the table stays declared v2.
    assert read_format_version(decode_v3(list(parts))[0]) == 2


def test_projections_follow_the_projection_rows_as_the_v2_browser_did():
    """The v2 browser built its projection list from the data rows, by first
    appearance, and opened the first one.  The manifest is the v3 browser's
    projection order, so metadata listing ``UMAP, PCA`` over rows that start
    with ``PCA`` must still open on ``PCA``; part 2 keeps the order it was given."""
    annotations = make_annotations(col=["a", "b"])
    meta, data = make_projections((("UMAP", 2), ("PCA", 3)), ["p0", "p1"])
    first_pca = pc.equal(data.column("projection_name"), "PCA")
    data = pa.concat_tables([data.filter(first_pca), data.filter(pc.invert(first_pca))])

    parts = encode_v3(annotations, meta, data)

    manifest = manifest_of(parts[0])["projections"]
    assert [p["name"] for p in manifest] == ["PCA", "UMAP"]
    assert read(parts[2]).column_names == [
        "PCA__x",
        "PCA__y",
        "PCA__z",
        "UMAP__x",
        "UMAP__y",
    ]
    assert read(parts[1]).column("projection_name").to_pylist() == ["UMAP", "PCA"]
    _annotations, metadata, projections = decode_v3(list(parts))
    assert metadata.column("dimensions").to_pylist() == [2, 3]
    assert projections.column("projection_name").to_pylist()[0] == "PCA"


def _with_unplaced_q(length: list[str] | pa.Array):
    """``P1``..``P4`` placed by one projection, ``Q`` an annotation-only row."""
    annotations = stamp_format_version(
        pa.table({"protein_id": ["P1", "P2", "P3", "P4", "Q"], "length": length})
    )
    meta, data = make_projections((("A", 2),), ["P1", "P2", "P3", "P4"])
    return encode_v3(annotations, meta, data)


def test_numeric_inference_is_over_the_placed_proteins_as_in_v2():
    """The v2 browser inferred a column's kind over the proteins it placed.  An
    unplaced ``unknown`` among numbers cannot be stored as a number, so the
    column is written as labels, which Python decodes back as they were, and
    marked for the browser to read as numbers over the placed proteins."""
    parts = _with_unplaced_q(["100", "200", "NA", "400", "unknown"])

    entry = manifest_of(parts[0])["columns"]["length"]
    assert entry == {
        "kind": "categorical",
        "sourceType": "string",
        "placedNumeric": True,
    }
    assert decode_v3(list(parts))[0].column("length").to_pylist() == [
        "100",
        "200",
        "NA",
        "400",
        "unknown",
    ]


def test_a_column_numeric_only_on_unplaced_proteins_is_labels_as_in_v2():
    """The reverse: missing on every placed protein, v2 showed the column as
    categorical (all N/A), whatever the annotation-only rows held."""
    parts = _with_unplaced_q(["", "", "", "", "5"])

    entry = manifest_of(parts[0])["columns"]["length"]
    assert entry == {"kind": "categorical", "sourceType": "string"}
    assert decode_v3(list(parts))[0].column("length").to_pylist() == [
        "",
        "",
        "",
        "",
        "5",
    ]


def test_a_column_numeric_everywhere_is_numeric_without_the_mark():
    parts = _with_unplaced_q(["100", "200", "300", "400", "500"])

    entry = manifest_of(parts[0])["columns"]["length"]
    assert entry == {"kind": "numeric", "numericType": "int", "sourceType": "string"}


@pytest.mark.parametrize(
    ("length", "source_type"),
    [
        (["100", "200", "300", "400", "2.5"], "string"),
        (pa.array([100.0, 200.0, 300.0, 400.0, 2.5]), "double"),
    ],
)
def test_an_unplaced_fraction_does_not_make_a_numeric_column_float(length, source_type):
    """v2 inferred int vs float over the proteins it placed, too: the browser
    takes ``numericType`` as written, so an annotation-only ``2.5`` must not
    switch the column's bins and tooltips to decimals.  The file keeps it."""
    parts = _with_unplaced_q(length)

    entry = manifest_of(parts[0])["columns"]["length"]
    assert entry == {"kind": "numeric", "numericType": "int", "sourceType": source_type}
    decoded = decode_v3(list(parts))[0].column("length").to_pylist()
    if source_type == "string":
        assert decoded == ["100", "200", "300", "400", "2.5"]
    else:
        assert decoded == [100.0, 200.0, 300.0, 400.0, 2.5]


# --------------------------------------------------------------------------- #
# guards
# --------------------------------------------------------------------------- #


def test_rejects_count_column_collision():
    table = make_annotations(col=["A;B", "A"], **{"col__count": ["x", "y"]})
    with pytest.raises(ValueError, match="already exists"):
        encode(table)


def test_rejects_duplicate_projection_names():
    annotations = make_annotations(col=["A", "B"])
    meta, data = make_projections((("A", 2), ("A", 3)), ["p0", "p1"])
    with pytest.raises(ValueError, match="Duplicate projection name"):
        encode_v3(annotations, meta, data)


def test_rejects_a_projection_only_in_the_metadata():
    """The browser derives the projection set from the data rows, so both must agree."""
    annotations = make_annotations(col=["A", "B"])
    meta, _ = make_projections((("A", 2), ("B", 2)), ["p0", "p1"])
    _, data = make_projections((("A", 2),), ["p0", "p1"])
    with pytest.raises(ValueError, match=r"metadata-only \['B'\]"):
        encode_v3(annotations, meta, data)


def test_rejects_a_projection_only_in_the_data():
    annotations = make_annotations(col=["A", "B"])
    meta, _ = make_projections((("A", 2),), ["p0", "p1"])
    _, data = make_projections((("A", 2), ("B", 2)), ["p0", "p1"])
    with pytest.raises(ValueError, match=r"data-only \['B'\]"):
        encode_v3(annotations, meta, data)


def test_rejects_duplicate_identifiers_within_a_projection():
    """Consistent with duplicate ``protein_id``s, which raise rather than last-win."""
    annotations = make_annotations(col=["A", "B"])
    meta, data = make_projections((("A", 2),), ["p0", "p0"])
    with pytest.raises(ValueError, match="more than one row"):
        encode_v3(annotations, meta, data)


def test_rejects_colliding_payload_names():
    table = make_annotations(**{"__evidence": ["A", "B"], "loc": ["Cyto|IDA", "Nuc"]})
    with pytest.raises(ValueError, match="payload name collision"):
        encode(table)


def _declare_dimensions(meta: pa.Table, value) -> pa.Table:
    return meta.set_column(
        meta.schema.get_field_index("dimensions"), "dimensions", pa.array([value])
    )


@pytest.mark.parametrize(("data_dim", "declared"), [(2, 3), (3, 2), (2, "abc")])
def test_dimension_comes_from_the_data_not_the_metadata(data_dim, declared, caplog):
    annotations = make_annotations(col=["A", "B"])
    meta, data = make_projections((("A", data_dim),), ["p0", "p1"])
    parts = encode_v3(annotations, _declare_dimensions(meta, declared), data)

    assert read(parts[2]).column_names == ["A__x", "A__y", "A__z"][:data_dim]
    assert manifest_of(parts[0])["projections"] == [
        {"name": "A", "dimension": data_dim}
    ]
    assert f"'A': metadata declares dimensions={declared!r}" in caplog.text
    assert f"data is {data_dim}D" in caplog.text

    # Part 2 says what the manifest and part 3 say, not the stale declaration;
    # a non-integer column comes out int64, and every other column is kept.
    part2 = read(parts[1])
    assert part2.column("dimensions").to_pylist() == [data_dim]
    assert part2.schema.field("dimensions").type == pa.int64()
    assert part2.column_names == meta.column_names


@pytest.mark.parametrize("declared", [2, 3])
def test_a_nan_z_column_is_2d(declared):
    """A float ``z`` filled with NaN (numpy, polars, a third-party legacy bundle)
    has no nulls, but no finite value either: the legacy readers draw such a
    projection in 2D, so the encoder must not write it as an all-missing 3D one."""
    annotations = make_annotations(col=["A", "B"])
    meta, data = make_projections((("A", 2),), ["p0", "p1"])
    nan_z = pa.array(np.array([np.nan, np.nan], dtype=np.float32))
    assert nan_z.null_count == 0
    data = data.set_column(data.schema.get_field_index("z"), "z", nan_z)
    parts = encode_v3(annotations, _declare_dimensions(meta, declared), data)

    assert manifest_of(parts[0])["projections"] == [{"name": "A", "dimension": 2}]
    assert read(parts[2]).column("A__x").to_pylist() == [0.0, 1.0]


def test_a_stale_dimension_keeps_the_column_type():
    annotations = make_annotations(col=["A", "B"])
    meta, data = make_projections((("A", 2), ("B", 3)), ["p0", "p1"])
    stale = meta.set_column(
        meta.schema.get_field_index("dimensions"),
        "dimensions",
        pa.array([3, 3], type=pa.int32()),
    )
    part2 = read(encode_v3(annotations, stale, data)[1])
    assert part2.column("dimensions").to_pylist() == [2, 3]
    assert part2.schema.field("dimensions").type == pa.int32()


def test_an_agreeing_declared_dimension_is_silent(caplog):
    """``dimensions`` can arrive as a string; ``"3"`` agrees with 3D data."""
    annotations = make_annotations(col=["A", "B"])
    meta, data = make_projections((("A", 3),), ["p0", "p1"])
    declared = _declare_dimensions(meta, "3")
    parts = encode_v3(annotations, declared, data)
    assert manifest_of(parts[0])["projections"] == [{"name": "A", "dimension": 3}]
    assert "declares dimensions" not in caplog.text
    assert read(parts[1]).equals(declared)  # agreeing metadata is written as given


def test_rejects_duplicate_protein_ids():
    annotations = stamp_format_version(
        pa.table({"protein_id": ["p0", "p0"], "col": ["A", "B"]})
    )
    meta, data = make_projections((("A", 2),), ["p0"])
    with pytest.raises(ValueError, match="duplicated value"):
        encode_v3(annotations, meta, data)


def test_rejects_null_protein_ids():
    annotations = stamp_format_version(
        pa.table({"protein_id": ["p0", None], "col": ["A", "B"]})
    )
    meta, data = make_projections((("A", 2),), ["p0"])
    with pytest.raises(ValueError, match="null values"):
        encode_v3(annotations, meta, data)


def test_rejects_missing_projection_columns():
    annotations = make_annotations(col=["A"])
    meta, _ = make_projections((("A", 2),), ["p0"])
    data = pa.table({"projection_name": ["A"], "identifier": ["p0"], "x": [1.0]})
    with pytest.raises(ValueError, match=r"missing required column\(s\): \['y'\]"):
        encode_v3(annotations, meta, data)


def test_a_projected_identifier_without_annotations_is_added(caplog):
    """The legacy browser reader showed such a protein with N/A everywhere."""
    annotations = make_annotations(col=["A"], score=["1.5"])
    meta, data = make_projections((("A", 2),), ["ghost", "p0", "ghost2"])
    parts = encode_v3(annotations, meta, data)

    part1 = read(parts[0])
    # In projection order, as the browser lists them.
    assert part1.column("protein_id").to_pylist() == ["ghost", "p0", "ghost2"]
    assert part1.column("col").to_pylist() == [-1, 0, -1]
    scores = part1.column("score").to_pylist()
    assert scores[1] == 1.5
    assert np.isnan(scores[0]) and np.isnan(scores[2])
    assert read(parts[2]).column("A__x").to_pylist() == [0.0, 1.0, 2.0]
    assert "2 projected identifier(s) have no annotations row" in caplog.text


def test_rejects_a_null_projected_identifier():
    annotations = make_annotations(col=["A"])
    meta, _ = make_projections((("A", 2),), ["p0"])
    data = pa.table(
        {"projection_name": ["A"], "identifier": [None], "x": [1.0], "y": [1.0]},
        schema=pa.schema(
            [
                ("projection_name", pa.string()),
                ("identifier", pa.string()),
                ("x", pa.float32()),
                ("y", pa.float32()),
            ]
        ),
    )
    with pytest.raises(ValueError, match="null identifier"):
        encode_v3(annotations, meta, data)


def test_rejects_annotations_without_an_id_column():
    with pytest.raises(ValueError, match="no 'protein_id' or 'identifier'"):
        encode_v3(
            stamp_format_version(pa.table({"col": ["A"]})),
            *make_projections((("A", 2),), ["p0"]),
        )


def test_an_unstamped_table_is_refused_not_guessed():
    """No stamp means the grammar is unknown: a v2 table that lost its stamp to
    ``rename_columns`` looks exactly like a v1 one, and migrating it would turn
    ``%3B`` into ``%253B``, unrecoverably.  So the encoder refuses both."""
    unstamped = pa.table({"protein_id": ["p0"], "col": ["ACC (a%3Bb)"]})
    with pytest.raises(ValueError, match="no protspace_format_version stamp"):
        encode(unstamped)


def test_a_v1_stamped_table_is_refused():
    v1 = pa.table({"protein_id": ["p0"], "col": ["A"]}).replace_schema_metadata(
        {FORMAT_VERSION_KEY: b"1"}
    )
    with pytest.raises(ValueError, match="declares cell grammar v1"):
        encode(v1)


def test_v1_annotations_migrated_first_keep_their_hits():
    """A v1 cell's raw ``;`` inside parens must not become two hits."""
    v1 = pa.table({"protein_id": ["p0"], "col": ["PF1 (a;b)|0.5"]})
    parts = encode(migrate_legacy_annotation_table(v1))
    assert labels_of(payloads_of(parts[3]), "col") == ["PF1 (a;b)"]
    assert read(parts[0]).column("col__count").to_pylist() == [1]


def test_a_v1_hit_splits_at_its_last_pipe():
    """The browser's v1 reader takes the score after a hit's last ``|``; an
    earlier one is part of the label (a real ``phosphatase`` CATH cell)."""
    cell = "3.30.70.1020 (TPP;3.40.50.1000 (HAD)|40.1,172.1;domain 2)|172.1"
    v1 = pa.table({"protein_id": ["p0"], "col": [cell]})
    parts = encode(migrate_legacy_annotation_table(v1))
    payloads = payloads_of(parts[3])
    assert labels_of(payloads, "col") == [
        "3.30.70.1020 (TPP;3.40.50.1000 (HAD)|40.1,172.1;domain 2)"
    ]
    assert np.frombuffer(payloads["scores:col"], "<f8").tolist() == [172.1]


def test_migrating_a_v1_table_twice_is_a_no_op():
    """The migration output must not read back as v1, or it gets re-escaped.

    ``read_format_version`` defaults an unstamped table to 1, so an unstamped
    migration output is exactly the one table that looks like it still needs
    migrating.  ``decode_field`` is not its own inverse, so the second pass is
    unrecoverable.
    """
    v1 = pa.table({"protein_id": ["p0"], "col": ["nitrite reductase (a; b)"]})
    once = migrate_legacy_annotation_table(v1)
    assert read_format_version(once) == 2
    assert migrate_legacy_annotation_table(once).equals(once)


def test_the_encoder_does_not_re_migrate_an_already_migrated_table():
    """``35K_ec_brenda`` row 28982, the cell that reproduced the double escape."""
    name = "nitrite reductase (cytochrome; ammonia-forming)"
    migrated = migrate_legacy_annotation_table(
        pa.table({"protein_id": ["p0"], "col": [name]})
    )
    assert labels_of(payloads_of(encode(migrated)[3]), "col") == [name]


def test_null_cells_are_missing():
    table = stamp_format_version(
        pa.table({"protein_id": ["p0", "p1", "p2"], "col": ["A", None, "A"]})
    )
    parts = encode(table)
    assert labels_of(payloads_of(parts[3]), "col") == ["A"]
    assert read(parts[0]).column("col").to_pylist() == [0, -1, 0]


def test_all_null_arrow_numeric_column_stays_numeric():
    """Deliberate divergence: the browser would call this categorical.

    Keeping the kind tied to the Arrow type is what lets ``decode_v3`` restore
    ``sourceType`` (an all-null float32 ``__pred_confidence`` must not come back
    as a string column).
    """
    table = stamp_format_version(
        pa.table(
            {
                "protein_id": ["p0", "p1"],
                "conf": pa.array([None, None], type=pa.float32()),
            }
        )
    )
    parts = encode(table)
    assert manifest_of(parts[0])["columns"]["conf"] == {
        "kind": "numeric",
        "numericType": "float",
        "sourceType": "float",
    }
    assert all(np.isnan(v) for v in read(parts[0]).column("conf").to_pylist())


# --------------------------------------------------------------------------- #
# nested (list / struct) columns
# --------------------------------------------------------------------------- #


def test_a_list_column_is_stored_as_one_hit_per_element():
    """A ``list<string>`` column (GO terms kept as a pandas list column) is a
    multi-valued column: each element is one hit, taken literally, so a ``;`` or
    ``|`` inside an element stays part of its label."""
    table = stamp_format_version(
        pa.table(
            {
                "protein_id": ["p0", "p1", "p2", "p3"],
                "go": pa.array(
                    [["GO:1", "GO:2"], ["GO:3"], None, ["a;b", "x|IDA", "", None]],
                    type=pa.list_(pa.string()),
                ),
            }
        )
    )
    parts = encode(table)
    entry = manifest_of(parts[0])["columns"]["go"]
    assert entry == {"kind": "multi", "sourceType": "?"}
    payloads = payloads_of(parts[3])
    labels = labels_of(payloads, "go")
    hits = np.frombuffer(payloads["csr:go"], "<i4")
    assert [labels[code] for code in hits] == ["GO:1", "GO:2", "GO:3", "a;b", "x|IDA"]
    assert read(parts[0]).column("go__count").to_pylist() == [2, 1, 0, 2]


def test_a_list_column_of_non_strings_uses_the_scalar_spelling():
    table = stamp_format_version(
        pa.table(
            {
                "protein_id": ["p0", "p1"],
                "flags": pa.array([[True, False], [True]]),
                "sizes": pa.array([[1, 2], []], type=pa.large_list(pa.int32())),
            }
        )
    )
    payloads = payloads_of(encode(table)[3])
    assert labels_of(payloads, "flags") == ["true", "false"]
    assert labels_of(payloads, "sizes") == ["1", "2"]


@pytest.mark.parametrize(
    "column",
    [
        pa.array([[1], [2], [3]], type=pa.list_(pa.int64())),
        pa.array([["10"], ["20"], None], type=pa.list_(pa.string())),
    ],
    ids=["list<int64>", "list<string>"],
)
def test_a_list_column_of_single_numbers_keeps_its_elements_as_labels(column):
    """One numeric-looking element per cell is still a list: its elements are
    labels, taken literally, as for any other list, and never a numeric column
    (the v2 browser showed ``String([1])`` as the category ``1``)."""
    table = stamp_format_version(
        pa.table({"protein_id": ["p0", "p1", "p2"], "ids": column})
    )
    parts = encode(table)
    assert manifest_of(parts[0])["columns"]["ids"]["kind"] != "numeric"
    labels = labels_of(payloads_of(parts[3]), "ids")
    codes = read(parts[0]).column("ids").to_pylist()
    expected = [None if c is None else str(c[0]) for c in column.to_pylist()]
    assert [labels[c] if c >= 0 else None for c in codes] == expected


@pytest.mark.parametrize(
    "column",
    [
        pa.array([{"a": 1}, {"a": 2}]),
        pa.array([[["x"]], [["y"]]]),
    ],
    ids=["struct", "list-of-lists"],
)
def test_a_column_that_has_no_text_form_is_refused_by_name(column):
    table = stamp_format_version(pa.table({"protein_id": ["p0", "p1"], "odd": column}))
    with pytest.raises(ValueError, match="'odd'"):
        encode(table)
