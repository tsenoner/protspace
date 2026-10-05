"""Chunked writer for `.parquetbundle` format v3.

`apps/protspace/src/protspace/data/io/bundle_v3.py` builds every part in memory from
whole tables; this writer takes the rows a chunk at a time and keeps RAM bounded at
any row count, so it can write bundles of tens of millions of proteins:

- part 1 (ids, categorical codes, numerics, multi-valued hit counts) is written
  straight into the output file, one parquet row group per chunk;
- part 3 (wide float32 projections) goes to a temporary parquet file, one row group
  per chunk, and is copied in after part 1;
- the CSR payloads (hit codes, score counts, scores) are appended to raw temporary
  files and written into part 6 at close, one payload per row group.

The wire format is the one `packages/core/src/components/data-loader/utils/bundle-v3.ts`
reads: every part 1/3/6 column is REQUIRED, PLAIN, snappy and without a dictionary;
lengths are per-element int32 counts, never offsets; categorical code -1 is missing;
a missing numeric is NaN; a protein absent from a projection has NaN coordinates.

Limits the reader imposes, checked here:

- one payload is one parquet BYTE_ARRAY value, so it must stay under 2 GiB;
- a column's hits (and score counts) are prefix-summed into int32 offsets, so their
  total must stay under 2^31;
- the reader preallocates at most max(64 MiB, 32 x part bytes) for part 1 and part 3,
  so a part may not compress more than 32x against its decoded arrays.

Usage::

    columns = [Categorical("family", labels), Multi("pfam", labels, scores=True),
               Numeric("length", "int")]
    with BundleWriter(path, columns, [Projection("UMAP_2")]) as writer:
        for chunk in chunks:
            writer.write_chunk(ids, {"family": codes, "pfam": MultiChunk(...),
                                     "length": values}, {"UMAP_2": xy})
        writer.set_labels("pfam", labels)  # labels may also come at the end
"""

from __future__ import annotations

import contextlib
import json
import os
import shutil
import tempfile
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Literal, Self

import numpy as np
import pyarrow as pa
import pyarrow.parquet as pq

DELIMITER = b"---PARQUET_DELIMITER---"
CONTAINER_VERSION_KEY = b"protspace_container_version"
MANIFEST_KEY = b"protspace_v3_manifest"

# The options bundle_v3.py writes with. hyparquet only hands back typed arrays for
# REQUIRED flat PLAIN columns, which the reader insists on.
_PQ: dict[str, Any] = {
    "use_dictionary": False,
    "column_encoding": "PLAIN",
    "compression": "snappy",
    "write_statistics": False,
}

INT32_MAX = 2**31 - 1
# One BYTE_ARRAY value, its 4-byte length and page overhead must fit an int32 page size.
MAX_PAYLOAD_BYTES = 2**31 - 2**20
# bundle-v3.ts: MAX_PREALLOCATION_RATIO and MIN_PREALLOCATION_BUDGET.
MAX_PREALLOCATION_RATIO = 32
MIN_PREALLOCATION_BUDGET = 64 * 1024 * 1024
AXES = ("x", "y", "z")


@dataclass(frozen=True)
class Categorical:
    """One int32 code per row into `labels`; -1 is missing."""

    name: str
    labels: Sequence[str] | None = None
    source_type: str | None = "string"


@dataclass(frozen=True)
class Multi:
    """Any number of hits per row, each a code into `labels`, optionally scored."""

    name: str
    labels: Sequence[str] | None = None
    scores: bool = False
    source_type: str | None = "string"


@dataclass(frozen=True)
class Numeric:
    """One float64 per row; NaN is missing. `numeric_type` only picks the legend format."""

    name: str
    numeric_type: Literal["int", "float"] = "float"
    source_type: str | None = None


@dataclass(frozen=True)
class Projection:
    name: str
    dimension: Literal[2, 3] = 2
    info: Mapping[str, Any] | None = None


@dataclass
class MultiChunk:
    """A chunk of one multi-valued column.

    `counts[i]` hits of row i sit at consecutive positions of `codes`. With scores,
    `score_counts[h]` scores of hit h sit at consecutive positions of `scores`.
    """

    counts: np.ndarray
    codes: np.ndarray
    score_counts: np.ndarray | None = None
    scores: np.ndarray | None = None


