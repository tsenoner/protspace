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

With ``--max-distance`` a fourth column, ``COL__neighbor``, records whether a
query's nearest reference lay within the cutoff (``near``) or not
(``distant``). It is an ordinary categorical annotation, outside the reserved
``__pred_`` namespace, so the web app colours and filters by it like any other.
"""

from __future__ import annotations

import csv
import io
from collections.abc import Mapping, Sequence
from pathlib import Path

import pyarrow as pa

from protlabel import Prediction
from protspace._generated.shared_constants import EAT_NEIGHBOR_SUFFIX
from protspace.data.annotations.encoding import encode_field, to_display_value
from protspace.data.io.atomic import atomic_write_bytes
from protspace.data.io.ids import PROTEIN_ID_COLUMN

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
#: Appended to the report columns when the transfer ran with a distance cutoff.
CUTOFF_REPORT_COLUMNS = ("neighbor", "max_distance")

#: Suffix of the near/distant column ``--max-distance`` writes beside ``COL``.
NEIGHBOR_SUFFIX = EAT_NEIGHBOR_SUFFIX


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
        identifiers = [
            str(v) for v in annotations.column(PROTEIN_ID_COLUMN).to_pylist()
        ]

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


def set_neighbor_column(
    annotations: pa.Table,
    column: str,
    classes: Mapping[str, str] | None,
    *,
    identifiers: list[str],
) -> pa.Table:
    """Write ``COL__neighbor`` from ``classes`` (query id -> near/distant).

    Any existing ``COL__neighbor`` is dropped first, so a re-transfer replaces
    it; with ``classes=None`` (a run without a cutoff) nothing replaces it, and
    a class computed against earlier predictions does not outlive them. Proteins
    absent from ``classes`` (references, unembedded proteins) are null.
    """
    name = f"{column}{NEIGHBOR_SUFFIX}"
    out = (
        annotations.drop_columns([name])
        if name in annotations.column_names
        else annotations
    )
    if classes is None:
        return out
    values = [classes.get(identifier) for identifier in identifiers]
    return out.append_column(name, pa.array(values, pa.string()))


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
    shown: dict[str, str] = {}  # each label decoded once: a column repeats few

    def display(cell: str) -> str:
        if cell not in shown:
            shown[cell] = to_display_value(cell, decode=decode)
        return shown[cell]

    rows = []
    for pred in predictions:
        label = display(pred.label)
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
                    "reference_label": display(neighbor.label),
                    "reference_distance": neighbor.distance,
                }
            )
    return rows


def write_report(path: Path, rows: Sequence[dict]) -> None:
    """Write report rows as a tab-separated table, atomically.

    Floats are written with six significant digits, which keeps the distances
    readable without hiding a difference the reliability index would show.
    """
    columns = REPORT_COLUMNS
    if rows and CUTOFF_REPORT_COLUMNS[0] in rows[0]:
        columns += CUTOFF_REPORT_COLUMNS
    buffer = io.StringIO()
    writer = csv.writer(buffer, delimiter="\t", lineterminator="\n")
    writer.writerow(columns)
    for row in rows:
        writer.writerow(
            f"{value:.6g}" if isinstance(value, float) else value
            for value in (row[name] for name in columns)
        )
    atomic_write_bytes(path, buffer.getvalue().encode())
