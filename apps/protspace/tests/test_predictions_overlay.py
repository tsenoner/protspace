"""Tests for building the per-cell prediction overlay columns."""

import io

import pyarrow as pa
import pyarrow.parquet as pq

from protlabel import Prediction
from protspace.data.io.predictions import add_overlay_columns


def _table():
    return pa.table(
        {
            "identifier": ["Q0", "Q1", "R0"],
            "protein_category": ["", "", "neurotoxin"],
        }
    )


def test_adds_three_overlay_columns():
    preds = [
        Prediction("Q0", "neurotoxin", "R0", 0.3, 0.62, 1, "euclidean"),
    ]
    out = add_overlay_columns(_table(), "protein_category", preds)
    assert "protein_category__pred_value" in out.column_names
    assert "protein_category__pred_confidence" in out.column_names
    assert "protein_category__pred_source" in out.column_names


def test_overlay_values_aligned_by_identifier():
    preds = [Prediction("Q1", "enzyme", "R9", 0.5, 0.5, 1, "euclidean")]
    out = add_overlay_columns(_table(), "protein_category", preds).to_pylist()
    by_id = {r["identifier"]: r for r in out}
    assert by_id["Q1"]["protein_category__pred_value"] == "enzyme"
    assert by_id["Q1"]["protein_category__pred_confidence"] == 0.5
    assert by_id["Q1"]["protein_category__pred_source"] == "R9"
    # Non-predicted rows are null in the overlay columns.
    assert by_id["Q0"]["protein_category__pred_value"] is None
    assert by_id["R0"]["protein_category__pred_confidence"] is None


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
    assert "protein_category__pred_value" in out.column_names
    assert out.column("protein_category__pred_value").to_pylist() == [None, None, None]
    assert out.column("protein_category__pred_confidence").to_pylist() == [
        None,
        None,
        None,
    ]


def test_prediction_for_unknown_identifier_is_ignored():
    preds = [Prediction("NOT_IN_TABLE", "x", "R0", 0.1, 0.9, 1, "euclidean")]
    out = add_overlay_columns(_table(), "protein_category", preds).to_pylist()
    assert all(r["protein_category__pred_value"] is None for r in out)


def test_reapplying_overlay_replaces_not_duplicates():
    # Re-running transfer on an already-overlaid table must replace the overlay
    # columns, not append duplicates (which produce an unreadable parquet table).
    preds1 = [Prediction("Q0", "old", "R0", 0.3, 0.6, 1, "euclidean")]
    once = add_overlay_columns(_table(), "protein_category", preds1)
    preds2 = [Prediction("Q0", "new", "R0", 0.1, 0.9, 1, "euclidean")]
    twice = add_overlay_columns(once, "protein_category", preds2)

    assert twice.column_names.count("protein_category__pred_value") == 1
    assert twice.column_names.count("protein_category__pred_confidence") == 1
    assert twice.column_names.count("protein_category__pred_source") == 1

    by_id = {r["identifier"]: r for r in twice.to_pylist()}
    assert by_id["Q0"]["protein_category__pred_value"] == "new"

    # Duplicate column names would make this round-trip raise ArrowInvalid.
    buf = io.BytesIO()
    pq.write_table(twice, buf)
    reread = pq.read_table(io.BytesIO(buf.getvalue()))
    assert reread.column("protein_category__pred_value").to_pylist()[0] == "new"