Column = Categorical | Multi | Numeric


def _i32(values: Any, what: str) -> np.ndarray:
    array = np.asarray(values)
    if array.dtype != np.int32:
        if array.size and (array.min() < -(2**31) or array.max() > INT32_MAX):
            raise ValueError(f"{what} does not fit int32")
        array = array.astype(np.int32)
    return array


def _required(columns: dict[str, pa.Array], metadata: dict | None = None) -> pa.Table:
    schema = pa.schema(
        [pa.field(name, array.type, nullable=False) for name, array in columns.items()],
        metadata=metadata,
    )
    return pa.table(list(columns.values()), schema=schema)


class _Payload:
    """A raw little-endian payload appended to a temporary file chunk by chunk."""

    def __init__(self, directory: Path, name: str, dtype: str):
        self.name = name
        self.dtype = np.dtype(dtype)
        self.path = directory / f"payload-{len(os.listdir(directory))}.bin"
        self.file = open(self.path, "wb")  # noqa: SIM115 (open until close)
        self.elements = 0

    def append(self, values: np.ndarray) -> None:
        values = np.ascontiguousarray(values, dtype=self.dtype)
        self.elements += values.size
        if self.elements * self.dtype.itemsize > MAX_PAYLOAD_BYTES:
            raise ValueError(
                f"payload {self.name} passes the 2 GiB a parquet value holds"
            )
        self.file.write(values.tobytes())


