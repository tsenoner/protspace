"""Core data structures for projection statistics.

A ``Statistic`` describes a projection (and optionally its source embedding). It
declares the inputs it needs and returns one or more ``StatRow`` records. The
tidy long-format table produced by ``StatsReport.to_arrow`` (eight columns) is
the bundle-boundary contract consumed downstream.

Heavy imports (scikit-learn) live inside the metric/cluster modules, function-
local, so importing this package does not pull sklearn into CLI startup.
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from typing import Any, Protocol

import numpy as np
import pyarrow as pa

# The frozen eight-column schema. New scalar statistics add rows, never columns;
# any per-source attribute (e.g. an annotation column name) goes in ``extra_json``.
STATS_SCHEMA = pa.schema(
    [
        ("space_kind", pa.string()),
        ("space_name", pa.string()),
        ("stat_family", pa.string()),
        ("label_kind", pa.string()),
        ("metric", pa.string()),
        ("metric_kind", pa.string()),
        ("value", pa.float64()),
        ("extra_json", pa.string()),
    ]
)


def _json_default(o: Any):
    if isinstance(o, np.integer):
        return int(o)
    if isinstance(o, np.floating):
        return float(o)
    if isinstance(o, np.ndarray):
        return o.tolist()
    return str(o)


@dataclass
class StatContext:
    """Inputs handed to a statistic for one projection space.

    ``coords`` and ``embedding`` are row-aligned to ``ids`` (an id-intersection
    join is performed by the driver), so faithfulness can compare them directly.
    """

    space_kind: str
    space_name: str
    coords: np.ndarray  # FULL projection coordinates (cluster_validity uses these)
    ids: list[str]  # ids for `coords`
    rng_seed: int = 42
    embedding: np.ndarray | None = None  # source embedding, aligned to embedding_coords
    embedding_coords: np.ndarray | None = None  # projection coords aligned to `embedding`
    embedding_ids: list[str] | None = None  # ids for the aligned embedding/embedding_coords
    embedding_name: str | None = None
    high_dim_metric: str = "euclidean"
    params: dict = field(default_factory=dict)


@dataclass
class StatRow:
    """One statistic value, one row of the tidy table."""

    space_kind: str
    space_name: str
    stat_family: str
    label_kind: str
    metric: str
    metric_kind: str
    value: float
    extra: dict = field(default_factory=dict)

    def to_record(self) -> dict:
        return {
            "space_kind": self.space_kind,
            "space_name": self.space_name,
            "stat_family": self.stat_family,
            "label_kind": self.label_kind,
            "metric": self.metric,
            "metric_kind": self.metric_kind,
            "value": float(self.value),
            "extra_json": json.dumps(self.extra, sort_keys=True, default=_json_default),
        }


@dataclass
class StatsReport:
    """An accumulating set of StatRows; serialises to the tidy Arrow table."""

    rows: list[StatRow] = field(default_factory=list)

    def add(self, rows: list[StatRow]) -> None:
        if rows:
            self.rows.extend(rows)

    def to_arrow(self) -> pa.Table:
        records = [r.to_record() for r in self.rows]
        if not records:
            return pa.Table.from_pylist([], schema=STATS_SCHEMA)
        return pa.Table.from_pylist(records, schema=STATS_SCHEMA)


class Statistic(Protocol):
    """A unit of computation over a projection space.

    ``requires_embedding`` lets the driver skip statistics when no source
    embedding is available for a projection.
    """

    family: str
    requires_embedding: bool

    def compute(self, ctx: StatContext) -> list[StatRow]: ...
