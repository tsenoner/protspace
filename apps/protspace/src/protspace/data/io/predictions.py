"""Turn protlabel Predictions into per-cell overlay columns on the annotations table.

For a transferred column ``COL`` we append two aligned columns (null for
non-predicted proteins), leaving the curated ``COL`` untouched:
    COL__pred_value       (string)  the transferred label
    COL__pred_confidence  (float32) the reliability index in [0, 1]

The reference protein the value came from is available on the ``Prediction``
(``source_id``) but is intentionally not written to the bundle: it is noise as a
per-cell colour feature, and confidence is the signal users threshold on.
"""

from __future__ import annotations

from collections.abc import Sequence

import pyarrow as pa

from protlabel import Prediction


def add_overlay_columns(
    annotations: pa.Table, column: str, predictions: Sequence[Prediction]
) -> pa.Table:
    """Append the COL__pred_value / COL__pred_confidence columns, by identifier."""
    by_query = {p.query_id: p for p in predictions}
    identifiers = [str(v) for v in annotations.column("identifier").to_pylist()]

    values: list[str | None] = []
    confidences: list[float | None] = []
    for identifier in identifiers:
        pred = by_query.get(identifier)
        if pred is None:
            values.append(None)
            confidences.append(None)
        else:
            values.append(pred.label)
            confidences.append(float(pred.reliability))

    # Drop any pre-existing overlay columns first so re-running transfer on an
    # already-overlaid table replaces them rather than appending duplicates
    # (duplicate field names produce a parquet table that cannot be read back).
    # The legacy __pred_source is included so older bundles are cleaned up.
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
    return out