class BundleWriter:
    """Write a v3 parquetbundle chunk by chunk; see the module docstring."""

    def __init__(
        self,
        path: str | os.PathLike,
        columns: Sequence[Column],
        projections: Sequence[Projection],
        *,
        id_column: str = "protein_id",
        tmp_dir: str | os.PathLike | None = None,
        settings_part: bytes | None = None,
    ):
        self.path = Path(path)
        self.columns = list(columns)
        self.projections = list(projections)
        self.id_column = id_column
        self.settings_part = settings_part
        self.rows = 0
        self._labels: dict[str, list[str] | None] = {
            c.name: (list(c.labels) if c.labels is not None else None)
            for c in self.columns
            if not isinstance(c, Numeric)
        }
        self._max_code = {name: -1 for name in self._labels}

        names = [c.name for c in self.columns]
        physical = [self._physical(c) for c in self.columns]
        if len(set(names)) != len(names) or len(set(physical)) != len(physical):
            raise ValueError(f"duplicate column names in {names}")
        if id_column in names or id_column in physical:
            raise ValueError(f"id column {id_column!r} is also an annotation column")
        if len({p.name for p in self.projections}) != len(self.projections):
            raise ValueError("duplicate projection names")
        for p in self.projections:
            if p.dimension not in (2, 3):
                raise ValueError(f"projection {p.name} has dimension {p.dimension}")

        self._tmp = Path(tempfile.mkdtemp(prefix="bundle-", dir=tmp_dir))
        self._payloads: dict[str, dict[str, _Payload]] = {}
        for c in self.columns:
            if isinstance(c, Multi):
                self._payloads[c.name] = {
                    "codes": _Payload(self._tmp, f"csr:{c.name}", "<i4")
                }
                if c.scores:
                    self._payloads[c.name]["score_counts"] = _Payload(
                        self._tmp, f"score_count:{c.name}", "<i4"
                    )
                    self._payloads[c.name]["scores"] = _Payload(
                        self._tmp, f"scores:{c.name}", "<f8"
                    )

        part1_schema = pa.schema(
            [pa.field(id_column, pa.string(), nullable=False)]
            + [
                pa.field(
                    self._physical(c),
                    pa.float64() if isinstance(c, Numeric) else pa.int32(),
                    nullable=False,
                )
                for c in self.columns
            ],
            metadata={
                CONTAINER_VERSION_KEY: b"3",
                MANIFEST_KEY: json.dumps(
                    self._manifest(), separators=(",", ":")
                ).encode(),
            },
        )
        part3_schema = pa.schema(
            [
                pa.field(f"{p.name}__{axis}", pa.float32(), nullable=False)
                for p in self.projections
                for axis in AXES[: p.dimension]
            ]
        )
        # A native stream: pyarrow writes pages to it without a copy through Python.
        self._out = pa.OSFile(str(self.path), "wb")
        self._part1 = pq.ParquetWriter(self._out, part1_schema, **_PQ)
        self._part3_path = self._tmp / "part3.parquet"
        self._part3 = pq.ParquetWriter(self._part3_path, part3_schema, **_PQ)
        self._closed = False
        self.stats: dict[str, Any] | None = None

    @staticmethod
    def _physical(column: Column) -> str:
        return f"{column.name}__count" if isinstance(column, Multi) else column.name

    def _manifest(self) -> dict[str, Any]:
        entries: dict[str, Any] = {}
        for c in self.columns:
            if isinstance(c, Numeric):
                entry: dict[str, Any] = {
                    "kind": "numeric",
                    "numericType": c.numeric_type,
                }
            elif isinstance(c, Multi):
                entry = {"kind": "multi", **({"scores": True} if c.scores else {})}
            else:
                entry = {"kind": "categorical"}
            if c.source_type is not None:
                entry["sourceType"] = c.source_type
            entries[c.name] = entry
        return {
            "idColumn": self.id_column,
            "columns": entries,
            "projections": [
                {"name": p.name, "dimension": p.dimension} for p in self.projections
            ],
        }

    def set_labels(self, name: str, labels: Sequence[str]) -> None:
        """Set (or replace) a categorical or multi-valued column's dictionary before close."""
        if name not in self._labels:
            raise KeyError(f"{name!r} is not a categorical or multi-valued column")
        self._labels[name] = list(labels)

    def write_chunk(
        self,
        ids: pa.Array | Sequence[str],
        annotations: Mapping[str, Any],
        projections: Mapping[str, np.ndarray],
    ) -> None:
        """Append one chunk of rows: one parquet row group in part 1 and in part 3.

        `annotations` maps every column to its chunk: int32 codes (categorical),
        float64 values (numeric) or a :class:`MultiChunk`. `projections` maps every
        projection to an (n, dimension) array.
        """
        ids = ids if isinstance(ids, pa.Array) else pa.array(ids, type=pa.string())
        if ids.type != pa.string():
            ids = ids.cast(pa.string())
        n = len(ids)
        if ids.null_count:
            raise ValueError("ids hold a null")
        if set(annotations) != {c.name for c in self.columns}:
            raise ValueError(
                f"chunk columns {sorted(annotations)} differ from the declared ones"
            )

        part1: dict[str, pa.Array] = {self.id_column: ids}
        for c in self.columns:
            value = annotations[c.name]
            if isinstance(c, Numeric):
                array = np.asarray(value, dtype=np.float64)
            elif isinstance(c, Categorical):
                array = _i32(value, f"{c.name} codes")
                if array.size and array.min() < -1:
                    raise ValueError(f"{c.name} has a code below -1")
                self._max_code[c.name] = max(
                    self._max_code[c.name], int(array.max(initial=-1))
                )
            else:
                array = self._append_multi(c, value, n)
            if array.shape != (n,):
                raise ValueError(
                    f"{c.name} chunk has shape {array.shape}, expected ({n},)"
                )
            part1[self._physical(c)] = pa.array(array)

        part3: dict[str, pa.Array] = {}
        for p in self.projections:
            coords = np.asarray(projections[p.name], dtype=np.float32)
            if coords.shape != (n, p.dimension):
                raise ValueError(f"projection {p.name} chunk has shape {coords.shape}")
            for axis in range(p.dimension):
                part3[f"{p.name}__{AXES[axis]}"] = pa.array(
                    np.ascontiguousarray(coords[:, axis])
                )

        self._part1.write_table(
            pa.table(list(part1.values()), schema=self._part1.schema),
            row_group_size=max(n, 1),
        )
        self._part3.write_table(
            pa.table(list(part3.values()), schema=self._part3.schema),
            row_group_size=max(n, 1),
        )
        self.rows += n

    def _append_multi(self, column: Multi, chunk: MultiChunk, n: int) -> np.ndarray:
        counts = _i32(chunk.counts, f"{column.name} counts")
        codes = _i32(chunk.codes, f"{column.name} codes")
        if counts.size and counts.min() < 0:
            raise ValueError(f"{column.name} has a negative hit count")
        if int(counts.sum(dtype=np.int64)) != codes.size:
            raise ValueError(
                f"{column.name} counts sum to {counts.sum()} for {codes.size} codes"
            )
        if codes.size and codes.min() < 0:
            raise ValueError(f"{column.name} has a negative hit code")
        payloads = self._payloads[column.name]
        payloads["codes"].append(codes)
        if payloads["codes"].elements > INT32_MAX:
            raise ValueError(
                f"{column.name} passes 2^31 hits, the reader's int32 offsets"
            )
        self._max_code[column.name] = max(
            self._max_code[column.name], int(codes.max(initial=-1))
        )
        if column.scores:
            if chunk.score_counts is None or chunk.scores is None:
                raise ValueError(
                    f"{column.name} declares scores but the chunk has none"
                )
            score_counts = _i32(chunk.score_counts, f"{column.name} score counts")
            if score_counts.size != codes.size or (
                score_counts.size and score_counts.min() < 0
            ):
                raise ValueError(
                    f"{column.name} needs one non-negative score count per hit"
                )
            scores = np.asarray(chunk.scores, dtype=np.float64)
            if int(score_counts.sum(dtype=np.int64)) != scores.size:
                raise ValueError(f"{column.name} score counts do not cover its scores")
            payloads["score_counts"].append(score_counts)
            payloads["scores"].append(scores)
        elif chunk.scores is not None:
            raise ValueError(f"{column.name} declares no scores but the chunk has some")
        return counts

    def _write_payloads(self) -> None:
        """Part 6: every dictionary, then every CSR payload, one value per payload."""
        schema = pa.schema(
            [
                pa.field("name", pa.string(), nullable=False),
                pa.field("data", pa.binary(), nullable=False),
            ]
        )
        # Parquet refuses a sink not at offset 0, so part 6 goes to its own file first.
        path = self._tmp / "part6.parquet"
        writer = pq.ParquetWriter(path, schema, **_PQ)
        dictionaries: list[tuple[str, bytes]] = []
        for c in self.columns:
            if isinstance(c, Numeric):
                continue
            labels = self._labels[c.name]
            if labels is None:
                raise ValueError(
                    f"{c.name} has no labels; pass them or call set_labels"
                )
            if self._max_code[c.name] >= len(labels):
                raise ValueError(
                    f"{c.name} uses code {self._max_code[c.name]} but has {len(labels)} labels"
                )
            encoded = [label.encode("utf-8") for label in labels]
            dictionaries.append((f"dict:{c.name}", b"".join(encoded)))
            dictionaries.append(
                (
                    f"dict:{c.name}:len",
                    np.array([len(b) for b in encoded], "<i4").tobytes(),
                )
            )
        writer.write_table(_payload_table(dictionaries, schema))
        # The large ones get a row group each, straight from a memory map: the only
        # copies are pyarrow's page and its snappy output.
        for payloads in self._payloads.values():
            for payload in payloads.values():
                payload.file.close()
                if payload.elements == 0:  # an empty file cannot be memory-mapped
                    writer.write_table(_payload_table([(payload.name, b"")], schema))
                    continue
                with pa.memory_map(str(payload.path)) as source:
                    writer.write_table(
                        _payload_table([(payload.name, source.read_buffer())], schema)
                    )
                payload.path.unlink()
        writer.close()
        self._append_file(path)

    def _append_file(self, path: Path) -> int:
        """Copy `path` onto the bundle in blocks and delete it; returns its size."""
        start = self._out.tell()
        with open(path, "rb") as source:
            while block := source.read(16 * 1024 * 1024):
                self._out.write(block)
        path.unlink()
        return self._out.tell() - start

    def close(self) -> dict[str, Any]:
        """Finish every part, assemble the bundle and check it; returns part sizes."""
        if self._closed:
            raise RuntimeError("writer already closed")
        self._closed = True
        try:
            self.stats = self._finish()
        except BaseException:
            self.path.unlink(missing_ok=True)
            raise
        finally:
            self._close_files()
            shutil.rmtree(self._tmp, ignore_errors=True)
        return self.stats

    def _finish(self) -> dict[str, Any]:
        self._part1.close()
        part1_bytes = self._out.tell()
        self._part3.close()
        self._out.write(DELIMITER)
        part2 = pa.Table.from_pylist(
            [
                {
                    "projection_name": p.name,
                    "dimensions": p.dimension,
                    "info_json": json.dumps(dict(p.info or {})),
                }
                for p in self.projections
            ],
            schema=pa.schema(
                [
                    ("projection_name", pa.string()),
                    ("dimensions", pa.int64()),
                    ("info_json", pa.string()),
                ]
            ),
        )
        buffer = pa.BufferOutputStream()
        pq.write_table(part2, buffer, **_PQ)
        self._out.write(buffer.getvalue())
        self._out.write(DELIMITER)
        part3_bytes = self._append_file(self._part3_path)
        # Settings (optional) and statistics (absent): a zero-byte slot reads as null.
        self._out.write(DELIMITER + (self.settings_part or b"") + DELIMITER + DELIMITER)
        part6_start = self._out.tell()
        self._write_payloads()
        part6_bytes = self._out.tell() - part6_start
        self._out.close()

        self._check_budget(
            "part 1",
            part1_bytes,
            8 + sum(8 if isinstance(c, Numeric) else 4 for c in self.columns),
        )
        self._check_budget(
            "part 3", part3_bytes, 4 * sum(p.dimension for p in self.projections)
        )
        found = count_delimiters(self.path)
        if found != 5:
            raise RuntimeError(
                f"{self.path} holds {found} delimiters, not 5: a value contains it"
            )
        return {
            "rows": self.rows,
            "bytes": self.path.stat().st_size,
            "part1_bytes": part1_bytes,
            "part3_bytes": part3_bytes,
            "part6_bytes": part6_bytes,
        }

    def _close_files(self) -> None:
        for payloads in self._payloads.values():
            for payload in payloads.values():
                payload.file.close()
        if not self._out.closed:
            self._out.close()

    def _check_budget(self, part: str, part_bytes: int, bytes_per_row: int) -> None:
        need = self.rows * bytes_per_row
        budget = max(MIN_PREALLOCATION_BUDGET, part_bytes * MAX_PREALLOCATION_RATIO)
        if need > budget:
            raise RuntimeError(
                f"{part} decodes to {need} bytes from {part_bytes}: over the reader's "
                f"{MAX_PREALLOCATION_RATIO}x preallocation budget, so the app would refuse it"
            )

    def abort(self) -> None:
        """Drop a half-written bundle and its temporary files."""
        if not self._closed:
            self._closed = True
            for writer in (self._part1, self._part3):
                with contextlib.suppress(OSError, pa.ArrowException):
                    writer.close()
            self._close_files()
            shutil.rmtree(self._tmp, ignore_errors=True)
            self.path.unlink(missing_ok=True)

    def __enter__(self) -> Self:
        return self

    def __exit__(self, exc_type, exc, tb) -> None:
        if exc_type is not None:
            self.abort()
        elif not self._closed:
            self.close()


