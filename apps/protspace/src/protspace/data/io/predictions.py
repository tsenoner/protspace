"""Turn protlabel Predictions into per-cell overlay columns on the annotations table.

For a transferred column ``COL`` we append three aligned columns (null for
non-predicted proteins), leaving the curated ``COL`` untouched:
    COL__pred_value       (string)  the transferred label
    COL__pred_confidence  (float32) the reliability index in [0, 1]
    COL__pred_source      (string)  the reference protein the label came from

``COL__pred_source`` (``Prediction.source_id``) is emitted as *provenance*: it
lets the web frontend draw a connector line to the reference a label was
transferred from and show a "transferred from <neighbour>" tooltip. It is
deliberately not a colour feature (a per-protein id has ~one distinct value per
row); the frontend reserves the ``__pred_`` namespace and keeps these columns
out of the colour-by dropdown (see the EAT visualization design).
"""

from __future__ import annotations

from collections.abc import Sequence

import pyarrow as pa

from protlabel import Prediction
from protspace.data.annotations.encoding import encode_field


def add_overlay_columns(
    annotations: pa.Table,
    column: str,
    predictions: Sequence[Prediction],
    *,
    identifiers: list[str] | None = None,
    format_version: int = 2,
) -> pa.Table:
    """Append COL__pred_value / COL__pred_confidence / COL__pred_source, by identifier.

    ``identifiers`` may be a pre-materialized list of the string identifier
    column (same order as ``annotations``) to avoid re-materializing it on every
    call when overlaying several columns onto the same table.
    """
    by_query = {p.query_id: p for p in predictions}
    if identifiers is None:
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
            sources.append(
                encode_field(pred.source_id) if format_version >= 2 else pred.source_id
            )

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
