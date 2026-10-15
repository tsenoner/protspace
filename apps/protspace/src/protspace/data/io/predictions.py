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

``protspace transfer --report`` writes what the bundle leaves out: every
neighbour each prediction was computed from, with its raw distance, as a TSV
built by :func:`report_rows` and :func:`write_report`.
"""

from __future__ import annotations

import csv
import io
from collections.abc import Sequence
from pathlib import Path

import pyarrow as pa

from protlabel import Prediction
from protspace.data.annotations.encoding import encode_field, to_display_value
from protspace.data.io.atomic import atomic_write_bytes

#: The columns of a transfer report, in order: one row per query and neighbour.
REPORT_COLUMNS = (
    "column",
    "query_id",
    "label",
    "source_id",
    "distance",
    "reliability",
    "rank",
    "reference_id",
    "reference_label",
    "reference_distance",
)


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


def report_rows(
    column: str,
    predictions: Sequence[Prediction],
    *,
    format_version: int = 2,
) -> list[dict]:
    """One report row per query and neighbour, for predictions made with neighbours.

    Labels are the stored cells, so they are shown the way the app shows them
    (score suffix dropped, a v2 cell percent-decoded); ids are written as they are.
    ``distance`` is the distance to ``source_id``, which with ``k > 1`` need not be
    the rank-1 neighbour.
    """
    decode = format_version >= 2
    rows = []
    for pred in predictions:
        label = to_display_value(pred.label, decode=decode)
        for rank, neighbor in enumerate(pred.neighbors, start=1):
            rows.append(
                {
                    "column": column,
                    "query_id": pred.query_id,
                    "label": label,
                    "source_id": pred.source_id,
                    "distance": pred.distance,
                    "reliability": pred.reliability,
                    "rank": rank,
                    "reference_id": neighbor.reference_id,
                    "reference_label": to_display_value(neighbor.label, decode=decode),
                    "reference_distance": neighbor.distance,
                }
            )
    return rows


def write_report(path: Path, rows: Sequence[dict]) -> None:
    """Write report rows as a tab-separated table, atomically.

    Floats are written with six significant digits, which keeps the distances
    readable without hiding a difference the reliability index would show.
    """
    buffer = io.StringIO()
    writer = csv.writer(buffer, delimiter="\t", lineterminator="\n")
    writer.writerow(REPORT_COLUMNS)
    for row in rows:
        writer.writerow(
            f"{value:.6g}" if isinstance(value, float) else value
            for value in (row[name] for name in REPORT_COLUMNS)
        )
    atomic_write_bytes(path, buffer.getvalue().encode())
