"""Tests for building the per-cell prediction overlay columns."""

import io

import pyarrow as pa
import pyarrow.parquet as pq
import pytest

from protlabel import Prediction
from protspace.data.annotations.encoding import migrate_legacy_annotation_table
from protspace.data.io.predictions import add_overlay_columns


def _table():
    return pa.table(
        {
            "identifier": ["Q0", "Q1", "R0"],
            "protein_category": ["", "", "neurotoxin"],
        }
    )


def test_overlay_values_aligned_by_identifier():
    preds = [Prediction("Q1", "enzyme", "R9", 0.5, 0.5, 1, "euclidean")]
    out = add_overlay_columns(_table(), "protein_category", preds).to_pylist()
    by_id = {r["identifier"]: r for r in out}
    assert by_id["Q1"]["protein_category__pred_value"] == "enzyme"
    assert by_id["Q1"]["protein_category__pred_confidence"] == 0.5
    # The source column is emitted as PROVENANCE: the id of the reference whose
    # label was transferred (Prediction.source_id), not the query's own id, so
    # the frontend can draw a connector line / show a "transferred from
    # <neighbour>" tooltip. It is not a colour feature.
    assert by_id["Q1"]["protein_category__pred_source"] == "R9"
    # Non-predicted rows are null in the overlay columns.
    assert by_id["Q0"]["protein_category__pred_value"] is None
    assert by_id["R0"]["protein_category__pred_confidence"] is None
    assert by_id["R0"]["protein_category__pred_source"] is None


def test_source_reserved_characters_are_encoded_as_one_opaque_v2_field():
    source_id = "R|part;literal%3B"
    preds = [Prediction("Q0", "neurotoxin", source_id, 0.3, 0.8, 1, "euclidean")]
    out = add_overlay_columns(_table(), "protein_category", preds).to_pylist()
    by_id = {row["identifier"]: row for row in out}
    assert by_id["Q0"]["protein_category__pred_source"] == "R%7Cpart%3Bliteral%253B"


def test_legacy_table_migration_preserves_parsed_structure_and_opaque_sources():
    legacy = pa.table(
        {
            "identifier": ["Q0", "R|part;literal%3B"],
            "category": ["name%3Bpart", "ACC (Name; part)|EXP"],
            "category__pred_source": ["R|part;literal%3B", None],
        }
    )

    migrated = migrate_legacy_annotation_table(legacy).to_pylist()

    assert migrated[0]["category"] == "name%253Bpart"
    assert migrated[1]["category"] == "ACC (Name%3B part)|EXP"
    assert migrated[0]["category__pred_source"] == "R%7Cpart%3Bliteral%253B"


def test_source_column_is_string():
    preds = [Prediction("Q0", "x", "R0", 0.1, 0.83, 1, "euclidean")]
    out = add_overlay_columns(_table(), "protein_category", preds)
    field = out.schema.field("protein_category__pred_source")
    assert pa.types.is_string(field.type)


def test_curated_column_is_left_untouched():
    preds = [Prediction("Q0", "neurotoxin", "R0", 0.1, 0.8, 1, "euclidean")]
    out = add_overlay_columns(_table(), "protein_category", preds).to_pylist()
    by_id = {r["identifier"]: r for r in out}
    assert by_id["Q0"]["protein_category"] == ""  # original column unchanged
    assert by_id["R0"]["protein_category"] == "neurotoxin"


def test_confidence_column_is_float():
    preds = [Prediction("Q0", "x", "R0", 0.1, 0.83, 1, "euclidean")]
    out = add_overlay_columns(_table(), "protein_category", preds)
    field = out.schema.field("protein_category__pred_confidence")
    assert pa.types.is_floating(field.type)


def test_empty_predictions_appends_all_null_columns():
    out = add_overlay_columns(_table(), "protein_category", [])
    for suffix in ("__pred_value", "__pred_confidence", "__pred_source"):
        col = f"protein_category{suffix}"
        assert col in out.column_names
        assert out.column(col).to_pylist() == [None, None, None]


def test_prediction_for_unknown_identifier_is_ignored():
    preds = [Prediction("NOT_IN_TABLE", "x", "R0", 0.1, 0.9, 1, "euclidean")]
    out = add_overlay_columns(_table(), "protein_category", preds).to_pylist()
    assert all(r["protein_category__pred_value"] is None for r in out)
    assert all(r["protein_category__pred_source"] is None for r in out)


def _fully_overlaid():
    """A table a previous transfer run already overlaid."""
    preds = [Prediction("Q0", "old", "R0", 0.3, 0.6, 1, "euclidean")]
    return add_overlay_columns(_table(), "protein_category", preds)


def _seeded_with_source_only():
    """A table carrying only the __pred_source column, as legacy tables do."""
    return _table().append_column(
        "protein_category__pred_source", pa.array(["OLD", None, None], pa.string())
    )


@pytest.mark.parametrize(
    "starting_table",
    [_fully_overlaid, _seeded_with_source_only],
    ids=["fully_overlaid", "source_only"],
)
def test_reapplying_overlay_replaces_not_duplicates(starting_table):
    # Re-running transfer on an already-overlaid table must replace the overlay
    # columns, not append duplicates (which produce an unreadable parquet
    # table). Each stale column is dropped on its own, so a table holding only
    # some of them must work too.
    preds = [Prediction("Q0", "new", "R1", 0.1, 0.9, 1, "euclidean")]
    out = add_overlay_columns(starting_table(), "protein_category", preds)

    for suffix in ("__pred_value", "__pred_confidence", "__pred_source"):
        assert out.column_names.count(f"protein_category{suffix}") == 1

    by_id = {r["identifier"]: r for r in out.to_pylist()}
    assert by_id["Q0"]["protein_category__pred_value"] == "new"
    assert by_id["Q0"]["protein_category__pred_source"] == "R1"

    # Duplicate column names would make this round-trip raise ArrowInvalid.
    buf = io.BytesIO()
    pq.write_table(out, buf)
    reread = pq.read_table(io.BytesIO(buf.getvalue()))
    assert reread.column("protein_category__pred_value").to_pylist()[0] == "new"