def _payload_table(rows: list[tuple[str, Any]], schema: pa.Schema) -> pa.Table:
    data = [d if isinstance(d, pa.Buffer) else pa.py_buffer(d) for _, d in rows]
    offsets = np.zeros(len(data) + 1, dtype=np.int64)
    offsets[1:] = np.cumsum([d.size for d in data])
    if offsets[-1] > MAX_PAYLOAD_BYTES:
        raise ValueError(
            f"payloads {[n for n, _ in rows]} pass the 2 GiB a parquet value holds"
        )
    values = (
        data[0]
        if len(data) == 1
        else pa.py_buffer(b"".join(memoryview(d) for d in data))
    )
    array = pa.Array.from_buffers(
        pa.binary(),
        len(data),
        [None, pa.py_buffer(offsets.astype(np.int32).tobytes()), values],
    )
    return pa.table([pa.array([n for n, _ in rows], pa.string()), array], schema=schema)


def count_delimiters(path: str | os.PathLike, block: int = 16 * 1024 * 1024) -> int:
    """How often the part delimiter occurs in the file, read in blocks."""
    found = 0
    tail = b""
    with open(path, "rb") as file:
        while chunk := file.read(block):
            window = tail + chunk
            found += window.count(DELIMITER)
            # Keep the bytes a delimiter could straddle, minus one so none is counted twice.
            tail = window[-(len(DELIMITER) - 1) :]
    return found
