"""Tests for building the per-cell prediction overlay columns."""

import pyarrow as pa

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
