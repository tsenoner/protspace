"""Turn protlabel Predictions into per-cell overlay columns on the annotations table.

For a transferred column ``COL`` we append three aligned columns (null for
non-predicted proteins), leaving the curated ``COL`` untouched:
    COL__pred_value       (string)  the transferred label
    COL__pred_confidence  (float32) the reliability index in [0, 1]
    COL__pred_source      (string)  the nearest reference protein id
"""

from __future__ import annotations

from collections.abc import Sequence

import pyarrow as pa

from protlabel import Prediction


def add_overlay_columns(
    annotations: pa.Table, column: str, predictions: Sequence[Prediction]
) -> pa.Table:
    """Append the COL__pred_* overlay columns, aligned by identifier."""
    by_query = {p.query_id: p for p in predictions}
    identifiers = [str(v) for v in annotations.column("identifier").to_pylist()]

    values: list[str | None] = []
    confidences: list[float | None] = []
    sources: list[str | None] = []
    for identifier in identifiers:
        pred = by_query.get(identifier)
        if pred is None:
            values.append(None)
            confidences.append(None)
            sources.append(None)
        else:
            values.append(pred.label)
            confidences.append(float(pred.reliability))
            sources.append(pred.source_id)

    # Drop any pre-existing overlay columns first so re-running transfer on an
    # already-overlaid table replaces them rather than appending duplicates
    # (duplicate field names produce a parquet table that cannot be read back).
    overlay_names = [
        f"{column}__pred_value",
        f"{column}__pred_confidence",
        f"{column}__pred_source",
    ]
    out = annotations
    stale = [name for name in overlay_names if name in out.column_names]
    if stale:
        out = out.drop_columns(stale)

    out = out.append_column(f"{column}__pred_value", pa.array(values, pa.string()))
    out = out.append_column(
        f"{column}__pred_confidence", pa.array(confidences, pa.float32())
    )
    out = out.append_column(f"{column}__pred_source", pa.array(sources, pa.string()))
    return out
