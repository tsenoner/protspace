#!/usr/bin/env python3
"""Build the curated showcase bundles behind protspace.app's Import-menu examples.

Strategy R (OpenSpec change ``curated-example-datasets``, design Decision 9): keep
each paper dataset's membership and published coordinates, refresh every annotation
source with the fixed CLI at the current UniProt release, and keep the paper's EAT
inputs and outputs for the two EAT examples. Recipes live in ``showcase.toml``; the
README next to this file has usage examples per dataset.

Every protspace step runs as a subprocess of the CLI checkout given by
``--cli-root`` (``uv run --frozen --project <cli-root> protspace …``), so this script
does not depend on which branch it is run from. Inputs are read-only; everything is
written under the output root (default ``~/protspace-showcase/2026_03``), which may
not lie inside the repository or an input directory.

Subcommands::

    build          build (or resume) bundles: --only ID (repeatable) or --all
    verify         run the verification gates on built bundles (= build --verify-only)
    report         clustering report + thumbnails for the default-view choice
    record-load    record the D2 browser measurement of a built bundle (tied to its sha256)
    stage-release  stage the verified showcase bundles, write the example manifest with
                   write_manifest.py, and print the owner's commands
    stage-perf     stage the perf-datasets release assets, rewrite
                   perf/datasets.manifest.json, and print the owner's commands

Neither staging command publishes anything: creating and uploading a release is the
repository owner's step.
"""

from __future__ import annotations

import argparse
import contextlib
import datetime as dt
import fnmatch
import hashlib
import importlib.util
import io
import json
import logging
import os
import re
import shlex
import shutil
import subprocess
import sys
import time
import tomllib
from collections import Counter
from collections.abc import Callable, Iterable, Sequence
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import pyarrow as pa
import pyarrow.compute as pc
import pyarrow.parquet as pq

logger = logging.getLogger("build_showcase")

SCRIPT_DIR = Path(__file__).resolve().parent
REPO_ROOT = SCRIPT_DIR.parents[3]
DEFAULT_CONFIG = SCRIPT_DIR / "showcase.toml"
# The web app's example manifest. Only write_manifest.py (next to this file)
# writes it; stage-release stages a new one through that writer.
EXAMPLE_MANIFEST = REPO_ROOT / "apps/web/src/explore/example-manifest.ts"
GITHUB_REPO = "tsenoner/protspace"

DELIMITER = b"---PARQUET_DELIMITER---"
ID_COLUMN = "protein_id"
INTERNAL_COLUMNS = ("sequence", "organism_id")
LEGACY_COLUMNS = ("length_fixed", "length_quantile")
TOOLTIP_ONLY_COLUMNS = frozenset({"gene_name", "protein_name", "uniprot_kb_id"})
CLUSTER_PREFIX = "cluster_"
PRED_MARKER = "__pred_"
FORMAT_VERSION_KEY = b"protspace_format_version"
FORMAT_VERSION = b"2"
KINDS = ("paper-refresh", "eat-graft", "demo-refresh")

# Display values the web app and `protspace style` treat as "missing".
NA_LABELS = frozenset({"", "<NA>", "NaN", "__NA__", "None"})
MISSING_TOKENS = NA_LABELS | {"nan", "null", "<N/A>"}

# Kelly's colours in the web app's order (packages/utils color-scheme.ts).
KELLYS = (
    "#F3C300",
    "#875692",
    "#F38400",
    "#A1CAF1",
    "#BE0032",
    "#C2B280",
    "#008856",
    "#E68FAC",
    "#0067A5",
    "#F99379",
    "#604E97",
    "#F6A600",
    "#B3446C",
    "#DCD300",
    "#882D17",
    "#8DB600",
    "#654522",
    "#E25822",
    "#2B3D26",
)
OTHER_COLOR = "#B8B8B8"
NA_COLOR = "#DDDDDD"

PROVENANCE_KEYS = (
    "example_id",
    "protspace_version",
    "git_sha",
    "builder_git_sha",
    "uniprot_release",
    "membership_release",
    "built_at",
    "command",
    "pipeline",
    "zenodo_doi",
)

UNIPROT_REST = "https://rest.uniprot.org/uniprotkb"
RELEASE_PROBE = f"{UNIPROT_REST}/search?query=accession:P69905&size=1&fields=accession"
# A stated UniProt release; anything else (a note such as "inferred; confirm")
# is an author fact still to confirm (tasks 7.1).
RELEASE_RE = re.compile(r"^\d{4}_\d{2}$")


class BuildError(RuntimeError):
    """A build step cannot continue (bad input, failed CLI step, violated guard)."""


# ---------------------------------------------------------------------------
# Bundle format v2 value encoding (mirrors protspace.data.annotations.encoding;
# test_build_showcase.py pins the two against each other)
# ---------------------------------------------------------------------------

_RESERVED = {";", "|", "%"} | {chr(c) for c in range(0x20)} | {chr(0x7F)}
_ENCODE_TABLE = str.maketrans({c: f"%{ord(c):02X}" for c in _RESERVED})
_DECODE_RE = re.compile(r"%([0-9A-Fa-f]{2})")


def encode_field(text: str) -> str:
    """Percent-encode the reserved set inside one free-text token."""
    return text.translate(_ENCODE_TABLE)


def decode_field(text: str) -> str:
    """Inverse of :func:`encode_field`; a no-op on text without ``%``."""
    if "%" not in text:
        return text
    return _DECODE_RE.sub(lambda m: chr(int(m.group(1), 16)), text)


def _split_legacy_hits(value: str) -> list[str]:
    parts: list[str] = []
    depth = 0
    start = 0
    for index, character in enumerate(value):
        if character == "(":
            depth += 1
        elif character == ")" and depth > 0:
            depth -= 1
        elif character == ";" and depth == 0:
            parts.append(value[start:index])
            start = index + 1
    parts.append(value[start:])
    return value.split(";") if depth != 0 else parts


def encode_legacy_cell(value: str) -> str:
    """Re-emit one v1 categorical cell in the v2 grammar (same parsed hits)."""
    encoded_hits: list[str] = []
    for hit in _split_legacy_hits(value):
        label, separator, suffix = hit.partition("|")
        encoded = encode_field(label)
        if separator:
            encoded = f"{encoded}|{encode_field(suffix)}"
        encoded_hits.append(encoded)
    return ";".join(encoded_hits)


def format_version(table: pa.Table) -> int:
    """The annotations table's wire-format version (unstamped = legacy v1)."""
    metadata = table.schema.metadata or {}
    try:
        return int(metadata.get(FORMAT_VERSION_KEY, b"1"))
    except (TypeError, ValueError):
        return 1


def migrate_v1_columns(
    table: pa.Table, columns: Iterable[str] | None = None
) -> tuple[pa.Table, dict[str, int]]:
    """Re-encode v1 string columns into the v2 grammar.

    Returns the table and, per column, how many cells changed. ``__pred_source``
    columns hold one opaque identifier per cell, so they are encoded as a single
    field (as ``protspace transfer`` does), never split into hits.
    """
    wanted = set(table.column_names if columns is None else columns)
    changed: dict[str, int] = {}
    arrays = []
    for name, column in zip(table.column_names, table.columns, strict=True):
        is_string = pa.types.is_string(column.type) or pa.types.is_large_string(
            column.type
        )
        if name not in wanted or name in {ID_COLUMN, "identifier"} or not is_string:
            arrays.append(column)
            continue
        opaque = name.endswith("__pred_source")
        values = column.to_pylist()
        migrated = [
            None
            if value is None
            else encode_field(value)
            if opaque
            else encode_legacy_cell(value)
            for value in values
        ]
        changed[name] = sum(a != b for a, b in zip(values, migrated, strict=True))
        arrays.append(pa.array(migrated, type=column.type))
    return pa.Table.from_arrays(arrays, names=table.column_names), changed


def display_values(cell: Any) -> list[str]:
    """Display values of a cell exactly as ``protspace style`` keys them.

    ``;`` splits hits, each hit loses its ``|score``/``|evidence`` suffix and is
    percent-decoded. Nothing is stripped, so the result matches the keys a styles
    file must use. ``None`` reads as ``"None"`` (what ``str()`` gives the CLI).
    """
    raw = "None" if cell is None else str(cell)
    return [decode_field(part.split("|", 1)[0]) for part in raw.split(";")]


def cell_labels(cell: Any) -> list[str]:
    """Clean category labels of a cell for gates and reports (missing → [])."""
    if cell is None:
        return []
    if not isinstance(cell, str):
        return [str(cell)]
    labels = []
    for hit in cell.split(";"):
        label = decode_field(hit.split("|", 1)[0]).strip()
        if label and label not in MISSING_TOKENS:
            labels.append(label)
    return labels


def as_int(value: Any) -> int | None:
    """``"123"``, ``123`` or ``123.0`` → 123; anything else → None."""
    try:
        return int(float(value))
    except (TypeError, ValueError):
        return None


def first_label(cell: Any) -> str | None:
    labels = cell_labels(cell)
    return labels[0] if labels else None


def is_missing(cell: Any) -> bool:
    return not cell_labels(cell)


# ---------------------------------------------------------------------------
# Bundle I/O
# ---------------------------------------------------------------------------


@dataclass
class Bundle:
    """The parts of a ``.parquetbundle``.

    ``raw_parts`` keeps the original bytes, so a part this script does not change
    (projections, statistics) is rewritten byte-for-byte.
    """

    annotations: pa.Table
    metadata: pa.Table
    data: pa.Table
    settings: dict | None = None
    statistics: pa.Table | None = None
    raw_parts: list[bytes] = field(default_factory=list)


def split_parts(blob: bytes) -> list[bytes]:
    parts = blob.split(DELIMITER)
    if not 3 <= len(parts) <= 5:
        raise BuildError(f"expected 3 to 5 bundle parts, found {len(parts)}")
    return parts


def _read_table(part: bytes) -> pa.Table:
    return pq.read_table(io.BytesIO(part))


def _settings_from_part(part: bytes) -> dict:
    table = _read_table(part)
    return json.loads(table.column("settings_json")[0].as_py())


def read_bundle(path: Path) -> Bundle:
    parts = split_parts(Path(path).read_bytes())
    settings = _settings_from_part(parts[3]) if len(parts) >= 4 and parts[3] else None
    statistics = _read_table(parts[4]) if len(parts) == 5 and parts[4] else None
    return Bundle(
        annotations=_read_table(parts[0]),
        metadata=_read_table(parts[1]),
        data=_read_table(parts[2]),
        settings=settings,
        statistics=statistics,
        raw_parts=parts,
    )


def parquet_bytes(table: pa.Table) -> bytes:
    buffer = io.BytesIO()
    pq.write_table(table, buffer)
    blob = buffer.getvalue()
    if DELIMITER in blob:
        raise BuildError("a serialized part contains the bundle delimiter")
    return blob


def settings_bytes(settings: dict) -> bytes:
    return parquet_bytes(pa.table({"settings_json": [json.dumps(settings)]}))


def join_parts(
    annotations: bytes,
    metadata: bytes,
    data: bytes,
    settings: bytes | None = None,
    statistics: bytes | None = None,
) -> bytes:
    """Assemble part bytes with protspace's layout rules.

    A statistics part without settings keeps a zero-byte settings slot, so the
    statistics stay the fifth part.
    """
    parts = [annotations, metadata, data]
    if settings is not None or statistics is not None:
        parts.append(settings or b"")
    if statistics is not None:
        parts.append(statistics)
    return DELIMITER.join(parts)


def atomic_write(path: Path, blob: bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(f".{path.name}.tmp-{os.getpid()}")
    tmp.write_bytes(blob)
    os.replace(tmp, path)


def rebuild_bundle(
    bundle_path: Path, table: pa.Table, settings: dict | None, out_path: Path
) -> None:
    """Write ``bundle_path`` with new annotations and settings.

    The projection parts and the statistics part keep their bytes.
    """
    parts = split_parts(bundle_path.read_bytes())
    statistics = parts[4] if len(parts) == 5 and parts[4] else None
    blob = join_parts(
        parquet_bytes(table),
        parts[1],
        parts[2],
        settings_bytes(settings) if settings is not None else None,
        statistics,
    )
    atomic_write(out_path, blob)


SPLIT_NAMES = {
    0: "annotations.parquet",
    1: "projections_metadata.parquet",
    2: "projections_data.parquet",
    4: "statistics.parquet",
}


def split_bundle(bundle_path: Path, out_dir: Path) -> dict[str, Path]:
    """Split a bundle into ``annotations/projections_metadata/projections_data/
    statistics.parquet`` and ``settings.json`` (PLAN §3 helper).

    Parquet parts are written byte-for-byte, and ``out_dir`` can be passed
    straight to ``protspace bundle -p`` / ``protspace stats -p``.
    """
    out_dir.mkdir(parents=True, exist_ok=True)
    parts = split_parts(Path(bundle_path).read_bytes())
    written: dict[str, Path] = {}
    for index, name in SPLIT_NAMES.items():
        if index < len(parts) and parts[index]:
            target = out_dir / name
            atomic_write(target, parts[index])
            written[name] = target
    if len(parts) >= 4 and parts[3]:
        target = out_dir / "settings.json"
        target.write_text(json.dumps(_settings_from_part(parts[3]), indent=1))
        written["settings.json"] = target
    return written


def normalize_id(table: pa.Table) -> pa.Table:
    """Name the identifier column ``protein_id`` (annotate writes ``identifier``)."""
    names = table.column_names
    if ID_COLUMN in names:
        return table
    source = "identifier" if "identifier" in names else names[0]
    return table.rename_columns([ID_COLUMN if n == source else n for n in names])


def extract_ann(bundle_path: Path) -> pa.Table:
    """Part 0 of a ``prepare`` output: the selected columns only (never the
    ``tmp/all_annotations`` cache), without the internal lookup columns."""
    parts = split_parts(Path(bundle_path).read_bytes())
    return drop_columns(normalize_id(_read_table(parts[0])), INTERNAL_COLUMNS)


# ---------------------------------------------------------------------------
# Projections
# ---------------------------------------------------------------------------


def parse_projection_spec(spec: str | Sequence[str]) -> list[tuple[str, str]]:
    """``"UMAP_2=ProtT5 — UMAP 2,PCA_2"`` → ``[(UMAP_2, ProtT5 — UMAP 2), (PCA_2, PCA_2)]``."""
    items = spec.split(",") if isinstance(spec, str) else list(spec)
    pairs: list[tuple[str, str]] = []
    for item in items:
        item = item.strip()
        if not item:
            continue
        source, sep, target = item.partition("=")
        source = source.strip()
        target = target.strip() if sep else source
        if not source or not target:
            raise BuildError(f"bad projection spec entry {item!r}")
        pairs.append((source, target))
    targets = [t for _, t in pairs]
    if len(set(targets)) != len(targets):
        raise BuildError(f"duplicate projection names in {spec!r}")
    return pairs


def _strip_quality(raw: str | None) -> str | None:
    if not raw:
        return raw
    try:
        info = json.loads(raw)
    except json.JSONDecodeError:
        return raw
    if isinstance(info, dict):
        info.pop("quality", None)
    return json.dumps(info)


def select_projections(
    metadata: pa.Table,
    data: pa.Table,
    spec: Sequence[tuple[str, str]],
    *,
    drop_quality: bool = False,
) -> tuple[pa.Table, pa.Table]:
    """Keep, rename and reorder projections (the first becomes the app's default).

    Coordinates are copied unchanged. ``drop_quality`` removes stale faithfulness
    from ``info_json`` when ``protspace stats`` will recompute it.
    """
    names = metadata.column("projection_name").to_pylist()
    missing = [source for source, _ in spec if source not in names]
    if missing:
        raise BuildError(f"projections {missing} not found; available: {names}")
    meta = metadata.take([names.index(source) for source, _ in spec])
    index = meta.column_names.index("projection_name")
    name_type = meta.schema.field("projection_name").type
    meta = meta.set_column(
        index, "projection_name", pa.array([t for _, t in spec], type=name_type)
    )
    if drop_quality and "info_json" in meta.column_names:
        info_index = meta.column_names.index("info_json")
        infos = [_strip_quality(v) for v in meta.column("info_json").to_pylist()]
        meta = meta.set_column(info_index, "info_json", pa.array(infos, pa.string()))

    data_index = data.column_names.index("projection_name")
    data_type = data.schema.field("projection_name").type
    pieces = []
    for source, target in spec:
        piece = data.filter(pc.equal(data.column("projection_name"), source))
        piece = piece.set_column(
            data_index,
            "projection_name",
            pa.array([target] * piece.num_rows, type=data_type),
        )
        pieces.append(piece)
    return meta, pa.concat_tables(pieces)


def select_proj(proj_dir: Path, spec: str | Sequence[str], out_dir: Path) -> None:
    """Directory form of :func:`select_projections` (PLAN §3 helper)."""
    metadata = pq.read_table(proj_dir / "projections_metadata.parquet")
    data = pq.read_table(proj_dir / "projections_data.parquet")
    meta, data = select_projections(metadata, data, parse_projection_spec(spec))
    out_dir.mkdir(parents=True, exist_ok=True)
    atomic_write(out_dir / "projections_metadata.parquet", parquet_bytes(meta))
    atomic_write(out_dir / "projections_data.parquet", parquet_bytes(data))


def read_projection_source(source: Path) -> tuple[pa.Table, pa.Table]:
    """Projection metadata and data from a bundle or a projections directory."""
    if source.is_dir():
        return (
            pq.read_table(source / "projections_metadata.parquet"),
            pq.read_table(source / "projections_data.parquet"),
        )
    bundle = read_bundle(source)
    return bundle.metadata, bundle.data


def projection_ids(data: pa.Table) -> list[str]:
    """Identifiers of the first projection, in file order."""
    first = data.column("projection_name")[0].as_py()
    rows = data.filter(pc.equal(data.column("projection_name"), first))
    return [str(v) for v in rows.column("identifier").to_pylist()]


def coordinate_map(data: pa.Table) -> dict[tuple[str, str], tuple]:
    names = data.column("projection_name").to_pylist()
    ids = data.column("identifier").to_pylist()
    xs = data.column("x").to_pylist()
    ys = data.column("y").to_pylist()
    zs = data.column("z").to_pylist() if "z" in data.column_names else [None] * len(xs)
    return {
        (n, str(i)): (x, y, z)
        for n, i, x, y, z in zip(names, ids, xs, ys, zs, strict=True)
    }


# ---------------------------------------------------------------------------
# Annotation tables
# ---------------------------------------------------------------------------


def drop_columns(table: pa.Table, names: Iterable[str]) -> pa.Table:
    drop = [n for n in names if n in table.column_names and n != ID_COLUMN]
    return table.drop_columns(drop) if drop else table


def column_order(names: Sequence[str], first: Sequence[str]) -> list[str]:
    """Id first, then ``first`` (present ones, in order), then the rest as they were."""
    head = [ID_COLUMN] if ID_COLUMN in names else []
    lead = [n for n in first if n in names and n not in head]
    rest = [n for n in names if n not in head and n not in lead]
    return head + lead + rest


def order_columns(table: pa.Table, first: Sequence[str]) -> pa.Table:
    return table.select(column_order(table.column_names, first))


def row_ids(table: pa.Table) -> list[str]:
    return [str(v) for v in normalize_id(table).column(ID_COLUMN).to_pylist()]


def strip_pandas_metadata(table: pa.Table) -> pa.Table:
    metadata = dict(table.schema.metadata or {})
    metadata.pop(b"pandas", None)
    return table.replace_schema_metadata(metadata or None)


def stamp_v2(table: pa.Table) -> pa.Table:
    metadata = dict(table.schema.metadata or {})
    metadata[FORMAT_VERSION_KEY] = FORMAT_VERSION
    return table.replace_schema_metadata(metadata)


def align_rows(table: pa.Table, ids: Sequence[str]) -> tuple[pa.Table, list[str]]:
    """Rows of ``table`` in ``ids`` order; ids without a row become null rows.

    Returns the aligned table and the ids that had no row. Duplicate ids keep
    their first row.
    """
    table = normalize_id(table)
    position: dict[str, int] = {}
    for i, value in enumerate(table.column(ID_COLUMN).to_pylist()):
        position.setdefault(str(value), i)
    take = [position.get(i) for i in ids]
    absent = [i for i, t in zip(ids, take, strict=True) if t is None]
    aligned = table.take(pa.array(take, type=pa.int64()))
    aligned = aligned.set_column(
        aligned.column_names.index(ID_COLUMN),
        ID_COLUMN,
        pa.array(list(ids), type=pa.string()),
    )
    return aligned, absent


def concat_aligned(tables: Sequence[pa.Table]) -> pa.Table:
    """Concatenate annotation tables whose columns or types differ.

    Missing columns become nulls; a column whose types disagree is cast to string
    everywhere, which is what the web app reads anyway.
    """
    tables = [strip_pandas_metadata(normalize_id(t)) for t in tables]
    names: list[str] = []
    types: dict[str, set] = {}
    for table in tables:
        for field_ in table.schema:
            if field_.name not in types:
                names.append(field_.name)
                types[field_.name] = set()
            types[field_.name].add(field_.type)
    target = {
        n: (next(iter(t)) if len(t) == 1 else pa.string()) for n, t in types.items()
    }
    aligned = []
    for table in tables:
        arrays = []
        for name in names:
            if name in table.column_names:
                column = table.column(name)
                if column.type != target[name]:
                    column = pc.cast(column, target[name])
                arrays.append(column)
            else:
                arrays.append(pa.nulls(table.num_rows, type=target[name]))
        aligned.append(pa.Table.from_arrays(arrays, names=names))
    return pa.concat_tables(aligned)


def matches_any(name: str, patterns: Iterable[str]) -> bool:
    return any(fnmatch.fnmatchcase(name, p) for p in patterns)


@dataclass
class GraftSpec:
    """How an EAT example combines the paper bundle with a fresh fetch.

    ``frozen`` columns always come from the paper (the EAT inputs and outputs).
    With ``keep_paper_columns`` every other paper column is kept too and the fetch
    only adds new columns; without it the fetch refreshes them. ``withheld`` maps a
    fresh column onto a new column filled only on the query rows (the withheld
    truth of a benchmark).
    """

    frozen: Sequence[str] = ()
    keep_paper_columns: bool = True
    withheld: dict[str, str] = field(default_factory=dict)
    split_column: str | None = None
    query_value: str | None = None


def query_mask(table: pa.Table, split_column: str, query_value: str) -> list[bool]:
    values = table.column(split_column).to_pylist()
    return [query_value in cell_labels(v) for v in values]


def graft_columns(
    paper: pa.Table, fresh: pa.Table, spec: GraftSpec
) -> tuple[pa.Table, dict[str, Any]]:
    """Combine paper and freshly fetched annotations; membership is the paper's.

    Never lets the fetch overwrite a frozen column. Returns the table and a report
    naming the origin of every column.
    """
    paper = drop_columns(normalize_id(paper), INTERNAL_COLUMNS)
    ids = row_ids(paper)
    fresh, absent = align_rows(drop_columns(fresh, INTERNAL_COLUMNS), ids)
    origin: dict[str, str] = {}
    names: list[str] = [ID_COLUMN]
    arrays: list[pa.ChunkedArray] = [paper.column(ID_COLUMN)]

    for name in paper.column_names:
        if name == ID_COLUMN:
            continue
        frozen = matches_any(name, spec.frozen)
        if frozen or spec.keep_paper_columns or name not in fresh.column_names:
            arrays.append(paper.column(name))
            origin[name] = "paper-frozen" if frozen else "paper"
        else:
            arrays.append(fresh.column(name))
            origin[name] = "refreshed"
        names.append(name)

    mask = None
    if spec.withheld:
        if not spec.split_column or spec.query_value is None:
            raise BuildError("withheld columns need split_column and query_value")
        mask = query_mask(paper, spec.split_column, spec.query_value)

    for name in fresh.column_names:
        if name == ID_COLUMN or name in origin:
            continue
        if matches_any(name, spec.frozen):
            continue  # a fresh value of a frozen column must never reach the bundle
        arrays.append(fresh.column(name))
        names.append(name)
        origin[name] = "refreshed"

    for source, target in spec.withheld.items():
        if source not in fresh.column_names:
            raise BuildError(f"withheld source column {source!r} was not fetched")
        values = fresh.column(source).to_pylist()
        kept = [v if q else None for v, q in zip(values, mask, strict=True)]
        arrays.append(pa.chunked_array([pa.array(kept, type=pa.string())]))
        names.append(target)
        origin[target] = "withheld-truth"

    table = pa.Table.from_arrays(arrays, names=names)
    return table, {"origin": origin, "absent_from_fetch": absent}


def refill_violations(
    table: pa.Table, split_column: str, query_value: str, columns: Sequence[str]
) -> dict[str, list[str]]:
    """Query rows whose guarded columns hold a value (the hold-out leaked)."""
    mask = query_mask(table, split_column, query_value)
    ids = row_ids(table)
    violations: dict[str, list[str]] = {}
    for column in columns:
        if column not in table.column_names:
            continue
        values = table.column(column).to_pylist()
        leaked = [
            i
            for i, v, q in zip(ids, values, mask, strict=True)
            if q and not is_missing(v)
        ]
        if leaked:
            violations[column] = leaked
    return violations


def assert_no_refill(
    table: pa.Table, split_column: str, query_value: str, columns: Sequence[str]
) -> None:
    violations = refill_violations(table, split_column, query_value, columns)
    if violations:
        summary = {c: v[:5] for c, v in violations.items()}
        raise BuildError(
            f"hold-out leak: query rows regained {sorted(violations)} (first ids: "
            f"{summary}); no step may refill the withheld columns"
        )


# ---------------------------------------------------------------------------
# Provenance (G15, G10)
# ---------------------------------------------------------------------------


def set_provenance(table: pa.Table, provenance: dict[str, Any]) -> pa.Table:
    """Write provenance key/values into the annotations' parquet metadata.

    Values that are not strings are stored as JSON. Readers ignore unknown keys;
    ``protspace_format_version`` is kept.
    """
    unknown = set(provenance) - set(PROVENANCE_KEYS)
    if unknown:
        raise BuildError(f"unknown provenance keys {sorted(unknown)}")
    metadata = dict(strip_pandas_metadata(table).schema.metadata or {})
    for key, value in provenance.items():
        if value is None:
            continue
        text = value if isinstance(value, str) else json.dumps(value, sort_keys=True)
        metadata[key.encode()] = text.encode()
    return table.replace_schema_metadata(metadata)


def read_provenance(table: pa.Table) -> dict[str, Any]:
    metadata = table.schema.metadata or {}
    result: dict[str, Any] = {}
    for key in PROVENANCE_KEYS:
        raw = metadata.get(key.encode())
        if raw is None:
            continue
        text = raw.decode()
        try:
            value = json.loads(text)
            result[key] = value if isinstance(value, dict | list) else text
        except json.JSONDecodeError:
            result[key] = text
    return result


def release_groups(
    origin: dict[str, str], columns: Sequence[str], releases: dict[str, str | None]
) -> dict[str, dict[str, Any]]:
    """``{group: {release, columns}}`` for every annotation column.

    ``origin`` maps a column to its group (``refreshed``, ``paper``, …); columns
    not in it are ``computed`` when they are cluster columns and ``refreshed``
    otherwise.
    """
    groups: dict[str, dict[str, Any]] = {}
    for column in columns:
        if column == ID_COLUMN:
            continue
        group = origin.get(column)
        if group is None:
            group = "computed" if column.startswith(CLUSTER_PREFIX) else "refreshed"
        if group == "paper-frozen":
            group = "paper"
        entry = groups.setdefault(
            group, {"release": releases.get(group), "columns": []}
        )
        entry["columns"].append(column)
    return groups


# ---------------------------------------------------------------------------
# EAT accuracy (phosphatase benchmark; logic of research/critic/c3_eat.py)
# ---------------------------------------------------------------------------

EC_RE = re.compile(r"\d+\.[\d-]+\.[\d-]+\.[\dn-]+")


def ec_numbers(cell: Any) -> frozenset[str]:
    if cell is None:
        return frozenset()
    return frozenset(EC_RE.findall(decode_field(str(cell))))


def eat_accuracy(
    table: pa.Table,
    *,
    column: str,
    truth_column: str,
    split_column: str,
    query_value: str,
    threshold: float,
    compare: str = "ec",
) -> dict[str, Any]:
    """Exact-match transfer accuracy on the query rows that have a truth value.

    A transfer is correct when the predicted set equals the truth set (EC numbers
    by regex, or labels). Reported overall and for reliability >= ``threshold``.
    """
    extract = ec_numbers if compare == "ec" else (lambda c: frozenset(cell_labels(c)))
    mask = query_mask(table, split_column, query_value)
    truth = table.column(truth_column).to_pylist()
    predicted = table.column(f"{column}__pred_value").to_pylist()
    confidence = table.column(f"{column}__pred_confidence").to_pylist()
    rows = []
    for q, t, p, c in zip(mask, truth, predicted, confidence, strict=True):
        truth_set = extract(t)
        if not q or not truth_set:
            continue
        pred_set = extract(p)
        rows.append((bool(pred_set) and pred_set == truth_set, c))
    high = [ok for ok, c in rows if c is not None and c >= threshold]

    def pct(values: list[bool]) -> float | None:
        return round(100 * sum(values) / len(values), 1) if values else None

    return {
        "n": len(rows),
        "accuracy": pct([ok for ok, _ in rows]),
        "threshold": threshold,
        "n_at_threshold": len(high),
        "accuracy_at_threshold": pct(high),
    }


# ---------------------------------------------------------------------------
# Catalog default views (the one-line edit lives in the web catalog)
# ---------------------------------------------------------------------------

_ID_RE = re.compile(r"\bid\s*:\s*(['\"])(?P<id>[^'\"]+)\1")
_VIEW_RE = re.compile(r"defaultView\s*:\s*\{(?P<body>.*?)\}", re.S)
_FIELD_RE = r"\b{name}\s*:\s*(['\"])(?P<value>.*?)\1"
_TOOLTIP_RE = re.compile(r"\btooltip\s*:\s*\[(?P<items>.*?)\]", re.S)
_STRING_RE = re.compile(r"(['\"])(?P<value>.*?)\1")


def parse_catalog_default_views(source: str) -> dict[str, dict[str, Any]]:
    """``{id: {projection, annotation, tooltip}}`` from ``example-datasets.ts``.

    Tolerant of formatting: each ``id:`` owns the ``defaultView: {…}`` that follows
    it before the next ``id:``. Entries without a defaultView are left out.
    """
    views: dict[str, dict[str, Any]] = {}
    matches = list(_ID_RE.finditer(source))
    for index, match in enumerate(matches):
        end = matches[index + 1].start() if index + 1 < len(matches) else len(source)
        view = _VIEW_RE.search(source, match.end(), end)
        if not view:
            continue
        body = view.group("body")
        entry: dict[str, Any] = {}
        for name in ("projection", "annotation"):
            found = re.search(_FIELD_RE.format(name=name), body)
            if found:
                entry[name] = found.group("value")
        tooltip = _TOOLTIP_RE.search(body)
        entry["tooltip"] = (
            [m.group("value") for m in _STRING_RE.finditer(tooltip.group("items"))]
            if tooltip
            else []
        )
        if "projection" in entry and "annotation" in entry:
            views[match.group("id")] = entry
    return views


def resolve_default_view(
    ds_id: str, dataset: dict, catalog: Path | None
) -> tuple[dict[str, Any], str]:
    """The catalog's defaultView when the catalog has one for ``ds_id``, else the
    provisional one in showcase.toml."""
    source = "showcase.toml (provisional)"
    if catalog and catalog.is_file():
        text = catalog.read_text()
        views = parse_catalog_default_views(text)
        if ds_id in views:
            return views[ds_id], f"catalog ({catalog.name})"
        if any(m.group("id") == ds_id for m in _ID_RE.finditer(text)):
            source += "; WARNING: the catalog has this id but no parsable defaultView"
    view = dict(dataset.get("default_view") or {})
    view.setdefault("tooltip", [])
    return view, source


# ---------------------------------------------------------------------------
# Styles
# ---------------------------------------------------------------------------


def column_display_values(table: pa.Table, column: str) -> Counter:
    counts: Counter = Counter()
    for cell in table.column(column).to_pylist():
        counts.update(display_values(cell))
    return counts


def _present(value: str, values: set[str]) -> bool:
    if value in values:
        return True
    return value in NA_LABELS and bool(values & NA_LABELS)


def filter_styles(
    styles: dict[str, dict], table: pa.Table
) -> tuple[dict[str, dict], list[str]]:
    """Drop style entries naming columns or values the built data lacks.

    ``protspace style`` fails on an unknown colour/shape value, and refreshed
    annotations can lose a category. Pinned lists shrink the same way, and
    ``maxVisibleValues`` follows a pinned list that has no ``__REST__``.
    """
    kept: dict[str, dict] = {}
    notes: list[str] = []
    for column, entry in styles.items():
        if column not in table.column_names:
            notes.append(f"style for missing column {column!r} dropped")
            continue
        values = set(column_display_values(table, column))
        entry = json.loads(json.dumps(entry))
        for key in ("colors", "shapes"):
            if key in entry:
                for value in list(entry[key]):
                    if not _present(value, values):
                        notes.append(f"{column}: {key} for absent {value!r} dropped")
                        del entry[key][value]
        if "hiddenValues" in entry:
            entry["hiddenValues"] = [
                v for v in entry["hiddenValues"] if _present(v, values)
            ]
        if "pinnedValues" in entry:
            pinned = []
            for value in entry["pinnedValues"]:
                if value == "__REST__" or _present(value, values):
                    pinned.append(value)
                else:
                    notes.append(f"{column}: pinned {value!r} absent, dropped")
            entry["pinnedValues"] = pinned
            if "__REST__" not in pinned and pinned:
                entry["maxVisibleValues"] = len(pinned)
        kept[column] = entry
    return kept, notes


def filter_legend(entry: dict, table: pa.Table, column: str) -> tuple[dict, list[str]]:
    """Keep a carried-over legend's categories that still exist in the data."""
    values = set(column_display_values(table, column))
    entry = json.loads(json.dumps(entry))
    categories = entry.get("categories") or {}
    dropped = [
        key
        for key in categories
        if key != "__NA__" and not _present(key, values) and key not in NA_LABELS
    ]
    for key in dropped:
        del categories[key]
    return entry, [f"{column}: legend category {k!r} absent, dropped" for k in dropped]


def unwrap_legends(settings: dict | None) -> dict:
    """The annotation-keyed legend map of a flat or envelope settings dict."""
    if not settings:
        return {}
    inner = settings.get("legendSettings")
    if isinstance(inner, dict) and "exportOptions" in settings:
        return dict(inner)
    return dict(settings)


def make_settings(legends: dict, envelope: dict | None) -> dict | None:
    """Flat legend map, or the frontend envelope when EAT display settings apply."""
    if envelope:
        settings = {"legendSettings": legends, "exportOptions": {}}
        settings.update(envelope)
        return settings
    return legends or None


# ---------------------------------------------------------------------------
# Gates
# ---------------------------------------------------------------------------

FAMILY_TRUNCATION = re.compile(r"\(TC [^)]*$")
SECTION_PSEUDO = re.compile(r"^In the .*section", re.IGNORECASE)


@dataclass
class Gate:
    name: str
    status: str  # pass | fail | warn | pending | skip
    detail: str = ""
    data: dict[str, Any] = field(default_factory=dict)


def label_counts(table: pa.Table, column: str) -> Counter:
    """Legend-style counts: each label of a multi-valued cell counts once."""
    counts: Counter = Counter()
    for cell in table.column(column).to_pylist():
        counts.update(dict.fromkeys(cell_labels(cell), 1))
    return counts


def family_defects(table: pa.Table, column: str) -> dict[str, list[str]]:
    truncated, pseudo = set(), set()
    for cell in table.column(column).to_pylist():
        for label in cell_labels(cell):
            if FAMILY_TRUNCATION.search(label):
                truncated.add(label)
            if SECTION_PSEUDO.search(label):
                pseudo.add(label)
    return {"truncated_tc": sorted(truncated), "section_pseudo": sorted(pseudo)}


def within(actual: float, expected: float, rel_tol: float, abs_tol: float) -> bool:
    return abs(actual - expected) <= max(abs(expected) * rel_tol, abs_tol)


def gate_category_counts(table: pa.Table, params: dict) -> Gate:
    column = params["column"]
    counts = label_counts(table, column)
    rel, absolute = params.get("rel_tol", 0.0), params.get("abs_tol", 0)
    off = {
        label: {"expected": expected, "actual": counts.get(label, 0)}
        for label, expected in params["expected"].items()
        if not within(counts.get(label, 0), expected, rel, absolute)
    }
    status = "fail" if off else "pass"
    return Gate(
        f"counts:{column}",
        status,
        f"{len(params['expected']) - len(off)}/{len(params['expected'])} within "
        f"±{rel:.1%} (min ±{absolute})",
        {"outside": off},
    )


def _by_group(table: pa.Table, column: str, by: str) -> dict[str, Counter]:
    groups: dict[str, Counter] = {}
    for cell, group in zip(
        table.column(column).to_pylist(), table.column(by).to_pylist(), strict=True
    ):
        key = first_label(group) or ""
        for label in set(cell_labels(cell)):
            groups.setdefault(label, Counter())[key] += 1
    return groups


def gate_label_split(table: pa.Table, params: dict) -> Gate:
    """A label shared between groups (e.g. kinases in human and fly)."""
    split = _by_group(table, params["column"], params["by"]).get(
        params["label"], Counter()
    )
    total = sum(split.values())
    problems = []
    if "expected_total" in params and not within(
        total, params["expected_total"], params.get("rel_tol", 0.0), 0
    ):
        problems.append(f"total {total} vs {params['expected_total']}")
    for group, minimum in params.get("min_per_group", {}).items():
        if split.get(group, 0) < minimum:
            problems.append(f"{group} {split.get(group, 0)} < {minimum}")
    return Gate(
        f"shared:{params['label']}",
        "fail" if problems else "pass",
        "; ".join(problems) or f"{total} total, {dict(split)}",
        {"split": dict(split)},
    )


def gate_label_exclusive(table: pa.Table, params: dict) -> Gate:
    """Labels found (almost) only in one group (e.g. MHC only in human)."""
    groups = _by_group(table, params["column"], params["by"])
    minimum = params.get("min_fraction", 1.0)
    details, problems = {}, []
    for label in params["labels"]:
        split = groups.get(label, Counter())
        total = sum(split.values())
        fraction = split.get(params["group"], 0) / total if total else 0.0
        details[label] = {"n": total, "fraction": round(fraction, 4)}
        if total == 0 or fraction < minimum:
            problems.append(f"{label}: n={total}, {params['group']} {fraction:.1%}")
    return Gate(
        f"exclusive:{params['group']}",
        "fail" if problems else "pass",
        "; ".join(problems) or f"{len(params['labels'])} labels ≥ {minimum:.0%}",
        details,
    )


def gate_accession_label(table: pa.Table, params: dict) -> Gate:
    ids = row_ids(table)
    name = f"label:{params['accession']}"
    if params["accession"] not in ids:
        return Gate(name, "fail", "accession not in the bundle")
    cell = table.column(params["column"])[ids.index(params["accession"])].as_py()
    ok = params["label"] in cell_labels(cell)
    return Gate(name, "pass" if ok else "fail", f"{params['column']} = {cell!r}")


def _coords(bundle: Bundle, projection: str):
    import numpy as np

    rows = bundle.data.filter(
        pc.equal(bundle.data.column("projection_name"), projection)
    )
    if rows.num_rows == 0:
        raise BuildError(f"projection {projection!r} not in the bundle")
    ids = [str(v) for v in rows.column("identifier").to_pylist()]
    xy = np.column_stack(
        [
            np.asarray(rows.column("x").to_pylist(), dtype=float),
            np.asarray(rows.column("y").to_pylist(), dtype=float),
        ]
    )
    return ids, xy


def gate_neighbourhood(bundle: Bundle, params: dict) -> Gate:
    """Mean share of ``value`` in ``column`` among the k layout neighbours of a
    subset (accessions, or rows whose ``subset_column`` has one of ``subset_labels``).
    """
    import numpy as np
    from sklearn.neighbors import NearestNeighbors

    table = bundle.annotations
    ann_ids = row_ids(table)
    row_of = {pid: i for i, pid in enumerate(ann_ids)}
    ids, xy = _coords(bundle, params["projection"])
    values = table.column(params["column"]).to_pylist()
    value_at = [values[row_of[i]] if i in row_of else None for i in ids]
    if "accessions" in params:
        wanted = set(params["accessions"])
        subset = [k for k, i in enumerate(ids) if i in wanted]
    else:
        labels = table.column(params["subset_column"]).to_pylist()
        targets = set(params["subset_labels"])
        subset = [
            k
            for k, i in enumerate(ids)
            if i in row_of and targets & set(cell_labels(labels[row_of[i]]))
        ]
    name = f"neighbourhood:{params.get('name', params['value'])}"
    if not subset:
        return Gate(name, "fail", "empty subset")
    k = int(params.get("k", 50))
    nn = NearestNeighbors(n_neighbors=min(k + 1, len(ids))).fit(xy)
    _, neighbours = nn.kneighbors(xy[subset])
    shares = []
    for row, own in zip(neighbours, subset, strict=True):
        others = [n for n in row if n != own][:k]
        hits = [params["value"] in cell_labels(value_at[n]) for n in others]
        shares.append(sum(hits) / len(hits) if hits else 0.0)
    mean = float(np.mean(shares))
    ok = True
    if "min_mean" in params:
        ok = mean >= params["min_mean"]
    if "max_mean" in params:
        ok = ok and mean <= params["max_mean"]
    return Gate(
        name,
        "pass" if ok else "fail",
        f"n={len(subset)}, mean share of {params['value']!r} among {k} NN = {mean:.3f}",
        {"mean": mean, "n": len(subset)},
    )


def gate_eat_transfers(table: pa.Table, params: dict) -> Gate:
    column = params["column"]
    values = table.column(f"{column}__pred_value").to_pylist()
    confidence = table.column(f"{column}__pred_confidence").to_pylist()
    predicted = [
        c for v, c in zip(values, confidence, strict=True) if not is_missing(v)
    ]
    threshold = params.get("threshold", 0.5)
    high = sum(1 for c in predicted if c is not None and c >= threshold)
    ok = len(predicted) == params["expected_predicted"] and high == params.get(
        "expected_at_threshold", high
    )
    return Gate(
        f"eat:{column}",
        "pass" if ok else "fail",
        f"{high} of {len(predicted)} transfers at reliability ≥ {threshold}",
        {"predicted": len(predicted), "at_threshold": high},
    )


def gate_eat_source(table: pa.Table, params: dict) -> Gate:
    column = params["column"]
    ids = row_ids(table)
    name = f"eat-source:{params['accession']}"
    if params["accession"] not in ids:
        return Gate(name, "fail", "accession not in the bundle")
    row = ids.index(params["accession"])
    source = table.column(f"{column}__pred_source")[row].as_py()
    value = table.column(f"{column}__pred_value")[row].as_py()
    confidence = table.column(f"{column}__pred_confidence")[row].as_py()
    ok = (
        source is not None
        and decode_field(str(source)) == params["source"]
        and confidence is not None
        and abs(confidence - params["confidence"]) <= params.get("tol", 0.001)
        and params.get("value_contains", "") in decode_field(str(value))
    )
    return Gate(
        name,
        "pass" if ok else "fail",
        f"← {source} ({value}, reliability {confidence})",
    )


def gate_eat_accuracy(table: pa.Table, params: dict) -> Gate:
    result = eat_accuracy(
        table,
        column=params["column"],
        truth_column=params["truth_column"],
        split_column=params["split_column"],
        query_value=params["query_value"],
        threshold=params.get("threshold", 0.5),
        compare=params.get("compare", "ec"),
    )
    tol = params.get("tol_pp", 0.1)
    ok = (
        result["n"] == params["expected_n"]
        and result["accuracy"] is not None
        and abs(result["accuracy"] - params["expected_accuracy"]) <= tol
        and result["n_at_threshold"] == params["expected_n_at_threshold"]
        and result["accuracy_at_threshold"] is not None
        and abs(
            result["accuracy_at_threshold"] - params["expected_accuracy_at_threshold"]
        )
        <= tol
    )
    return Gate(
        f"eat-accuracy:{params['column']}",
        "pass" if ok else "fail",
        f"{result['accuracy']} % over {result['n']}; {result['accuracy_at_threshold']} % "
        f"over {result['n_at_threshold']} at reliability ≥ {result['threshold']}",
        result,
    )


def gate_no_refill(table: pa.Table, params: dict) -> Gate:
    violations = refill_violations(
        table, params["split_column"], params["query_value"], params["columns"]
    )
    return Gate(
        "no-refill",
        "fail" if violations else "pass",
        f"leaked: { {c: len(v) for c, v in violations.items()} }"
        if violations
        else f"{params['columns']} empty on every query row",
    )


def gate_coverage(table: pa.Table, params: dict) -> Gate:
    values = table.column(params["column"]).to_pylist()
    covered = sum(1 for v in values if not is_missing(v)) / max(len(values), 1)
    ok = covered >= params["min_fraction"]
    return Gate(
        f"coverage:{params['column']}",
        "pass" if ok else "fail",
        f"{covered:.1%} non-empty (min {params['min_fraction']:.0%})",
        {"fraction": covered},
    )


GATE_TYPES: dict[str, Callable[..., Gate]] = {
    "category_counts": gate_category_counts,
    "label_split": gate_label_split,
    "label_exclusive": gate_label_exclusive,
    "accession_label": gate_accession_label,
    "eat_transfers": gate_eat_transfers,
    "eat_source": gate_eat_source,
    "eat_accuracy": gate_eat_accuracy,
    "no_refill": gate_no_refill,
    "coverage": gate_coverage,
}
BUNDLE_GATE_TYPES = {"neighbourhood": gate_neighbourhood}


def common_gates(
    bundle: Bundle,
    dataset: dict,
    view: dict,
    *,
    frozen: Sequence[str] = (),
) -> list[Gate]:
    """The gates every example must pass (design Decision 9)."""
    table = bundle.annotations
    columns = [c for c in table.column_names if c != ID_COLUMN]
    projections = bundle.metadata.column("projection_name").to_pylist()
    gates: list[Gate] = []

    expected = dataset.get("proteins")
    gates.append(
        Gate(
            "proteins",
            "pass" if table.num_rows == expected else "fail",
            f"{table.num_rows} rows (expected {expected})",
        )
    )
    ids = row_ids(table)
    duplicates = len(ids) - len(set(ids))
    proj_ids = set(projection_ids(bundle.data)) if bundle.data.num_rows else set()
    gates.append(
        Gate(
            "membership",
            "pass" if not duplicates and set(ids) == proj_ids else "fail",
            f"{duplicates} duplicate ids; {len(set(ids) ^ proj_ids)} ids differ "
            "between annotations and projections",
        )
    )
    leaked = [c for c in INTERNAL_COLUMNS + LEGACY_COLUMNS if c in columns]
    gates.append(
        Gate(
            "no-internal-or-legacy",
            "fail" if leaked else "pass",
            f"present: {leaked}" if leaked else "no sequence/organism_id/length bins",
        )
    )
    version = format_version(table)
    gates.append(
        Gate("format-v2", "pass" if version == 2 else "fail", f"version {version}")
    )

    # The paper's column and any refreshed copy of it (e.g. the withheld truth).
    family_columns = [
        c for c in columns if c.startswith("protein_families") and PRED_MARKER not in c
    ]
    for column in family_columns:
        defects = family_defects(table, column)
        bad = defects["truncated_tc"] + defects["section_pseudo"]
        status = (
            "pass" if not bad else ("warn" if matches_any(column, frozen) else "fail")
        )
        gates.append(
            Gate(
                f"family-parser:{column}",
                status,
                f"{len(defects['truncated_tc'])} '(TC n' and "
                f"{len(defects['section_pseudo'])} 'In the … section' labels"
                + (" (frozen paper column)" if bad and status == "warn" else ""),
                defects,
            )
        )

    if dataset.get("xref_pdb_both", True) and "xref_pdb" in columns:
        values = {first_label(v) for v in table.column("xref_pdb").to_pylist()}
        both = {"True", "False"} <= values
        status = (
            "pass" if both else ("warn" if matches_any("xref_pdb", frozen) else "fail")
        )
        gates.append(
            Gate("xref_pdb", status, f"values {sorted(v for v in values if v)}")
        )

    reviewed = dataset.get("reviewed")
    if reviewed and "reviewed" in columns:
        counts = label_counts(table, "reviewed")
        if reviewed == "mixed":
            ok = counts.get("Swiss-Prot", 0) > 0 and counts.get("TrEMBL", 0) > 0
        else:
            ok = set(counts) == {reviewed}
        gates.append(Gate("reviewed", "pass" if ok else "fail", f"{dict(counts)}"))

    gates.append(
        obsolete_gate(
            "obsolete-accessions",
            obsolete_rows(table),
            dataset.get("max_obsolete", 0),
            "rows without a UniProt entry",
            "; state the count on the docs card",
        )
    )

    gates.append(check_default_view(view, columns, projections))

    settings = bundle.settings
    envelope = dataset.get("envelope")
    if envelope:
        ok = (
            isinstance(settings, dict)
            and isinstance(settings.get("legendSettings"), dict)
            and "exportOptions" in settings
            and all(settings.get(k) == v for k, v in envelope.items())
        )
        gates.append(
            Gate(
                "settings-envelope",
                "pass" if ok else "fail",
                f"EAT settings { ({k: settings.get(k) for k in envelope} if settings else None) }",
            )
        )
    elif settings is not None and not isinstance(settings, dict):
        gates.append(Gate("settings", "fail", "settings part is not a JSON object"))

    if bundle.statistics is not None:
        projection_spaces = {
            name
            for name, kind in zip(
                bundle.statistics.column("space_name").to_pylist(),
                bundle.statistics.column("space_kind").to_pylist(),
                strict=True,
            )
            if kind == "projection"
        }
        stale = sorted(projection_spaces - set(projections))
        gates.append(
            Gate(
                "statistics-names",
                "fail" if stale else "pass",
                f"statistics name unknown projections {stale}"
                if stale
                else "consistent",
            )
        )
        gates.append(faithfulness_gate(bundle.metadata, dataset))
    return gates


def faithfulness_gate(metadata: pa.Table, dataset: dict) -> Gate:
    """Every projection carries a computed faithfulness score (G7: PR #452)."""
    missing = []
    for name, raw in zip(
        metadata.column("projection_name").to_pylist(),
        metadata.column("info_json").to_pylist(),
        strict=True,
    ):
        try:
            quality = (json.loads(raw) if raw else {}).get("quality") or {}
        except json.JSONDecodeError:
            quality = {}
        knn = quality.get("knn_overlap") or {}
        if knn.get("value") is None:
            missing.append(f"{name} ({knn.get('skipped', 'absent')})")
    status = "pass" if not missing else dataset.get("faithfulness_severity", "fail")
    return Gate(
        "faithfulness",
        status,
        f"no faithfulness for {missing}"
        if missing
        else "computed for every projection",
    )


def obsolete_gate(
    name: str, rows: list[str] | None, limit: int, what: str, note: str = ""
) -> Gate:
    """At most ``limit`` rows without a UniProt entry; uncountable rows fail."""
    if rows is None:
        return Gate(
            name,
            "fail",
            f"cannot count {what}: none of {list(ENTRY_COLUMNS)} is in the table",
        )
    return Gate(
        name,
        "pass" if len(rows) <= limit else "fail",
        f"{len(rows)} {what} (limit {limit}){note}",
        {"count": len(rows), "ids": rows[:50]},
    )


#: UniProt entry columns: a row empty in every one of them has no UniProt entry.
#: ``protein_name`` is one the CLI always adds, even to ``annotate -a interpro``.
ENTRY_COLUMNS = ("reviewed", "protein_name")


def obsolete_rows(table: pa.Table) -> list[str] | None:
    """Rows the refresh found no UniProt entry for (empty reviewed and name).

    ``None`` when the table has none of :data:`ENTRY_COLUMNS`, so the count
    cannot be made; a caller must not read that as "none obsolete".
    """
    present = [c for c in ENTRY_COLUMNS if c in table.column_names]
    if not present:
        return None
    columns = [table.column(c).to_pylist() for c in present]
    return [
        pid
        for pid, *cells in zip(row_ids(table), *columns, strict=True)
        if all(is_missing(cell) for cell in cells)
    ]


def check_default_view(
    view: dict, columns: Sequence[str], projections: Sequence[str]
) -> Gate:
    """The drift guard's build-side twin: every defaultView name exists."""
    problems = []
    annotation = view.get("annotation")
    tooltip = list(view.get("tooltip") or [])
    if view.get("projection") not in projections:
        problems.append(f"projection {view.get('projection')!r} not in {projections}")
    if annotation not in columns:
        problems.append(f"annotation {annotation!r} missing")
    elif annotation in TOOLTIP_ONLY_COLUMNS or PRED_MARKER in (annotation or ""):
        problems.append(f"annotation {annotation!r} cannot colour the plot")
    missing = [t for t in tooltip if t not in columns]
    if missing:
        problems.append(f"tooltip names missing: {missing}")
    if len(set(tooltip)) != len(tooltip) or annotation in tooltip:
        problems.append("tooltip repeats a name or the annotation")
    return Gate(
        "default-view",
        "fail" if problems else "pass",
        "; ".join(problems) or f"{view}",
        {"view": view},
    )


#: Story gates that need the build's sources or facts; :func:`context_gates`
#: evaluates them.
CONTEXT_GATE_TYPES = frozenset(
    {"full_length_inputs", "source_column_kept", "pfam_duplicates", "browser_load"}
)


def run_story_gates(bundle: Bundle, specs: Sequence[dict]) -> list[Gate]:
    gates = []
    for spec in specs:
        params = dict(spec)
        kind = params.pop("type")
        try:
            if kind in GATE_TYPES:
                gates.append(GATE_TYPES[kind](bundle.annotations, params))
            elif kind in BUNDLE_GATE_TYPES:
                gates.append(BUNDLE_GATE_TYPES[kind](bundle, params))
            elif kind not in CONTEXT_GATE_TYPES:
                gates.append(Gate(kind, "fail", "unknown gate type"))
        except (KeyError, ValueError, pa.ArrowException) as error:
            gates.append(Gate(kind, "fail", f"{type(error).__name__}: {error}"))
    return gates


#: Gate statuses that let a bundle ship. ``pending`` (a measurement or an
#: author fact still to come) does not: it blocks stage-release like a failure.
PASSING_STATUSES = frozenset({"pass", "warn", "skip"})


def summarize(gates: Sequence[Gate]) -> tuple[bool, str]:
    counts = Counter(g.status for g in gates)
    ok = all(status in PASSING_STATUSES for status in counts)
    text = ", ".join(f"{n} {s}" for s, n in sorted(counts.items()))
    return ok, text


# ---------------------------------------------------------------------------
# Clustering report (G2): kNN label agreement per candidate view + thumbnails
# ---------------------------------------------------------------------------


def legend_view(labels: Sequence[str | None], top: int) -> list[str | None]:
    """Collapse labels outside the ``top`` most frequent into ``Other``."""
    counts = Counter(label for label in labels if label is not None)
    keep = {label for label, _ in counts.most_common(top)}
    return [None if lab is None else lab if lab in keep else "Other" for lab in labels]


def knn_agreement(
    xy,
    labels: Sequence[str | None],
    *,
    k: int = 15,
    max_queries: int = 20000,
    seed: int = 42,
) -> dict[str, Any]:
    """Share of each labelled point's k layout neighbours with its label.

    Neighbours are searched among labelled points only. ``kappa`` corrects for
    chance: (agreement − Σp²) / (1 − Σp²), so a view dominated by one category
    does not score high just by being uniform.
    """
    import numpy as np
    from sklearn.neighbors import NearestNeighbors

    keep = [i for i, lab in enumerate(labels) if lab is not None]
    result: dict[str, Any] = {
        "labelled": len(keep),
        "coverage": len(keep) / max(len(labels), 1),
    }
    if len(keep) <= k:
        return {**result, "agreement": None, "baseline": None, "kappa": None}
    points = np.asarray(xy, dtype=float)[keep]
    values = np.array([labels[i] for i in keep], dtype=object)
    rng = np.random.default_rng(seed)
    queries = rng.choice(len(keep), size=min(max_queries, len(keep)), replace=False)
    nn = NearestNeighbors(n_neighbors=k + 1).fit(points)
    _, neighbours = nn.kneighbors(points[queries])
    agree = []
    for q, row in zip(queries, neighbours, strict=True):
        others = [n for n in row if n != q][:k]
        agree.append(np.mean(values[others] == values[q]))
    shares = np.array(list(Counter(values.tolist()).values()), dtype=float) / len(
        values
    )
    baseline = float((shares**2).sum())
    agreement = float(np.mean(agree))
    kappa = (agreement - baseline) / (1 - baseline) if baseline < 1 else 0.0
    return {
        **result,
        "categories": len(shares),
        "agreement": round(agreement, 4),
        "baseline": round(baseline, 4),
        "kappa": round(kappa, 4),
        "queries": int(len(queries)),
    }


def stats_silhouettes(
    statistics: pa.Table | None, projection: str, annotation: str
) -> dict:
    """Whole-annotation and per-category silhouettes the legend strips will show."""
    if statistics is None:
        return {}
    frame = statistics.to_pandas()
    rows = frame[
        (frame.space_kind == "projection")
        & (frame.space_name == projection)
        & (frame.annotation == annotation)
        & (frame.metric == "silhouette")
        & (frame.label_kind == "annotation")
    ]
    overall = rows[rows.category.isna()]["value"]
    per_category = rows[rows.category.notna()].sort_values("value", ascending=False)
    return {
        "silhouette": None if overall.empty else round(float(overall.iloc[0]), 4),
        "per_category": {
            str(c): round(float(v), 4)
            for c, v in zip(per_category.category, per_category.value, strict=True)
        },
    }


def slug(text: str) -> str:
    return re.sub(r"[^A-Za-z0-9]+", "-", text).strip("-").lower() or "x"


def render_thumbnail(
    xy, labels: Sequence[str | None], path: Path, title: str, top: int
) -> None:
    import matplotlib

    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    import numpy as np

    xy = np.asarray(xy, dtype=float)
    view = legend_view(labels, top)
    counts = Counter(lab for lab in view if lab not in (None, "Other"))
    order = [lab for lab, _ in counts.most_common()]
    colors = {lab: KELLYS[i % len(KELLYS)] for i, lab in enumerate(order)}
    size = max(0.3, min(12.0, 30000 / max(len(xy), 1)))
    fig, ax = plt.subplots(figsize=(6, 6), dpi=120)
    for label, color in ((None, NA_COLOR), ("Other", OTHER_COLOR)):
        mask = np.array([lab == label for lab in view])
        if mask.any():
            ax.scatter(*xy[mask].T, s=size, c=color, linewidths=0, rasterized=True)
    handles = []
    for label in reversed(order):  # the most frequent is painted last, on top
        mask = np.array([lab == label for lab in view])
        handles.append(
            ax.scatter(
                *xy[mask].T,
                s=size,
                c=colors[label],
                linewidths=0,
                rasterized=True,
                label=f"{label} ({counts[label]})",
            )
        )
    ax.legend(
        handles=list(reversed(handles)),
        fontsize=6,
        markerscale=3,
        loc="best",
        frameon=False,
    )
    ax.set_title(title, fontsize=8)
    ax.set_xticks([])
    ax.set_yticks([])
    fig.tight_layout()
    path.parent.mkdir(parents=True, exist_ok=True)
    fig.savefig(path)
    plt.close(fig)


def clustering_report(
    bundle: Bundle,
    ds_id: str,
    candidates: dict,
    out_dir: Path,
    *,
    k: int = 15,
    max_queries: int = 20000,
    top: int = 10,
    thumbnails: bool = True,
) -> list[dict[str, Any]]:
    """Score every candidate annotation × projection; write JSON, Markdown, PNGs."""
    table = bundle.annotations
    ann_ids = row_ids(table)
    row_of = {pid: i for i, pid in enumerate(ann_ids)}
    projections = (
        candidates.get("projections")
        or bundle.metadata.column("projection_name").to_pylist()
    )
    rows: list[dict[str, Any]] = []
    for projection in projections:
        ids, xy = _coords(bundle, projection)
        for annotation in candidates.get("annotations", []):
            if annotation not in table.column_names:
                rows.append(
                    {
                        "projection": projection,
                        "annotation": annotation,
                        "error": "missing column",
                    }
                )
                continue
            cells = table.column(annotation).to_pylist()
            labels = [
                first_label(cells[row_of[i]]) if i in row_of else None for i in ids
            ]
            full = knn_agreement(xy, labels, k=k, max_queries=max_queries)
            shown = knn_agreement(
                xy, legend_view(labels, top), k=k, max_queries=max_queries
            )
            row = {
                "projection": projection,
                "annotation": annotation,
                "coverage": round(full["coverage"], 4),
                "categories": full.get("categories"),
                "knn_agreement": full["agreement"],
                "knn_kappa": full["kappa"],
                "legend_agreement": shown["agreement"],
                "legend_kappa": shown["kappa"],
                **stats_silhouettes(bundle.statistics, projection, annotation),
            }
            if thumbnails:
                thumb = (
                    out_dir / "thumbs" / f"{slug(annotation)}__{slug(projection)}.png"
                )
                render_thumbnail(
                    xy, labels, thumb, f"{ds_id} · {annotation} · {projection}", top
                )
                row["thumbnail"] = str(thumb.relative_to(out_dir))
            rows.append(row)
    rows.sort(key=lambda r: -(r.get("legend_kappa") or -1))
    out_dir.mkdir(parents=True, exist_ok=True)
    (out_dir / "report.json").write_text(json.dumps(rows, indent=1))
    lines = [
        f"# Clustering report · {ds_id}",
        "",
        f"kNN label agreement in the 2D layout (k = {k}, up to {max_queries} query points), "
        f"chance-corrected as kappa. The legend view keeps the top {top} labels plus Other, "
        "which is what the web legend colours. Multi-valued cells count by their first "
        "label. Silhouettes are the values the legend strips will show.",
        "",
        "| projection | annotation | coverage | categories | legend κ | full κ "
        "| silhouette | per-category silhouette (best, worst) | thumbnail |",
        "|---|---|---:|---:|---:|---:|---:|---|---|",
    ]
    for row in rows:
        if "error" in row:
            lines.append(
                f"| {row['projection']} | {row['annotation']} | – | – | – | – | – "
                f"| – | {row['error']} |"
            )
            continue
        per_category = list((row.get("per_category") or {}).items())
        extremes = (
            per_category[:2] + per_category[-2:]
            if len(per_category) > 4
            else per_category
        )
        shown = ", ".join(f"{c} {v:+.2f}" for c, v in extremes)
        lines.append(
            f"| {row['projection']} | {row['annotation']} | {row['coverage']:.1%} | "
            f"{row['categories']} | {row['legend_kappa']} | {row['knn_kappa']} | "
            f"{row.get('silhouette')} | {shown} | {row.get('thumbnail', '')} |"
        )
    (out_dir / "report.md").write_text("\n".join(lines) + "\n")
    return rows


# ---------------------------------------------------------------------------
# Network helpers (UniProt)
# ---------------------------------------------------------------------------


def _http_get(
    url: str, params: dict | None = None, *, method: str = "GET", attempts: int = 5
):
    import requests

    for attempt in range(attempts):
        try:
            response = requests.request(method, url, params=params, timeout=120)
        except requests.RequestException as error:
            if attempt == attempts - 1:
                raise BuildError(f"{url}: {error}") from error
            time.sleep(2**attempt)
            continue
        if response.status_code in (429, 500, 502, 503, 504) and attempt < attempts - 1:
            wait = response.headers.get("Retry-After")
            time.sleep(float(wait) if wait and wait.isdigit() else 2**attempt)
            continue
        return response
    raise BuildError(f"{url}: gave up after {attempts} attempts")


def current_uniprot_release() -> str | None:
    response = _http_get(RELEASE_PROBE)
    return response.headers.get("X-UniProt-Release")


def parse_fasta_text(text: str) -> dict[str, str]:
    """``{accession: sequence}`` from UniProt FASTA (``>sp|ACC|NAME …``)."""
    sequences: dict[str, str] = {}
    accession = None
    chunks: list[str] = []
    for line in text.splitlines():
        if line.startswith(">"):
            if accession:
                sequences[accession] = "".join(chunks)
            header = line[1:].split()[0]
            parts = header.split("|")
            accession = parts[1] if len(parts) >= 3 else header
            chunks = []
        elif line.strip():
            chunks.append(line.strip())
    if accession:
        sequences[accession] = "".join(chunks)
    return sequences


def fetch_uniprot_sequences(
    accessions: Sequence[str], *, chunk: int = 100
) -> tuple[dict[str, str], set[str]]:
    """Current full-length sequences keyed by the *requested* accession.

    Batches use ``/uniprotkb/accessions``; an accession that comes back under
    another primary accession (merged) is looked up alone, which follows UniProt's
    redirect. Returns the sequences and every release the responses reported.
    """
    found: dict[str, str] = {}
    releases: set[str] = set()

    def note(response) -> None:
        release = response.headers.get("X-UniProt-Release")
        if release:
            releases.add(release)

    for start in range(0, len(accessions), chunk):
        batch = list(accessions[start : start + chunk])
        response = _http_get(
            f"{UNIPROT_REST}/accessions",
            {
                "accessions": ",".join(batch),
                "fields": "accession,sequence",
                "format": "tsv",
            },
        )
        if response.status_code != 200:
            continue
        note(response)
        for line in response.text.splitlines()[1:]:
            fields = line.split("\t")
            if len(fields) >= 2 and fields[0] in batch:
                found[fields[0]] = fields[1]
    for accession in [a for a in accessions if a not in found]:
        response = _http_get(f"{UNIPROT_REST}/{accession}", {"format": "fasta"})
        if response.status_code == 200 and response.text.startswith(">"):
            sequences = parse_fasta_text(response.text)
            if sequences:
                note(response)
                found[accession] = next(iter(sequences.values()))
    return found, releases


def write_fasta(path: Path, sequences: dict[str, str], order: Sequence[str]) -> int:
    path.parent.mkdir(parents=True, exist_ok=True)
    written = 0
    with path.open("w") as handle:
        for accession in order:
            sequence = sequences.get(accession)
            if sequence:
                handle.write(f">{accession}\n{sequence}\n")
                written += 1
    return written


def read_tsv_sequences(path: Path) -> dict[str, str]:
    """``{Entry: Sequence}`` from a UniProt TSV (e.g. the ToxProt demo's)."""
    with path.open() as handle:
        header = handle.readline().rstrip("\n").split("\t")
        entry, seq = header.index("Entry"), header.index("Sequence")
        result = {}
        for line in handle:
            fields = line.rstrip("\n").split("\t")
            if len(fields) > max(entry, seq) and fields[entry]:
                result[fields[entry]] = fields[seq]
    return result


# ---------------------------------------------------------------------------
# What the CLI recorded: the UniProt release its data came from, and the
# sources it could not fully retrieve
# ---------------------------------------------------------------------------

#: The CLI's word for values whose release was never recorded.
UNKNOWN_RELEASE = "unknown"


def parse_run_log_releases(text: str) -> set[str] | None:
    """Releases on the last ``uniprot_release:`` line of ``run.log`` text.

    The fixed CLI writes the comma-separated releases its UniProt values came
    from, ``none`` when it used no UniProt data and ``unknown`` for cached values
    whose release was never recorded. ``None`` when the text has no such line.
    Pass only the text a run appended: ``run.log`` accumulates every run.
    """
    matches = re.findall(r"^uniprot_release:[ \t]*(.*)$", text, re.M)
    if not matches:
        return None
    parts = {part.strip() for part in matches[-1].split(",") if part.strip()}
    return parts - {"none"}


#: The pandas ``DataFrame.attrs`` key the CLI stamps on its annotation cache.
CACHE_RELEASE_ATTR = "protspace_uniprot_release"


def cache_release_stamp(path: Path) -> set[str] | None:
    """Releases the CLI stamped on an annotation cache parquet (schema only).

    The CLI keeps them in ``DataFrame.attrs``, which pandas writes to the
    ``PANDAS_ATTRS`` key (older pandas: ``attrs`` inside the ``pandas`` key).
    ``None`` when there is no stamp, which the CLI reads as unknown.
    """
    if not path.is_file():
        return None
    metadata = pq.read_schema(path).metadata or {}
    attrs: dict = {}
    if b"PANDAS_ATTRS" in metadata:
        attrs = json.loads(metadata[b"PANDAS_ATTRS"])
    elif b"pandas" in metadata:
        attrs = json.loads(metadata[b"pandas"]).get("attrs") or {}
    stamp = attrs.get(CACHE_RELEASE_ATTR)
    if not isinstance(stamp, str):
        return None
    return {part.strip() for part in stamp.split(",") if part.strip()}


ANNOTATION_SOURCES = ("uniprot", "taxonomy", "interpro", "ted", "biocentral")

# The fixed CLI exits 0 when a source was only partly retrieved (a partial
# result beats none for its users). It leaves that source out of its cache, so a
# re-run fetches it again, and says so only in these warnings: prepare's run.log
# does not list incomplete sources, and annotate's output carries no marker.
INCOMPLETE_PATTERNS = tuple(
    re.compile(pattern)
    for pattern in (
        # annotate
        r"Incomplete annotations from: (?P<sources>[^.]+)\.",
        # the cache write (prepare and annotate --cache-dir)
        r"already held for (?P<sources>.+?): that source could not be fully retrieved",
        r" without (?P<sources>.+?): that source could not be fully retrieved",
        r"Not caching annotations at .*?: (?P<sources>.+?) could not be fully retrieved",
        # the annotation manager and the retrievers
        r"Could not retrieve annotations from the following sources: (?P<sources>.+)",
        r"Failed to retrieve (?P<sources>\w+) (?:annotations|predictions)",
        r"(?P<sources>InterPro|TED) (?:annotations|domains) are incomplete",
        r"(?P<sources>InterPro|Biocentral) values are not cached this run",
    )
)
# A line with one of these that no pattern names a source for still counts.
INCOMPLETE_HINTS = (
    "could not be fully retrieved",
    "will not be cached",
    "Incomplete annotations",
)


def incomplete_sources_in(line: str) -> set[str]:
    """The annotation sources a CLI output line reports as not fully retrieved.

    ``{"unknown"}`` for a line that reports incompleteness without naming a
    source this script knows.
    """
    found: set[str] = set()
    matched = False
    for pattern in INCOMPLETE_PATTERNS:
        for match in pattern.finditer(line):
            matched = True
            text = match.group("sources").lower()
            found |= {s for s in ANNOTATION_SOURCES if re.search(rf"\b{s}\b", text)}
    if not found and (matched or any(hint in line for hint in INCOMPLETE_HINTS)):
        found.add("unknown")
    return found


# ---------------------------------------------------------------------------
# The protspace CLI, run as a subprocess of another checkout
# ---------------------------------------------------------------------------


def cli_env() -> dict[str, str]:
    """The environment for CLI subprocesses.

    An activated virtualenv (for instance another checkout's) must not leak into
    uv run --project: uv would warn and could pick the wrong interpreter.
    """
    env = {k: v for k, v in os.environ.items() if k != "VIRTUAL_ENV"}
    env["PYTHONUNBUFFERED"] = "1"
    return env


def resolve_cli_project(cli_root: Path) -> Path:
    """The uv project that provides ``protspace`` inside ``cli_root``."""
    cli_root = cli_root.expanduser().resolve()
    for candidate in (cli_root / "apps" / "protspace", cli_root):
        pyproject = candidate / "pyproject.toml"
        if pyproject.is_file() and 'name = "protspace"' in pyproject.read_text():
            return candidate
    raise BuildError(f"no protspace project under {cli_root}")


@dataclass
class CliResult:
    """What one CLI run reported: the sources it could not fully retrieve."""

    incomplete: set[str] = field(default_factory=set)
    transcript: Path | None = None


def stream_command(
    command: Sequence[str], *, cwd: Path, transcript: Path | None
) -> tuple[int, set[str]]:
    """Run ``command``, pass its output through, and scan it for incomplete sources.

    stdout and stderr are merged (the CLI logs to stderr) and copied unchanged to
    this process's stdout and to ``transcript``; lines are split on ``\\n`` and
    ``\\r``, so progress bars do not hide a warning.
    """
    incomplete: set[str] = set()
    sink = getattr(sys.stdout, "buffer", None)
    handle = None
    if transcript is not None:
        transcript.parent.mkdir(parents=True, exist_ok=True)
        handle = transcript.open("ab")
    pending = b""
    try:
        with subprocess.Popen(
            list(command),
            cwd=cwd,
            env=cli_env(),
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
        ) as process:
            for chunk in iter(lambda: process.stdout.read1(1 << 16), b""):
                if sink is not None:
                    sink.write(chunk)
                    sink.flush()
                else:
                    sys.stdout.write(chunk.decode(errors="replace"))
                    sys.stdout.flush()
                if handle is not None:
                    handle.write(chunk)
                *lines, pending = re.split(rb"[\r\n]", pending + chunk)
                for line in lines:
                    incomplete |= incomplete_sources_in(line.decode(errors="replace"))
            code = process.wait()
    finally:
        if handle is not None:
            handle.close()
    incomplete |= incomplete_sources_in(pending.decode(errors="replace"))
    return code, incomplete


class Cli:
    def __init__(self, cli_root: Path, *, dry_run: bool = False):
        self.root = cli_root.expanduser().resolve()
        self.project = resolve_cli_project(self.root)
        self.dry_run = dry_run
        self._version: str | None = None
        self._git_sha: str | None = None
        self._capabilities: dict[str, Any] | None = None

    def argv(self, args: Sequence[str]) -> list[str]:
        return [
            "uv",
            "run",
            "--frozen",
            "--project",
            str(self.project),
            "protspace",
            *map(str, args),
        ]

    def run(
        self,
        args: Sequence[str],
        *,
        cwd: Path,
        log: Callable[[str], None],
        transcript: Path | None = None,
    ) -> CliResult:
        """Run one protspace command; a non-zero exit raises.

        An exit of 0 is not a complete run: the result names the annotation
        sources the command reported as not fully retrieved.
        """
        command = self.argv(args)
        log("$ " + shlex.join(command))
        if self.dry_run:
            return CliResult()
        code, incomplete = stream_command(command, cwd=cwd, transcript=transcript)
        if code != 0:
            raise BuildError(f"protspace {args[0]} exited {code}")
        return CliResult(incomplete, transcript)

    def version(self) -> str:
        if self._version is None:
            if self.dry_run:
                return "unknown (dry run)"
            out = subprocess.run(
                [
                    "uv",
                    "run",
                    "--frozen",
                    "--project",
                    str(self.project),
                    "python",
                    "-c",
                    "import protspace; print(protspace.__version__)",
                ],
                capture_output=True,
                text=True,
                check=False,
                env=cli_env(),
            )
            self._version = out.stdout.strip() or "unknown"
        return self._version

    def git_sha(self) -> str | None:
        if self._git_sha is None:
            self._git_sha = git_sha(self.root)
        return self._git_sha

    def identity(self) -> dict[str, Any]:
        """What a step marker keys on: which checkout ran, at which commit."""
        return {"project": str(self.project), "git_sha": self.git_sha()}

    def capabilities(self) -> dict[str, Any]:
        """What the checkout's source says it can do (read, not run)."""
        if self._capabilities is None:
            self._capabilities = read_capabilities(self.project)
        return self._capabilities


def read_capabilities(project: Path) -> dict[str, Any]:
    """Feature probes on a protspace source tree.

    ``annotate_cache_dir`` marks the fix/annotation-retrieval CLI;
    ``faithfulness_ceiling`` is ``None`` once PR #452 removed the constant.
    """
    source = project / "src" / "protspace"
    annotate = source / "cli" / "annotate.py"
    faithfulness = source / "stats" / "metrics" / "faithfulness.py"
    ceiling = None
    if faithfulness.is_file():
        found = re.search(
            r"^DEFAULT_HARD_CEILING\s*=\s*([0-9_]+)\s*$",
            faithfulness.read_text(),
            re.M,
        )
        if found:
            ceiling = int(found.group(1).replace("_", ""))
    return {
        "annotate_cache_dir": annotate.is_file()
        and "--cache-dir" in annotate.read_text(),
        "faithfulness_ceiling": ceiling,
    }


def git_sha(path: Path) -> str | None:
    result = subprocess.run(
        ["git", "-C", str(path), "rev-parse", "HEAD"],
        capture_output=True,
        text=True,
        check=False,
    )
    if result.returncode != 0:
        return None
    sha = result.stdout.strip()
    dirty = subprocess.run(
        ["git", "-C", str(path), "status", "--porcelain", "--untracked-files=no"],
        capture_output=True,
        text=True,
        check=False,
    ).stdout.strip()
    return f"{sha}-dirty" if dirty else sha


# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------


@dataclass
class Config:
    file: Path
    raw: dict
    variables: dict[str, str]

    @classmethod
    def load(
        cls, path: Path, overrides: dict[str, str] | None = None, repo: Path = REPO_ROOT
    ) -> Config:
        raw = tomllib.loads(path.read_text())
        variables = {"repo": str(repo), "home": str(Path.home())}
        variables.update(raw.get("paths", {}))
        env_suite = os.environ.get("PROTSPACE_SUITE")
        if env_suite:
            variables["suite"] = env_suite
        variables.update(overrides or {})
        config = cls(path, raw, variables)
        for dataset_id, dataset in config.datasets.items():
            if dataset.get("kind") not in KINDS:
                raise BuildError(f"{dataset_id}: kind must be one of {KINDS}")
        return config

    @property
    def build(self) -> dict:
        return self.raw.get("build", {})

    @property
    def datasets(self) -> dict[str, dict]:
        return self.raw.get("datasets", {})

    def expand(self, template: str, extra: dict[str, str] | None = None) -> str:
        variables = {**self.variables, **(extra or {})}
        text = template
        for _ in range(10):
            new = re.sub(
                r"\{(\w+)\}",
                lambda m: variables.get(m.group(1), m.group(0)),
                text,
            )
            if new == text:
                break
            text = new
        return os.path.expanduser(text)

    def path(self, template: str, extra: dict[str, str] | None = None) -> Path:
        return Path(self.expand(template, extra))

    def first_existing(self, templates: str | Sequence[str]) -> Path:
        options = [templates] if isinstance(templates, str) else list(templates)
        paths = [self.path(t) for t in options]
        for path in paths:
            if path.exists():
                return path
        raise BuildError(f"none of these inputs exist: {[str(p) for p in paths]}")


def split_h5_spec(spec: str) -> tuple[str, str | None]:
    path, sep, name = spec.rpartition(":")
    if sep and name and "/" not in name:
        return path, name
    return spec, None


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1 << 20), b""):
            digest.update(block)
    return digest.hexdigest()


def fingerprint(path: Path | str) -> Any:
    """Size and modification time of a file (or of every file in a directory).

    Cheap enough for the multi-GB inputs; a replaced or rewritten file changes it.
    """
    path = Path(path)
    if path.is_dir():
        return {
            child.name: fingerprint(child)
            for child in sorted(path.iterdir())
            if not child.name.startswith(".")
        }
    if not path.is_file():
        return "missing"
    stat = path.stat()
    return {"bytes": stat.st_size, "mtime_ns": stat.st_mtime_ns}


def content_sha256(path: Path) -> str | None:
    """The sha256 of a small file whose content is an input (a styles file)."""
    return sha256_file(path) if path.is_file() else None


# ---------------------------------------------------------------------------
# Build context, steps and markers
# ---------------------------------------------------------------------------

#: The recipe keys each expensive local step reads: editing another key (an
#: author fact, a style) must not re-run assemble or the hours of ``stats``,
#: since every step after a re-run step runs again too.
ASSEMBLE_KEYS = (
    "kind",
    "source",
    "source_sha256",
    "projections_source",
    "frozen",
    "keep_paper_columns",
    "withheld",
    "keep_source_columns",
    "first_columns",
    "drop_columns",
    "missing_rows",
)
STATS_KEYS = (
    "stats",
    "stats_annotations",
    "cluster_selection",
    "freeze_statistics",
    "embeddings",
    "source_sha256",
)
#: Recipe keys that only verify, report or stage-release read. Every other key
#: of a dataset's table is an input of ``finalize`` (the last step), so editing
#: one (an author fact such as ``membership_release``) re-runs it.
VERIFY_ONLY_KEYS = frozenset(
    {
        "name",
        "figure",
        "membership",
        "hosting",
        "repo_file",
        "large",
        "proteins",
        "reviewed",
        "max_obsolete",
        "xref_pdb_both",
        "faithfulness_severity",
        "gates",
        "report",
        "default_view",
        "pins",
    }
)


@dataclass
class Step:
    """One resumable build step.

    A finished step writes a marker keyed on a digest of its summary, its CLI
    command and everything ``inputs`` returns (the recipe slice it reads, input
    file fingerprints, style file contents, the CLI's commit). It is skipped
    while that digest is unchanged and no step before it re-ran.
    """

    name: str
    summary: str
    action: Callable[[], None]
    always: bool = False
    command: list[str] | None = None
    inputs: Callable[[], dict[str, Any]] | None = None
    #: Fetches data from UniProt and records the release it came from.
    fetches: bool = False

    def key(self) -> str:
        payload = {
            "name": self.name,
            "summary": self.summary,
            "command": self.command,
            "inputs": self.inputs() if self.inputs else None,
        }
        text = json.dumps(payload, sort_keys=True, default=str)
        return hashlib.sha256(text.encode()).hexdigest()


@dataclass
class Context:
    ds_id: str
    dataset: dict
    config: Config
    out_root: Path
    cli: Cli | None
    release: str
    dry_run: bool
    view: dict
    view_source: str
    enabled_stages: set[str] = field(default_factory=set)
    redo: set[str] = field(default_factory=set)
    #: ``--web-cut``/``--no-web-cut`` for this invocation; ``None`` keeps the
    #: decision recorded in facts.json (see :meth:`web_cut_active`).
    web_cut: bool | None = None
    allow_release_mismatch: bool = False
    allow_unfixed_cli: bool = False
    thumbnails: bool = True
    command: str = ""

    @property
    def root(self) -> Path:
        return self.out_root / self.ds_id

    @property
    def work(self) -> Path:
        return self.root / "work"

    @property
    def file_name(self) -> str:
        pattern = self.config.build.get("file_pattern", "{id}_{release}.parquetbundle")
        return pattern.format(id=self.ds_id, release=self.release)

    @property
    def final(self) -> Path:
        return self.root / self.file_name

    @property
    def full_variant(self) -> Path:
        return self.final.with_name(
            self.final.name.replace(".parquetbundle", "_full.parquetbundle")
        )

    def log(self, message: str) -> None:
        line = f"[{self.ds_id}] {message}"
        print(line, flush=True)
        if not self.dry_run:
            self.root.mkdir(parents=True, exist_ok=True)
            with (self.root / "build.log").open("a") as handle:
                handle.write(
                    f"{dt.datetime.now(dt.UTC).isoformat(timespec='seconds')} {line}\n"
                )

    def need_cli(self) -> Cli:
        if self.cli is None:
            raise BuildError(
                "this step needs --cli-root (the checkout with the fixed CLI)"
            )
        return self.cli

    def path(self, template: str) -> Path:
        return self.config.path(template, {"out": str(self.out_root)})

    def record(self, key: str, value: Any) -> None:
        """Keep build facts (releases, decisions) in work/facts.json.

        A dry run records nothing: it writes no file at all.
        """
        if self.dry_run:
            return
        facts_path = self.work / "facts.json"
        facts = json.loads(facts_path.read_text()) if facts_path.is_file() else {}
        facts[key] = value
        self.work.mkdir(parents=True, exist_ok=True)
        atomic_write(facts_path, json.dumps(facts, indent=1, sort_keys=True).encode())

    def facts(self) -> dict[str, Any]:
        facts_path = self.work / "facts.json"
        return json.loads(facts_path.read_text()) if facts_path.is_file() else {}

    def web_cut_active(self) -> bool:
        """Whether this bundle drops its ``web_cut`` columns (the D2 fallback).

        The decision is persisted, so a later ``build`` without the flag (a
        ``--redo style``, an extra stage) keeps shipping the cut file.
        """
        decision = self.web_cut
        if decision is None:
            decision = bool(self.facts().get("web_cut", False))
        return decision and bool(self.dataset.get("web_cut"))

    def recipe(self, keys: Sequence[str] | None = None) -> dict[str, Any]:
        """The dataset's recipe keys a step reads: ``keys``, or every key that
        is not verify-only."""
        if keys is not None:
            return {k: self.dataset.get(k) for k in keys}
        return {k: v for k, v in self.dataset.items() if k not in VERIFY_ONLY_KEYS}

    def cli_identity(self) -> dict[str, Any] | None:
        return self.cli.identity() if self.cli is not None else None


@contextlib.contextmanager
def build_lock(ctx: Context):
    """One build per dataset directory at a time (a second one would race the CLI cache)."""
    if ctx.dry_run:
        yield
        return
    ctx.root.mkdir(parents=True, exist_ok=True)
    lock = ctx.root / ".lock"
    try:
        fd = os.open(lock, os.O_CREAT | os.O_EXCL | os.O_WRONLY)
    except FileExistsError:
        pid = lock.read_text().strip()
        alive = pid.isdigit() and _pid_alive(int(pid))
        if alive:
            raise BuildError(
                f"{ctx.ds_id} is being built by pid {pid} ({lock})"
            ) from None
        lock.unlink()
        fd = os.open(lock, os.O_CREAT | os.O_EXCL | os.O_WRONLY)
    os.write(fd, str(os.getpid()).encode())
    os.close(fd)
    try:
        yield
    finally:
        with contextlib.suppress(FileNotFoundError):
            lock.unlink()


def _pid_alive(pid: int) -> bool:
    try:
        os.kill(pid, 0)
    except ProcessLookupError:
        return False
    except PermissionError:
        return True
    return True


def marker_key(marker: Path) -> str | None:
    """The input digest a finished step's marker records (None: no valid marker)."""
    if not marker.is_file():
        return None
    try:
        return json.loads(marker.read_text()).get("key")
    except (json.JSONDecodeError, AttributeError):
        return None  # a marker from before digests: run the step again


def execute(ctx: Context, steps: Sequence[Step]) -> None:
    """Run steps in order, skipping finished ones until one re-runs.

    A step is finished when its marker records the digest of its current inputs
    (:meth:`Step.key`); a changed input, ``--redo`` or an earlier step that ran
    runs it again.
    """
    markers = ctx.work / ".steps"
    dirty = False
    for step in steps:
        marker = markers / f"{step.name}.done"
        key = None
        if not step.always:
            try:
                key = step.key()
            except (BuildError, OSError) as error:
                ctx.log(f"{step.name}: inputs not readable yet ({error})")
        finished = key is not None and marker_key(marker) == key
        if (
            not step.always
            and finished
            and not dirty
            and step.name not in ctx.redo
            and "all" not in ctx.redo
        ):
            ctx.log(f"{step.name}: done (marker), skipped")
            continue
        if ctx.dry_run:
            reason = "" if step.always or marker_key(marker) is None else " (changed)"
            ctx.log(f"{step.name}: would run{reason} — {step.summary}")
            if step.command and ctx.cli is not None:
                ctx.log("    $ " + shlex.join(ctx.cli.argv(step.command)))
            dirty = dirty or not step.always
            if step.always:
                step.action()
            continue
        ctx.log(f"{step.name}: {step.summary}")
        started = time.monotonic()
        step.action()
        ctx.log(f"{step.name}: finished in {time.monotonic() - started:.0f} s")
        if not step.always:
            dirty = True
            markers.mkdir(parents=True, exist_ok=True)
            atomic_write(
                marker,
                json.dumps(
                    {
                        "key": step.key() if key is None else key,
                        "summary": step.summary,
                        "finished_at": dt.datetime.now(dt.UTC).isoformat(
                            timespec="seconds"
                        ),
                    },
                    indent=1,
                ).encode(),
            )


# ---------------------------------------------------------------------------
# Recipes
# ---------------------------------------------------------------------------


def dataset_embeddings(ctx: Context) -> list[str]:
    specs = []
    for spec in ctx.dataset.get("embeddings", []):
        path, name = split_h5_spec(ctx.config.expand(spec))
        specs.append(f"{path}:{name}" if name else path)
    return specs


def enabled_stage_groups(ctx: Context) -> list[list[str]]:
    """Cumulative ``-a`` lists, one per enabled fetch stage."""
    stages = []
    cumulative: list[str] = []
    for stage in ctx.dataset.get("stages", []):
        name = stage.get("name") or ",".join(stage["groups"])
        if not stage.get("enabled", True) and name not in ctx.enabled_stages:
            continue
        for group in stage["groups"]:
            if group not in cumulative:
                cumulative.append(group)
        stages.append(list(cumulative))
    return stages


def find_source(ctx: Context) -> Path:
    """The dataset's source bundle: the first candidate matching the sha256 pin.

    After the catalog swap the paper bytes live in the test fixtures and the
    perf-datasets release, and ``public/data.parquetbundle`` is the new demo, so
    candidates are tried in order and the pin decides.
    """
    options = ctx.dataset["source"]
    options = [options] if isinstance(options, str) else list(options)
    pinned = ctx.dataset.get("source_sha256")
    tried = []
    for template in options:
        path = ctx.path(template)
        if not path.is_file():
            tried.append(f"{path} (missing)")
            continue
        if pinned and sha256_file(path) != pinned:
            tried.append(f"{path} (sha256 differs from the pin)")
            continue
        return path
    raise BuildError("no source bundle matches:\n  " + "\n  ".join(tried))


def find_projection_source(ctx: Context) -> Path:
    if "projections_source" in ctx.dataset:
        return ctx.config.first_existing(ctx.dataset["projections_source"])
    return find_source(ctx)


def require_served_release(ctx: Context, step: str) -> None:
    """Refuse to start a fetch while UniProt serves another release than the target.

    The probe says only what UniProt serves *now*; it is recorded as a probe
    (``probe-release:<step>``), never as the release of any data. The release
    data came from is what the CLI records (:func:`record_data_release`).
    """
    if ctx.dry_run:
        return
    served = current_uniprot_release()
    ctx.record(f"probe-release:{step}", served)
    if served != ctx.release and not ctx.allow_release_mismatch:
        raise BuildError(
            f"{step}: UniProt serves {served}, the build targets {ctx.release}; "
            "fetching now would mix releases. Rebuild at the served release "
            f"(--release {served} --redo all) or pass --allow-release-mismatch"
        )


def record_data_release(ctx: Context, step: str, releases: set[str] | None) -> None:
    """Note the UniProt release(s) a fetch step's data came from, as the CLI
    (or UniProt's response headers, for the FASTA) recorded them.

    ``None`` (nothing recorded) is kept as unknown, so provenance cannot claim
    a release no source reported.
    """
    value = sorted(releases) if releases is not None else [UNKNOWN_RELEASE]
    ctx.record(f"data-release:{step}", value)
    ctx.log(f"{step}: data from UniProt release {', '.join(value) or 'none'}")


def check_inputs_step(ctx: Context) -> Step:
    def action() -> None:
        problems = []
        for pin in ctx.dataset.get("pins", []):
            path = ctx.path(pin["path"])
            if not path.exists():
                problems.append(f"missing {path}")
                continue
            if "bytes" in pin and path.stat().st_size != pin["bytes"]:
                problems.append(
                    f"{path}: {path.stat().st_size} bytes, pinned {pin['bytes']}"
                )
            if "sha256" in pin and sha256_file(path) != pin["sha256"]:
                problems.append(f"{path}: sha256 differs from the pin")
        for spec in dataset_embeddings(ctx):
            path, _ = split_h5_spec(spec)
            if not Path(path).is_file():
                problems.append(f"missing embeddings {path}")
        try:
            ctx.log(f"input projections: {find_projection_source(ctx)}")
            if "source" in ctx.dataset:
                ctx.log(f"input source bundle: {find_source(ctx)}")
        except BuildError as error:
            problems.append(str(error))
        if ctx.cli is not None:
            caps = ctx.cli.capabilities()
            ctx.log(f"CLI {ctx.cli.project}: {caps}")
            unfixed = []
            if not caps["annotate_cache_dir"]:
                unfixed.append("no `annotate --cache-dir` (fix/annotation-retrieval)")
            ceiling = caps["faithfulness_ceiling"]
            if (
                ctx.dataset.get("stats")
                and ceiling
                and ctx.dataset["proteins"] > ceiling
            ):
                unfixed.append(
                    f"faithfulness ceiling {ceiling} < {ctx.dataset['proteins']} "
                    "proteins (PR #452, G7)"
                )
            if unfixed and not ctx.allow_unfixed_cli:
                problems.append(
                    "the CLI checkout lacks prerequisites: "
                    + "; ".join(unfixed)
                    + " (--allow-unfixed-cli to build anyway)"
                )
        if not ctx.dry_run:
            # Only noted here: a fetch step refuses to start while UniProt serves
            # another release (require_served_release), and a build whose fetches
            # are done can still be finished after UniProt moves on.
            release = current_uniprot_release()
            ctx.record("probe-release:start", release)
            ctx.log(f"UniProt serves release {release} (target {ctx.release})")
        if problems:
            message = "input check failed:\n  " + "\n  ".join(problems)
            if ctx.dry_run:
                ctx.log("WARNING " + message)
            else:
                raise BuildError(message)

    return Step(
        "check-inputs",
        "pins, embeddings, sources, CLI, UniProt release",
        action,
        always=True,
    )


def run_fetch(ctx: Context, name: str, args: list[str]) -> None:
    """Run a fetching CLI command until every requested source is complete.

    The CLI exits 0 with a source only partly retrieved and leaves that source
    out of its cache, so running the same command again fetches just what is
    missing. After ``[build] incomplete_retries`` extra runs (default 1) the step
    fails: its marker is not written, and the next ``build`` tries again.
    """
    cli = ctx.need_cli()
    retries = int(ctx.config.build.get("incomplete_retries", 1))
    wait = float(ctx.config.build.get("incomplete_retry_wait_s", 300))
    incomplete: set[str] = set()
    for attempt in range(1, retries + 2):
        result = cli.run(
            args,
            cwd=ctx.work,
            log=ctx.log,
            transcript=ctx.work / "logs" / f"{name}.log",
        )
        incomplete = result.incomplete
        if not incomplete:
            return
        ctx.log(
            f"{name}: the CLI did not fully retrieve {sorted(incomplete)} "
            f"(run {attempt} of {retries + 1})"
        )
        if attempt <= retries:
            ctx.log(f"{name}: running it again in {wait * attempt:.0f} s")
            time.sleep(wait * attempt)
    raise BuildError(
        f"{name}: {sorted(incomplete)} still incomplete after {retries + 1} runs; "
        "the step is not marked done, so the next build fetches them again "
        f"(the CLI's warnings are in {ctx.work / 'logs' / f'{name}.log'})"
    )


def fetch_step(
    ctx: Context,
    name: str,
    args: list[str],
    *,
    inputs: Callable[[], dict[str, Any]],
    releases: Callable[[], set[str] | None],
    when: Callable[[], bool] | None = None,
    before: Callable[[], None] | None = None,
) -> Step:
    """A step that fetches annotations with one CLI command.

    It starts only while UniProt serves the target release, counts as done only
    when every requested source was fully retrieved (:func:`run_fetch`), and
    records the release(s) the CLI says its data came from (``releases``).
    ``when`` returning False skips the command (nothing to fetch).
    """

    def action() -> None:
        if when is not None and not when():
            return
        require_served_release(ctx, name)
        if before is not None:
            before()
        run_fetch(ctx, name, args)
        record_data_release(ctx, name, releases())

    def step_inputs() -> dict[str, Any]:
        return {
            "cli": ctx.cli_identity(),
            "release": ctx.release,
            **inputs(),
        }

    return Step(
        name,
        shlex.join(args),
        action,
        command=args,
        inputs=step_inputs,
        fetches=True,
    )


def prepare_steps(ctx: Context) -> list[Step]:
    """Staged, resumable annotation fetch through ``prepare``'s per-source cache.

    ``-m pca2`` is cheap and its output is discarded; each stage adds sources and
    reuses the cached ones, so a failure costs only the stage that failed.
    """
    inputs: list[str] = []
    for spec in dataset_embeddings(ctx):
        inputs += ["-i", spec]
    ann_dir = ctx.work / "ann"
    run_log = ann_dir / "run.log"
    steps = []
    for number, groups in enumerate(enabled_stage_groups(ctx), start=1):
        args = [
            "prepare",
            *inputs,
            "-m",
            "pca2",
            "-a",
            ",".join(groups),
            "-o",
            str(ann_dir),
            "-v",
        ]
        # run.log accumulates every run; only what this run appended counts.
        offset = {"bytes": 0}

        def before(offset=offset) -> None:
            offset["bytes"] = run_log.stat().st_size if run_log.is_file() else 0

        def releases(offset=offset) -> set[str] | None:
            text = (
                run_log.read_bytes()[offset["bytes"] :].decode(errors="replace")
                if run_log.is_file()
                else ""
            )
            found = parse_run_log_releases(text)
            if found is None:  # no run.log line: the cache's stamp
                found = cache_release_stamp(ann_dir / "tmp" / "all_annotations.parquet")
            return found

        steps.append(
            fetch_step(
                ctx,
                f"fetch-{number}",
                args,
                inputs=lambda: {
                    "embeddings": [
                        fingerprint(split_h5_spec(s)[0])
                        for s in dataset_embeddings(ctx)
                    ]
                },
                releases=releases,
                before=before,
            )
        )
    return steps


def annotate_args(
    ctx: Context, fasta: Path, groups: Sequence[str], out: Path, cache: Path
) -> list[str]:
    args = ["annotate", "-i", str(fasta), "-a", ",".join(groups), "-o", str(out)]
    if ctx.cli is not None and ctx.cli.capabilities()["annotate_cache_dir"]:
        args += ["--cache-dir", str(cache)]
    return [*args, "-v"]


def annotate_releases(cache: Path) -> Callable[[], set[str] | None]:
    """The release(s) ``annotate --cache-dir`` stamped on its cache.

    ``annotate`` writes no run.log and its output file carries no release, so
    its cache's stamp is where the CLI records it (``None``, unknown, without
    ``--cache-dir``).
    """
    return lambda: cache_release_stamp(cache / "all_annotations.parquet")


def fasta_step(
    ctx: Context,
    ids_source: Callable[[], list[str]],
    out: Path,
    name: str = "fasta",
    *,
    inputs: Callable[[], dict[str, Any]],
) -> Step:
    """Full-length UniProt sequences for the sequence-based sources (G8)."""
    options = ctx.dataset.get("fasta", {})

    def action() -> None:
        ids = ids_source()
        if ids:
            require_served_release(ctx, name)
        sequences, releases = fetch_uniprot_sequences(ids) if ids else ({}, set())
        record_data_release(ctx, name, releases)
        fallback = 0
        if "fallback_tsv" in options and ctx.path(options["fallback_tsv"]).is_file():
            table = read_tsv_sequences(ctx.path(options["fallback_tsv"]))
            for accession in ids:
                if accession not in sequences and table.get(accession):
                    sequences[accession] = table[accession]
                    fallback += 1
        if "fallback_column" in options:
            source = read_bundle(find_source(ctx)).annotations
            column = options["fallback_column"]
            if column in source.column_names:
                stored = dict(
                    zip(row_ids(source), source.column(column).to_pylist(), strict=True)
                )
                for accession in ids:
                    if accession not in sequences and stored.get(accession):
                        sequences[accession] = stored[accession]
                        fallback += 1
        written = write_fasta(out, sequences, ids)
        ctx.record(
            f"{name}:counts",
            {"requested": len(ids), "written": written, "fallback": fallback},
        )
        ctx.log(f"{name}: {written} of {len(ids)} sequences ({fallback} from fallback)")

    def step_inputs() -> dict[str, Any]:
        fallback_tsv = options.get("fallback_tsv")
        return {
            "release": ctx.release,
            "fasta": options,
            "fallback_tsv": fingerprint(ctx.path(fallback_tsv))
            if fallback_tsv
            else None,
            **inputs(),
        }

    return Step(
        name,
        f"UniProt full-length FASTA → {out.name}",
        action,
        inputs=step_inputs,
        fetches=True,
    )


def projection_spec(ctx: Context) -> list[tuple[str, str]]:
    return parse_projection_spec(ctx.dataset["projections"])


def projections_step(ctx: Context, *, drop_quality: bool) -> Step:
    spec = projection_spec(ctx)

    def action() -> None:
        metadata, data = read_projection_source(find_projection_source(ctx))
        meta, data = select_projections(metadata, data, spec, drop_quality=drop_quality)
        out = ctx.work / "proj"
        out.mkdir(parents=True, exist_ok=True)
        atomic_write(out / "projections_metadata.parquet", parquet_bytes(meta))
        atomic_write(out / "projections_data.parquet", parquet_bytes(data))

    summary = "select " + ", ".join(f"{a}→{b}" if a != b else a for a, b in spec)
    return Step(
        "projections",
        summary,
        action,
        inputs=lambda: {
            "spec": spec,
            "drop_quality": drop_quality,
            "source": fingerprint(find_projection_source(ctx)),
        },
    )


def assemble_step(
    ctx: Context, summary: str, action: Callable[[], None], files: Sequence[Path]
) -> Step:
    """The local step that writes ``work/annotations.parquet``.

    Keyed on the recipe keys it reads (:data:`ASSEMBLE_KEYS`), the default
    view's annotation (the first column) and its input files.
    """
    return Step(
        "assemble",
        summary,
        action,
        inputs=lambda: {
            "recipe": ctx.recipe(ASSEMBLE_KEYS),
            "first_column": ctx.view.get("annotation"),
            "source": fingerprint(find_source(ctx))
            if "source" in ctx.dataset
            else None,
            "membership": fingerprint(find_projection_source(ctx)),
            "files": {path.name: fingerprint(path) for path in files},
        },
    )


def write_annotations(ctx: Context, table: pa.Table, report: dict) -> None:
    first = [ctx.view.get("annotation"), *ctx.dataset.get("first_columns", [])]
    drop = (
        INTERNAL_COLUMNS + LEGACY_COLUMNS + tuple(ctx.dataset.get("drop_columns", []))
    )
    table = order_columns(drop_columns(table, drop), [c for c in first if c])
    table = stamp_v2(strip_pandas_metadata(table))
    atomic_write(ctx.work / "annotations.parquet", parquet_bytes(table))
    (ctx.work / "assemble_report.json").write_text(
        json.dumps(report, indent=1, default=str)
    )


def paper_refresh_steps(ctx: Context) -> list[Step]:
    """Swiss-Prot, human + fly, β-lactamase: paper membership and coordinates,
    every annotation source refreshed."""
    steps = prepare_steps(ctx)
    ann_bundle = ctx.work / "ann" / "data.parquetbundle"
    missing_fasta = ctx.work / "missing.fasta"
    missing_parquet = ctx.work / "missing.parquet"
    stages = enabled_stage_groups(ctx)
    groups = stages[-1] if stages else []

    def paper_ids() -> list[str]:
        return projection_ids(read_projection_source(find_projection_source(ctx))[1])

    def missing_ids() -> list[str]:
        have = set(row_ids(extract_ann(ann_bundle)))
        return [i for i in paper_ids() if i not in have]

    if ctx.dataset.get("missing_rows") == "annotate":
        # Paper rows without a UniProt vector (146 in human + fly) are annotated
        # from FASTA and keep their paper position.
        steps.append(
            fasta_step(
                ctx,
                missing_ids,
                missing_fasta,
                name="missing-fasta",
                inputs=lambda: {
                    "annotated": fingerprint(ann_bundle),
                    "membership": fingerprint(find_projection_source(ctx)),
                },
            )
        )
        missing_cache = ctx.work / "missing_cache"
        args = annotate_args(ctx, missing_fasta, groups, missing_parquet, missing_cache)

        def any_missing() -> bool:
            missing_parquet.unlink(missing_ok=True)
            if missing_fasta.is_file() and missing_fasta.stat().st_size:
                return True
            ctx.log("every paper row has a vector; nothing to annotate")
            return False

        steps.append(
            fetch_step(
                ctx,
                "missing-annotate",
                args,
                inputs=lambda: {"fasta": fingerprint(missing_fasta)},
                releases=annotate_releases(missing_cache),
                when=any_missing,
            )
        )

    def assemble() -> None:
        pieces = [extract_ann(ann_bundle)]
        if missing_parquet.is_file():
            pieces.append(
                drop_columns(
                    normalize_id(pq.read_table(missing_parquet)), INTERNAL_COLUMNS
                )
            )
        table = concat_aligned(pieces) if len(pieces) > 1 else pieces[0]
        ids = paper_ids()
        extra = sorted(set(row_ids(table)) - set(ids))
        table, absent = align_rows(table, ids)
        write_annotations(
            ctx,
            table,
            {
                "rows": table.num_rows,
                "rows_without_annotations": absent,
                "rows_outside_paper_membership_dropped": extra,
                "origin": {
                    c: "refreshed" for c in table.column_names if c != ID_COLUMN
                },
                "fresh_rows_without_entry": obsolete_rows(table),
            },
        )

    steps.append(
        assemble_step(
            ctx,
            "prepare output + missing rows, paper membership",
            assemble,
            [ann_bundle, missing_parquet],
        )
    )
    steps.append(projections_step(ctx, drop_quality=True))
    return steps


def annotate_source_steps(ctx: Context) -> tuple[list[Step], Path, Path]:
    """FASTA of the source's accessions + one ``annotate`` over it."""
    fasta = ctx.work / "full_length.fasta"
    fresh = ctx.work / "fresh.parquet"
    cache = ctx.work / "annotate_cache"
    groups = ctx.dataset["refresh_groups"]
    steps = [
        fasta_step(
            ctx,
            lambda: row_ids(read_bundle(find_source(ctx)).annotations),
            fasta,
            inputs=lambda: {"source": fingerprint(find_source(ctx))},
        )
    ]
    args = annotate_args(ctx, fasta, groups, fresh, cache)
    steps.append(
        fetch_step(
            ctx,
            "annotate",
            args,
            inputs=lambda: {"fasta": fingerprint(fasta)},
            releases=annotate_releases(cache),
        )
    )
    return steps, fasta, fresh


def eat_graft_steps(ctx: Context) -> list[Step]:
    """venom-eat and phosphatase-eat: the paper's EAT inputs and outputs, grafted
    onto a fresh fetch (R-EAT)."""
    steps, _, fresh = annotate_source_steps(ctx)
    withheld = ctx.dataset.get("withheld", {})
    spec = GraftSpec(
        frozen=ctx.dataset.get("frozen", []),
        keep_paper_columns=ctx.dataset.get("keep_paper_columns", True),
        withheld=dict(withheld.get("columns", {})),
        split_column=withheld.get("split_column"),
        query_value=withheld.get("query_value"),
    )

    def assemble() -> None:
        paper = read_bundle(find_source(ctx)).annotations
        migrated: dict[str, int] = {}
        if format_version(paper) < 2:
            # G9: re-encode a v1 source before any v2 column joins it.
            paper, migrated = migrate_v1_columns(paper)
        fetched = normalize_id(pq.read_table(fresh))
        table, report = graft_columns(paper, fetched, spec)
        if spec.withheld:
            # G6: the refresh must never refill the withheld columns.
            assert_no_refill(
                table, spec.split_column, spec.query_value, list(spec.withheld)
            )
        report.update(
            rows=table.num_rows,
            v1_cells_migrated=migrated,
            fresh_rows_without_entry=obsolete_rows(fetched),
        )
        write_annotations(ctx, table, report)

    steps.append(
        assemble_step(
            ctx, "graft the paper EAT columns onto the fetch", assemble, [fresh]
        )
    )
    steps.append(
        projections_step(ctx, drop_quality=not ctx.dataset.get("freeze_statistics"))
    )
    return steps


def demo_refresh_steps(ctx: Context) -> list[Step]:
    """The startup demo: its four projections kept, every annotation refreshed
    from full-length sequences, the mature-peptide length kept."""
    steps, fasta, fresh = annotate_source_steps(ctx)
    keep = list(ctx.dataset.get("keep_source_columns", []))

    def assemble() -> None:
        source = normalize_id(read_bundle(find_source(ctx)).annotations)
        if format_version(source) < 2:
            source, _ = migrate_v1_columns(source, keep)
        ids = row_ids(source)
        fetched = drop_columns(normalize_id(pq.read_table(fresh)), INTERNAL_COLUMNS)
        table, absent = align_rows(fetched, ids)
        # G8 evidence: UniProt's length equals the FASTA length, so InterPro and
        # Biocentral saw full-length sequences, not the embedded mature peptides.
        lengths = {a: len(s) for a, s in parse_fasta_text(fasta.read_text()).items()}
        uniprot = (
            dict(zip(ids, table.column("length").to_pylist(), strict=True))
            if "length" in table.column_names
            else {}
        )
        equal = sum(1 for a, n in lengths.items() if as_int(uniprot.get(a)) == n)
        origin = {c: "refreshed" for c in table.column_names if c != ID_COLUMN}
        for column in keep:
            values = source.column(column)
            if column in table.column_names:
                table = table.set_column(
                    table.column_names.index(column), column, values
                )
            else:
                table = table.append_column(column, values)
            origin[column] = "source"
        write_annotations(
            ctx,
            table,
            {
                "rows": table.num_rows,
                "rows_without_annotations": absent,
                "full_length": {
                    "sequences": len(lengths),
                    "length_matches_uniprot": equal,
                },
                "origin": origin,
                "fresh_rows_without_entry": obsolete_rows(fetched),
            },
        )

    steps.append(
        assemble_step(
            ctx, f"refreshed annotations + source {keep}", assemble, [fresh, fasta]
        )
    )
    steps.append(projections_step(ctx, drop_quality=False))
    return steps


def tail_steps(ctx: Context) -> list[Step]:
    """Statistics, legends, bundle, style and provenance, shared by every recipe.

    ``protspace style`` rebuilds the legends it touches (a manual order becomes
    alphabetical), so it only sees a settings-free bundle. Carried-over and
    cluster legends are merged in afterwards, untouched.
    """
    work = ctx.work
    frozen_stats = ctx.dataset.get("freeze_statistics", False)
    with_stats = ctx.dataset.get("stats", False)
    stats_list = ctx.dataset.get("stats_annotations", [])
    raw = work / "raw.parquetbundle"
    styled = work / "styled.parquetbundle"
    steps: list[Step] = []

    stats_args = ["stats"]
    for spec in dataset_embeddings(ctx):
        stats_args += ["-i", spec]
    stats_args += [
        "-p",
        str(work / "proj_final"),
        "-a",
        str(work / "annotations.final.parquet"),
        "-o",
        str(work / "statistics.parquet"),
        "--cluster-selection",
        ctx.dataset.get("cluster_selection", "both"),
        "--stats-annotation",
        ",".join(stats_list),
        "--settings-out",
        str(work / "stats_styles.json"),
        "--seed",
        "42",
        "-v",
    ]

    def stats() -> None:
        final_proj = work / "proj_final"
        if final_proj.exists():
            shutil.rmtree(final_proj)
        shutil.copytree(work / "proj", final_proj)
        shutil.copyfile(
            work / "annotations.parquet", work / "annotations.final.parquet"
        )
        for stale in (work / "statistics.parquet", work / "stats_styles.json"):
            stale.unlink(missing_ok=True)
        if frozen_stats:
            parts = split_bundle(find_source(ctx), work / "src")
            if "statistics.parquet" not in parts:
                raise BuildError("freeze_statistics, but the source has no statistics")
            shutil.copyfile(parts["statistics.parquet"], work / "statistics.parquet")
        elif with_stats:
            if not stats_list:
                raise BuildError("stats need an explicit stats_annotations list (G12)")
            ctx.need_cli().run(stats_args, cwd=work, log=ctx.log)

    def stats_inputs() -> dict[str, Any]:
        return {
            "recipe": ctx.recipe(STATS_KEYS),
            "cli": ctx.cli_identity() if with_stats and not frozen_stats else None,
            "annotations": fingerprint(work / "annotations.parquet"),
            "projections": fingerprint(work / "proj"),
            "embeddings": [
                fingerprint(split_h5_spec(s)[0]) for s in dataset_embeddings(ctx)
            ],
            "source": fingerprint(find_source(ctx)) if frozen_stats else None,
        }

    if with_stats and not frozen_stats:
        steps.append(
            Step(
                "stats",
                shlex.join(stats_args),
                stats,
                command=stats_args,
                inputs=stats_inputs,
            )
        )
    else:
        summary = "frozen paper statistics" if frozen_stats else "no statistics"
        steps.append(Step("stats", summary, stats, inputs=stats_inputs))

    bundle_args = [
        "bundle",
        "-p",
        str(work / "proj_final"),
        "-a",
        str(work / "annotations.final.parquet"),
        "-o",
        str(raw),
        "-v",
    ]

    def bundle() -> None:
        args = list(bundle_args)
        if (work / "statistics.parquet").is_file():
            args[-1:-1] = ["-s", str(work / "statistics.parquet")]
        ctx.need_cli().run(args, cwd=work, log=ctx.log)

    steps.append(
        Step(
            "bundle",
            shlex.join(bundle_args),
            bundle,
            command=bundle_args,
            inputs=lambda: {
                "cli": ctx.cli_identity(),
                "annotations": fingerprint(work / "annotations.final.parquet"),
                "projections": fingerprint(work / "proj_final"),
                "statistics": fingerprint(work / "statistics.parquet"),
            },
        )
    )

    styles_file = ctx.dataset.get("styles")
    style_args = [
        "style",
        str(raw),
        str(styled),
        "--annotation-styles",
        str(work / "styles.json"),
    ]

    def style() -> None:
        styled.unlink(missing_ok=True)
        styles = {}
        if styles_file:
            styles = json.loads((SCRIPT_DIR / styles_file).read_text())
            styles.pop("$comment", None)
        kept, notes = filter_styles(styles, read_bundle(raw).annotations)
        for note in notes:
            ctx.log(f"style: {note}")
        (work / "styles.json").write_text(json.dumps(kept, indent=1))
        if kept:
            ctx.need_cli().run(style_args, cwd=work, log=ctx.log)
        else:
            shutil.copyfile(raw, styled)

    steps.append(
        Step(
            "style",
            f"protspace style ({styles_file or 'none'})",
            style,
            command=style_args,
            inputs=lambda: {
                "cli": ctx.cli_identity(),
                "styles": content_sha256(SCRIPT_DIR / styles_file)
                if styles_file
                else None,
                "raw": fingerprint(raw),
            },
        )
    )

    def finalize() -> None:
        bundle_ = read_bundle(styled)
        table = bundle_.annotations
        if format_version(table) != 2:
            raise BuildError("the bundled annotations lost their v2 stamp")
        legends, notes = carried_legends(ctx, table)
        legends.update(bundle_.settings or {})  # the styled legends win
        settings = make_settings(legends, ctx.dataset.get("envelope"))
        for note in notes:
            ctx.log(f"settings: {note}")
        table = set_provenance(table, provenance(ctx, table))
        cut = ctx.dataset.get("web_cut") if ctx.web_cut_active() else None
        if cut:
            rebuild_bundle(styled, table, settings, ctx.full_variant)
            table = drop_columns(table, cut)
            ctx.log(
                f"web cut: dropped {cut}; full file kept as {ctx.full_variant.name}"
            )
        else:
            ctx.full_variant.unlink(missing_ok=True)
        rebuild_bundle(styled, table, settings, ctx.final)
        ctx.log(f"wrote {ctx.final} ({ctx.final.stat().st_size / 1e6:.1f} MB)")

    def finalize_inputs() -> dict[str, Any]:
        # Not the invocation's own command line or time: re-running `build` must
        # not rewrite a finished file (its sha256 ties the D2 measurement to it).
        return {
            "recipe": ctx.recipe(),
            "release": ctx.release,
            "file_pattern": ctx.config.build.get("file_pattern"),
            "zenodo_doi": ctx.config.build.get("zenodo_doi"),
            "web_cut": ctx.web_cut_active(),
            "cli": ctx.cli_identity(),
            "data_releases": data_releases(ctx),
            "styled": fingerprint(styled),
            "stats_styles": fingerprint(work / "stats_styles.json"),
            "assemble_report": fingerprint(work / "assemble_report.json"),
            "source": fingerprint(find_source(ctx))
            if "source" in ctx.dataset
            else None,
        }

    cut_note = " (web cut)" if ctx.web_cut_active() else ""
    steps.append(
        Step(
            "finalize",
            f"legends + provenance → {ctx.file_name}{cut_note}",
            finalize,
            inputs=finalize_inputs,
        )
    )
    return steps


def carried_legends(ctx: Context, table: pa.Table) -> tuple[dict, list[str]]:
    """Cluster legends from ``stats`` plus legends carried over from the source.

    A frozen-statistics source carries every legend (its cluster legends match its
    frozen cluster columns); otherwise ``source_legends`` names the ones to keep.
    """
    legends: dict = {}
    notes: list[str] = []
    wanted = ctx.dataset.get("source_legends")
    if ctx.dataset.get("freeze_statistics") or wanted:
        for column, entry in unwrap_legends(
            read_bundle(find_source(ctx)).settings
        ).items():
            if (wanted is None or column in wanted) and column in table.column_names:
                entry, dropped = filter_legend(entry, table, column)
                legends[column] = entry
                notes += dropped
    stats_styles = ctx.work / "stats_styles.json"
    if stats_styles.is_file():
        legends.update(json.loads(stats_styles.read_text()))
    return legends, notes


def data_releases(ctx: Context) -> dict[str, list[str]]:
    """``{fetch step: releases}`` its data came from, for this recipe's fetch steps.

    Only what the CLI (or UniProt's FASTA responses) recorded for data; the
    probes of what UniProt served at some moment are not in it.
    """
    facts = ctx.facts()
    return {
        step.name: facts[f"data-release:{step.name}"]
        for step in recipe_steps(ctx)
        if step.fetches and f"data-release:{step.name}" in facts
    }


def fetched_release(ctx: Context) -> str | None:
    """The one UniProt release the refreshed annotations came from.

    Raises when the fetched data mixes releases, when a fetch step recorded none
    (unknown), or when it is not the target release, unless
    ``--allow-release-mismatch``. What UniProt serves now does not matter: a
    finished build can be finalized after UniProt moves on.
    """
    by_step = data_releases(ctx)
    known = sorted(
        {r for releases in by_step.values() for r in releases} - {UNKNOWN_RELEASE}
    )
    unknown = sorted(s for s, rs in by_step.items() if UNKNOWN_RELEASE in rs)
    problems = []
    if len(known) > 1:
        problems.append(
            f"the fetched data mixes UniProt releases {by_step}; redo the steps "
            "that fetched the older one (--redo STEP)"
        )
    if unknown:
        problems.append(f"{unknown} recorded no UniProt release for their data")
    if not known:
        problems.append("no fetch step recorded the UniProt release of its data")
    elif known != [ctx.release]:
        problems.append(f"the annotations are from {known}, not {ctx.release}")
    if problems and not ctx.allow_release_mismatch:
        raise BuildError("; ".join(problems) + " (--allow-release-mismatch to go on)")
    for problem in problems:
        ctx.log(f"WARNING provenance: {problem}")
    probes = sorted(
        {
            v
            for k, v in ctx.facts().items()
            if k.startswith("probe-release:") and v and v not in known
        }
    )
    if probes:
        ctx.log(f"note: UniProt served {probes} at some point; the data is {known}")
    return known[0] if len(known) == 1 else None


def provenance(ctx: Context, table: pa.Table) -> dict[str, Any]:
    fetched = fetched_release(ctx)
    report_path = ctx.work / "assemble_report.json"
    origin = (
        json.loads(report_path.read_text()).get("origin", {})
        if report_path.is_file()
        else {}
    )
    releases = {
        "refreshed": fetched,
        "withheld-truth": fetched,
        "paper": ctx.dataset.get("paper_release"),
        "source": ctx.dataset.get("paper_release"),
        "computed": None,
    }
    cli = ctx.need_cli()
    return {
        "example_id": ctx.ds_id,
        "protspace_version": cli.version(),
        "git_sha": cli.git_sha(),
        "builder_git_sha": git_sha(REPO_ROOT),
        "uniprot_release": release_groups(origin, table.column_names, releases),
        "membership_release": ctx.dataset.get("membership_release"),
        "built_at": dt.datetime.now(dt.UTC).isoformat(timespec="seconds"),
        "command": ctx.command,
        "pipeline": pipeline_commands(ctx),
        "zenodo_doi": ctx.config.build.get("zenodo_doi") or None,
    }


def pipeline_commands(ctx: Context) -> list[str]:
    """The CLI commands of this build, machine paths replaced by placeholders."""
    replacements = [
        (str(ctx.work), "$WORK"),
        (ctx.config.expand("{nm_data}"), "$NM_DATA"),
        (ctx.config.expand("{cli_data}"), "$CLI_DATA"),
        (str(REPO_ROOT), "$REPO"),
        (str(Path.home()), "~"),
    ]
    commands = []
    for step in recipe_steps(ctx):
        if not step.command:
            continue
        text = "protspace " + shlex.join(step.command)
        for old, new in replacements:
            if old and "{" not in old:
                text = text.replace(old, new)
        commands.append(text)
    return commands


def recipe_steps(ctx: Context) -> list[Step]:
    kind = ctx.dataset["kind"]
    if kind == "paper-refresh":
        body = paper_refresh_steps(ctx)
    elif kind == "eat-graft":
        body = eat_graft_steps(ctx)
    else:
        body = demo_refresh_steps(ctx)
    return [check_inputs_step(ctx), *body, *tail_steps(ctx)]


# ---------------------------------------------------------------------------
# Verify and report
# ---------------------------------------------------------------------------


def file_identity(path: Path) -> dict[str, Any]:
    """What ties a verification or a measurement to the exact bytes it saw."""
    return {
        "file": path.name,
        "bytes": path.stat().st_size,
        "sha256": sha256_file(path),
    }


def verify(ctx: Context) -> tuple[bool, list[Gate]]:
    """Run every gate on the built file and record the result in verify.json.

    The record carries the file's sha256: stage-release ships a file only while
    its latest verification passed on exactly those bytes.
    """
    if not ctx.final.is_file():
        raise BuildError(f"{ctx.final} does not exist; build it first")
    identity = file_identity(ctx.final)
    bundle = read_bundle(ctx.final)
    frozen = list(ctx.dataset.get("frozen", []))
    if ctx.dataset.get("keep_paper_columns"):
        origin = assemble_report(ctx).get("origin", {})
        frozen += [c for c, o in origin.items() if o.startswith("paper")]
    gates = common_gates(bundle, ctx.dataset, ctx.view, frozen=frozen)
    gates += context_gates(ctx, bundle, identity)
    gates += run_story_gates(bundle, ctx.dataset.get("gates", []))
    ok, text = summarize(gates)
    record = {
        "dataset": ctx.ds_id,
        **identity,
        "ok": ok,
        "web_cut": ctx.web_cut_active(),
        "verified_at": dt.datetime.now(dt.UTC).isoformat(timespec="seconds"),
        "default_view": ctx.view,
        "default_view_source": ctx.view_source,
        "summary": text,
        "gates": [g.__dict__ for g in gates],
    }
    atomic_write(
        ctx.root / "verify.json",
        json.dumps(record, indent=1, default=str).encode(),
    )
    for gate in gates:
        ctx.log(f"gate {gate.status.upper():7} {gate.name}: {gate.detail}")
    ctx.log(f"verify: {text} (default view from {ctx.view_source})")
    return ok, gates


def release_readiness(bundle_path: Path, verify_path: Path) -> str | None:
    """Why a built file may not be staged for release (None: it may).

    It needs a verify.json whose gates all passed (no ``fail``, no ``pending``)
    on exactly this file's bytes.
    """
    if not bundle_path.is_file():
        return f"{bundle_path.name} is not built"
    if not verify_path.is_file():
        return "never verified (run verify)"
    record = json.loads(verify_path.read_text())
    if record.get("sha256") != sha256_file(bundle_path):
        return "verify.json is for other bytes than the built file (run verify)"
    if not record.get("ok"):
        blocking = [
            f"{g['name']} ({g['status']})"
            for g in record.get("gates", [])
            if g.get("status") not in PASSING_STATUSES
        ]
        return f"gates not passed: {blocking}"
    return None


def assemble_report(ctx: Context) -> dict:
    path = ctx.work / "assemble_report.json"
    return json.loads(path.read_text()) if path.is_file() else {}


def frozen_columns_gate(ctx: Context, bundle: Bundle) -> Gate:
    """EAT examples keep the paper's frozen columns value-for-value (v1 sources
    after their v2 re-encoding)."""
    source = read_bundle(find_source(ctx)).annotations
    if format_version(source) < 2:
        source, _ = migrate_v1_columns(source)
    table = bundle.annotations
    ids = row_ids(table)
    source_rows = {pid: i for i, pid in enumerate(row_ids(source))}
    patterns = ctx.dataset.get("frozen", [])
    checked, differing = [], []
    for column in source.column_names:
        if column == ID_COLUMN or not matches_any(column, patterns):
            continue
        checked.append(column)
        if column not in table.column_names:
            differing.append(f"{column} (missing)")
            continue
        old = source.column(column).to_pylist()
        new = table.column(column).to_pylist()
        if any(old[source_rows[pid]] != new[i] for i, pid in enumerate(ids)):
            differing.append(column)
    return Gate(
        "frozen-columns",
        "fail" if differing else "pass",
        f"differ: {differing}"
        if differing
        else f"{len(checked)} columns as in the paper",
    )


def provenance_gate(found: dict[str, Any]) -> Gate:
    """Provenance is written, and every release it states is a UniProt release.

    A stated release that is not ``YYYY_MM`` (``"2025_04 (inferred; confirm …)"``,
    ``"unrecorded …"``) is an author fact still to confirm (tasks 7.1): the gate
    is ``pending`` until the recipe states it, because the docs page and the
    manifest would publish the note as a release.
    """
    required = ("example_id", "protspace_version", "uniprot_release", "built_at")
    missing = [k for k in (*required, "command") if k not in found]
    if missing:
        return Gate("provenance", "fail", f"missing {missing}")
    stated = {"membership": found.get("membership_release")}
    groups = found.get("uniprot_release")
    if isinstance(groups, dict):
        for group, value in groups.items():
            release = value.get("release") if isinstance(value, dict) else value
            if release is not None:
                stated[group] = release
    elif groups is not None:
        stated["all"] = groups
    unconfirmed = {
        k: v for k, v in stated.items() if not RELEASE_RE.match(str(v or ""))
    }
    if unconfirmed:
        return Gate(
            "provenance",
            "pending",
            f"releases to confirm in showcase.toml (tasks 7.1): {unconfirmed}",
            {"stated": stated},
        )
    return Gate("provenance", "pass", f"written; releases {stated}", {"stated": stated})


#: One column per annotation source that shows whether the source delivered.
SOURCE_COLUMNS = {
    "uniprot": "protein_name",
    "taxonomy": "species",
    "interpro": "pfam",
    "ted": "ted_domains",
    "biocentral": "predicted_subcellular_location",
}


def sources_filled_gate(table: pa.Table, origin: dict[str, str]) -> Gate:
    """No refreshed source may be empty on every row.

    The CLI's incomplete-source warnings stop a partial fetch (run_fetch); this
    is the file-side check that a source did not arrive empty all the same.
    Other refreshed columns that are empty everywhere only warn: some are
    legitimately empty for a small set.
    """
    empty_sources, empty_columns = [], []
    for column in table.column_names:
        if column == ID_COLUMN or origin.get(column, "refreshed") != "refreshed":
            continue
        if any(not is_missing(v) for v in table.column(column).to_pylist()):
            continue
        source = next((s for s, c in SOURCE_COLUMNS.items() if c == column), None)
        (empty_sources if source else empty_columns).append(
            f"{source} ({column})" if source else column
        )
    status = "fail" if empty_sources else "warn" if empty_columns else "pass"
    detail = (
        f"empty on every row: sources {empty_sources}, columns {empty_columns}"
        if status != "pass"
        else "every refreshed column has values"
    )
    return Gate("sources-filled", status, detail)


def context_gates(
    ctx: Context, bundle: Bundle, identity: dict[str, Any] | None = None
) -> list[Gate]:
    """Gates that need the build's sources or facts, not only the bundle."""
    gates: list[Gate] = []
    try:
        metadata, data = read_projection_source(find_projection_source(ctx))
        _, expected = select_projections(metadata, data, projection_spec(ctx))
        same = coordinate_map(expected) == coordinate_map(bundle.data)
        gates.append(
            Gate(
                "coordinates",
                "pass" if same else "fail",
                "paper coordinates unchanged" if same else "differ from the source",
            )
        )
    except BuildError as error:
        gates.append(Gate("coordinates", "fail", str(error)))

    if ctx.dataset["kind"] == "eat-graft":
        gates.append(frozen_columns_gate(ctx, bundle))
    if ctx.dataset.get("freeze_statistics"):
        source_parts = split_parts(find_source(ctx).read_bytes())
        final_parts = split_parts(ctx.final.read_bytes())
        same = len(final_parts) == 5 and final_parts[4] == source_parts[4]
        gates.append(
            Gate(
                "statistics-frozen", "pass" if same else "fail", "paper statistics part"
            )
        )

    gates.append(provenance_gate(read_provenance(bundle.annotations)))

    report = assemble_report(ctx)
    gates.append(sources_filled_gate(bundle.annotations, report.get("origin", {})))
    if "fresh_rows_without_entry" in report:
        gates.append(
            obsolete_gate(
                "fetch-without-entry",
                report["fresh_rows_without_entry"],
                ctx.dataset.get("max_obsolete", 0),
                "accessions got no UniProt entry in the refresh",
            )
        )
    for spec in ctx.dataset.get("gates", []):
        kind = spec["type"]
        if kind == "full_length_inputs":
            full = report.get("full_length", {})
            n, equal = full.get("sequences", 0), full.get("length_matches_uniprot", 0)
            fraction = equal / n if n else 0.0
            gates.append(
                Gate(
                    "full-length-inputs",
                    "pass" if fraction >= spec.get("min_fraction", 0.99) else "fail",
                    f"{equal} of {n} FASTA sequences have UniProt's full length",
                )
            )
        elif kind == "source_column_kept":
            source = normalize_id(read_bundle(find_source(ctx)).annotations)
            column = spec["column"]
            expected = dict(
                zip(row_ids(source), source.column(column).to_pylist(), strict=True)
            )
            actual = dict(
                zip(
                    row_ids(bundle.annotations),
                    bundle.annotations.column(column).to_pylist(),
                    strict=True,
                )
            )
            same = expected == actual
            gates.append(
                Gate(
                    f"kept:{column}",
                    "pass" if same else "fail",
                    "as in the source" if same else "differs",
                )
            )
        elif kind == "pfam_duplicates":
            gates.append(pfam_duplicate_gate(ctx, spec))
        elif kind == "browser_load":
            gates.append(
                browser_load_gate(ctx, spec, identity or file_identity(ctx.final))
            )
    return gates


def pfam_duplicate_gate(ctx: Context, params: dict) -> Gate:
    """Pfam empty rate on duplicate-sequence rows ≈ unique rows (InterPro fan-out).

    Reads the CLI's annotation cache, which keeps ``sequence``. A cache without
    ``pfam`` or ``sequence`` fails: the CLI leaves an incomplete InterPro out of
    it, and that must not pass as "nothing to check".
    """
    caches = sorted(
        (ctx.work / "ann" / "tmp").rglob("all_annotations.parquet"),
        key=lambda p: p.stat().st_mtime,
    )
    if not caches:
        return Gate("pfam-duplicates", "fail", "no annotation cache with sequences")
    names = pq.read_schema(caches[-1]).names
    if "sequence" not in names or "pfam" not in names:
        return Gate(
            "pfam-duplicates",
            "fail",
            "the annotation cache lacks sequence or pfam (InterPro incomplete?)",
        )
    frame = pq.read_table(caches[-1], columns=["sequence", "pfam"]).to_pandas()
    frame = frame[frame["sequence"].fillna("") != ""]
    sizes = frame.groupby("sequence")["sequence"].transform("size")
    empty = frame["pfam"].map(is_missing)
    duplicate = float(empty[sizes > 1].mean())
    unique = float(empty[sizes == 1].mean())
    gap = abs(duplicate - unique)
    status = (
        "fail"
        if gap > params.get("max_gap", 0.15)
        else "warn"
        if gap > params.get("warn_gap", 0.05)
        else "pass"
    )
    return Gate(
        "pfam-duplicates",
        status,
        f"Pfam empty on {duplicate:.1%} of duplicate-sequence rows vs {unique:.1%} of unique",
    )


def d2_measurement_path(ctx: Context) -> Path:
    return ctx.root / "d2_measurement.json"


def record_load(
    ctx: Context, *, seconds: float, heap_mb: float, machine: str
) -> dict[str, Any]:
    """Record a browser measurement of the built file, tied to its sha256."""
    if not ctx.final.is_file():
        raise BuildError(f"{ctx.final} does not exist; build it first")
    record = {
        **file_identity(ctx.final),
        "web_cut": ctx.web_cut_active(),
        "load_seconds": seconds,
        "heap_mb": heap_mb,
        "machine": machine,
        "measured_at": dt.datetime.now(dt.UTC).isoformat(timespec="seconds"),
    }
    atomic_write(d2_measurement_path(ctx), json.dumps(record, indent=1).encode())
    return record


def browser_load_gate(ctx: Context, params: dict, identity: dict[str, Any]) -> Gate:
    """D2: Swiss-Prot ships only if it loads in ≤ ~35 s with ≤ ~1.5 GB of heap.

    Measured by hand in a real browser on the reference laptop and recorded with
    ``record-load``, which ties it to the file's sha256: a rebuilt file (a web
    cut, a restyle, new provenance) must be measured again. ``pending`` until
    then, and pending blocks the release like a failure.
    """
    measurement = d2_measurement_path(ctx)
    if not measurement.is_file():
        return Gate(
            "browser-load",
            "pending",
            f"load {ctx.final.name} in a browser and run record-load; over budget → "
            "build --web-cut, then measure the cut file",
        )
    data = json.loads(measurement.read_text())
    if data.get("sha256") != identity["sha256"]:
        return Gate(
            "browser-load",
            "pending",
            f"{measurement.name} measured other bytes ({data.get('sha256', '?')[:12]}…, "
            f"{data.get('bytes')} B) than {ctx.final.name} "
            f"({identity['sha256'][:12]}…); measure it again",
        )
    ok = (
        data["load_seconds"] <= params["max_seconds"]
        and data["heap_mb"] <= params["max_heap_mb"]
    )
    return Gate(
        "browser-load",
        "pass" if ok else "fail",
        f"{data['load_seconds']} s, {data['heap_mb']} MB heap on {data.get('machine')} "
        f"(limits {params['max_seconds']} s, {params['max_heap_mb']} MB)"
        + ("" if ok else "; build --web-cut and measure the cut file"),
        data,
    )


def report(ctx: Context) -> None:
    settings = ctx.config.raw.get("report", {})
    rows = clustering_report(
        read_bundle(ctx.final),
        ctx.ds_id,
        ctx.dataset.get("report", {}),
        ctx.root / "report",
        k=settings.get("k", 15),
        max_queries=settings.get("max_queries", 20000),
        top=settings.get("legend_top", 10),
        thumbnails=ctx.thumbnails,
    )
    ctx.log(
        f"report: {len(rows)} candidate views → {ctx.root / 'report' / 'report.md'}"
    )


# ---------------------------------------------------------------------------
# Release staging: the showcase release (through write_manifest.py) and the
# perf-datasets release
# ---------------------------------------------------------------------------


def manifest_writer():
    """``write_manifest.py``, the one writer of the web app's example manifest.

    Loaded from the file next to this one (the scripts are not a package).
    """
    module = sys.modules.get("write_manifest")
    if module is None:
        spec = importlib.util.spec_from_file_location(
            "write_manifest", SCRIPT_DIR / "write_manifest.py"
        )
        module = importlib.util.module_from_spec(spec)
        sys.modules["write_manifest"] = module
        spec.loader.exec_module(module)
    return module


def built_file(config: Config, out_root: Path, ds_id: str, release: str) -> Path:
    pattern = config.build.get("file_pattern", "{id}_{release}.parquetbundle")
    return out_root / ds_id / pattern.format(id=ds_id, release=release)


def stage_release(
    config: Config,
    out_root: Path,
    release: str,
    staging: Path,
    ids: Sequence[str] | None = None,
    *,
    force: bool = False,
    previous_manifest: Path = EXAMPLE_MANIFEST,
) -> dict:
    """Stage the showcase files and the example manifest; print the owner's steps.

    Every file must be built and must have passed ``verify`` on exactly its
    bytes (:func:`release_readiness`); ``force`` stages it anyway, with a
    warning. The manifest is written by ``write_manifest.py`` from the staged
    files, with the committed manifest as the previous one (retained files,
    Zenodo DOIs), so it is the module the web app, the docs page and
    ``pnpm examples:fetch`` read. Returns the manifest.
    """
    writer = manifest_writer()
    ids = list(ids or config.datasets)
    tag = config.build.get("release_tag")
    problems = []
    for ds_id in ids:
        built = built_file(config, out_root, ds_id, release)
        problem = release_readiness(built, out_root / ds_id / "verify.json")
        if problem:
            problems.append(f"{ds_id}: {problem}")
    if problems and not force:
        raise BuildError(
            "refusing to stage:\n  "
            + "\n  ".join(problems)
            + "\n(--force stages them anyway)"
        )
    for problem in problems:
        print(f"WARNING (--force): {problem}")

    staging.mkdir(parents=True, exist_ok=True)
    repo: list[tuple[str, Path]] = []
    assets: list[tuple[str, Path]] = []
    for ds_id in ids:
        dataset = config.datasets[ds_id]
        built = built_file(config, out_root, ds_id, release)
        if not built.is_file():
            continue
        if dataset.get("hosting") == "repo":
            target = staging / dataset.get("repo_file", built.name)
            repo.append((ds_id, target))
        else:
            target = staging / built.name
            assets.append((ds_id, target))
        shutil.copyfile(built, target)
    if assets and not tag:
        raise BuildError("[build] release_tag is not set")

    previous = (
        writer.parse_manifest(previous_manifest.read_text())
        if previous_manifest.is_file()
        else None
    )
    try:
        manifest = writer.build_manifest(
            repo=repo,
            release=assets,
            release_tag=tag if assets else None,
            retained=writer.retained_after(previous, tag if assets else None),
            public_dir=staging,
            previous=previous,
        )
    except (SystemExit, ValueError) as error:
        raise BuildError(
            f"write_manifest.py refused the staged files: {error}"
        ) from None
    manifest_out = staging / "example-manifest.ts"
    manifest_out.write_text(writer.render_manifest(manifest))

    sums = "".join(f"{sha256_file(path)}  {path.name}\n" for _, path in assets)
    (staging / "SHA256SUMS").write_text(sums)
    notes = ["Curated example datasets for protspace.app.", ""]
    for ds_id, record in manifest["examples"].items():
        annotations = ", ".join(
            f"{g} {r}" for g, r in record["releases"]["annotations"].items()
        )
        notes.append(
            f"- `{record['file']}` ({ds_id}, {record['hosting']}): "
            f"{record['proteins']:,} proteins, {record['bytes'] / 1e6:.1f} MB; "
            f"UniProt {annotations or 'n/a'}"
        )
    (staging / "RELEASE_NOTES.md").write_text("\n".join(notes) + "\n")

    print(f"Staged {len(repo) + len(assets)} bundles and the manifest in {staging}")
    print("\nThe repository owner publishes them with (not run by this script):\n")
    if assets:
        files = " ".join(
            shlex.quote(str(p))
            for p in [*(p for _, p in assets), staging / "SHA256SUMS"]
        )
        repo_name = config.build.get("github_repo", GITHUB_REPO)
        print(
            f"gh release create {tag} --repo {repo_name} "
            f"--title {shlex.quote(f'Showcase datasets ({release})')} "
            f"--notes-file {shlex.quote(str(staging / 'RELEASE_NOTES.md'))} {files}"
        )
    for _, path in repo:
        print(f"cp {shlex.quote(str(path))} apps/web/public/{path.name}")
    print(
        f"cp {shlex.quote(str(manifest_out))} {EXAMPLE_MANIFEST.relative_to(REPO_ROOT)}"
    )
    print(
        "# then check it against the published files:\n"
        "pnpm examples:fetch && uv run --no-project --with pyarrow python "
        "apps/protspace/scripts/generate_examples/write_manifest.py --refresh --check"
    )
    return manifest


PERF_RELEASE = "perf-datasets"
PERF_MANIFEST = REPO_ROOT / "perf" / "datasets.manifest.json"
PUBLIC_DATA = "apps/web/public/data"


@dataclass(frozen=True)
class PerfDataset:
    """One perf-datasets asset: where its bytes come from, and its default-sweep flag."""

    id: str
    #: The path the file is read from: a git blob committed at this path, or,
    #: with ``blob=None``, a file under ``--nm-dir``.
    path: str
    #: In the benchmark's default sweep (the former ``apps/web/public/data/datasets.json``).
    default: bool
    #: Full git blob id. The blob outlives the working-tree file and pins its bytes.
    blob: str | None = None
    #: For a file outside git: the sha256 its bytes must have.
    sha256: str | None = None

    @property
    def file(self) -> str:
        return f"{self.id}.parquetbundle"


# The perf-datasets release (W4/G18). The benchmark's default sweep keeps the
# order of the former datasets.json; the rest run only when named in
# PERF_DATASETS. The eleven former public/data bundles are read from their git
# blobs, so staging works after the files leave the working tree.
PERF_DATASETS: tuple[PerfDataset, ...] = (
    PerfDataset(
        "venom_eat_stats",
        f"{PUBLIC_DATA}/venom_eat_stats.parquetbundle",
        True,
        blob="248577935716fdb678a02ed4f13fa3ca79b8b42c",
    ),
    PerfDataset(
        "5K",
        f"{PUBLIC_DATA}/5K.parquetbundle",
        True,
        blob="f5939dec86b5cacf140728a67543f4cb337aa7e7",
    ),
    PerfDataset(
        "40K",
        f"{PUBLIC_DATA}/40K.parquetbundle",
        True,
        blob="694c555903bd2ccbd4f203f9889811b53b634b12",
    ),
    PerfDataset(
        "7K_toxprot",
        f"{PUBLIC_DATA}/7K_toxprot.parquetbundle",
        True,
        blob="b5db479a7ca7d827fc4f345568c715eb9f249bce",
    ),
    PerfDataset(
        "35K_ec_brenda",
        f"{PUBLIC_DATA}/35K_ec_brenda.parquetbundle",
        True,
        blob="7c5c8818e9dd85a479e0a66b94f484079294b048",
    ),
    PerfDataset(
        "105K_homoSapiens_drosophilaMelanogaster",
        f"{PUBLIC_DATA}/105K_homoSapiens_drosophilaMelanogaster.parquetbundle",
        True,
        blob="2ac5fd185ba0c94af76e865a9905acf3b0e75607",
    ),
    PerfDataset(
        "127K_beta_lactamase",
        f"{PUBLIC_DATA}/127K_beta_lactamase.parquetbundle",
        True,
        blob="ca7e52ac7bd9053a82aa71b98fa83513992034be",
    ),
    PerfDataset(
        "beta_lactamase_ec",
        f"{PUBLIC_DATA}/beta_lactamase_ec.parquetbundle",
        True,
        blob="7b0ca5a560eff29b88a146694e695eb1ae150b34",
    ),
    PerfDataset(
        "beta_lactamase_pn",
        f"{PUBLIC_DATA}/beta_lactamase_pn.parquetbundle",
        True,
        blob="b034774911713af2f21025d90f03c8869ab57949",
    ),
    PerfDataset(
        "phosphatase",
        f"{PUBLIC_DATA}/phosphatase.parquetbundle",
        True,
        blob="8f27860d1f18b2eb4312935e7fef07f3f500f477",
    ),
    PerfDataset(
        "573K_swissprot",
        f"{PUBLIC_DATA}/573K_swissprot.parquetbundle",
        False,
        blob="217cf859982302e59404935fa2907c19799b9d31",
    ),
    # The manuscript's Fig. 3 bundle. Named after its directory, because its own
    # file name is data.parquetbundle. Not in git: read from the manuscript
    # workspace and checked against the checksum the manuscript records.
    PerfDataset(
        "beta_lactamase_2026_stats",
        "data/beta_lactamase_2026_stats/data.parquetbundle",
        False,
        sha256="58c60e6074d6afcdeff400d13e383e07d4d59bd082404c851925352417cef6b0",
    ),
    PerfDataset(
        "phosphatase_eat",
        "apps/web/tests/fixtures/phosphatase_eat.parquetbundle",
        False,
        blob="f13e1c9026aad1e1919138ed8e10c0018ca74e86",
    ),
)


def read_blob(blob: str) -> bytes:
    """A git blob's bytes; the blob outlives the working-tree file it came from."""
    result = subprocess.run(
        ["git", "cat-file", "blob", blob],
        cwd=REPO_ROOT,
        capture_output=True,
        check=False,
    )
    if result.returncode != 0:
        raise SystemExit(f"git has no blob {blob}: {result.stderr.decode().strip()}")
    return result.stdout


def read_dataset(dataset: PerfDataset, nm_dir: Path) -> bytes:
    if dataset.blob:
        return read_blob(dataset.blob)
    path = nm_dir / dataset.path
    if not path.exists():
        raise SystemExit(f"{dataset.id}: {path} not found (pass --nm-dir)")
    data = path.read_bytes()
    actual = hashlib.sha256(data).hexdigest()
    if dataset.sha256 and actual != dataset.sha256:
        raise SystemExit(
            f"{dataset.id}: {path} has sha256 {actual}, expected {dataset.sha256}"
        )
    return data


def stage_perf(out: Path, nm_dir: Path, write_manifest: bool) -> list[dict]:
    """Stage the perf-datasets assets with SHA256SUMS; rewrite perf/datasets.manifest.json.

    The manifest (``{release, datasets: [{id, file, bytes, sha256, default,
    source}]}``) is what ``pnpm perf:fetch`` verifies against and the perf spec
    serves from.
    """
    out.mkdir(parents=True, exist_ok=True)
    records = []
    sums = []
    for dataset in PERF_DATASETS:
        data = read_dataset(dataset, nm_dir)
        digest = hashlib.sha256(data).hexdigest()
        (out / dataset.file).write_bytes(data)
        sums.append(f"{digest}  {dataset.file}")
        records.append(
            {
                "id": dataset.id,
                "file": dataset.file,
                "bytes": len(data),
                "sha256": digest,
                "default": dataset.default,
                "source": (
                    f"git blob {dataset.blob} ({dataset.path})"
                    if dataset.blob
                    else f"protspace_publication/nm_2026/{dataset.path}"
                ),
            }
        )
        print(f"staged {dataset.file} ({len(data):,} bytes)")
    (out / "SHA256SUMS").write_text("\n".join(sums) + "\n")
    if write_manifest:
        manifest = {"release": PERF_RELEASE, "datasets": records}
        PERF_MANIFEST.write_text(json.dumps(manifest, indent=2) + "\n")
        print(f"wrote {PERF_MANIFEST.relative_to(REPO_ROOT)}")
    return records


def publish_commands(release: str, out: Path, title: str, notes: str) -> list[str]:
    assets = " ".join(
        shlex.quote(str(path)) for path in sorted(out.glob("*.parquetbundle"))
    )
    sums = shlex.quote(str(out / "SHA256SUMS"))
    return [
        f"gh release create {release} --repo {GITHUB_REPO} "
        f"--title {shlex.quote(title)} --notes {shlex.quote(notes)} {assets} {sums}",
        f"# or, to replace assets on an existing release:\n"
        f"gh release upload {release} --repo {GITHUB_REPO} --clobber {assets} {sums}",
    ]


# ---------------------------------------------------------------------------
# Command line
# ---------------------------------------------------------------------------


def make_context(
    args: argparse.Namespace, config: Config, ds_id: str, cli: Cli | None
) -> Context:
    dataset = config.datasets[ds_id]
    catalog = (
        config.path(config.build["catalog"]) if config.build.get("catalog") else None
    )
    view, source = resolve_default_view(ds_id, dataset, catalog)
    return Context(
        ds_id=ds_id,
        dataset=dataset,
        config=config,
        out_root=args.out_root,
        cli=cli,
        release=args.release,
        dry_run=getattr(args, "dry_run", False),
        view=view,
        view_source=source,
        enabled_stages=set(getattr(args, "enable_stage", []) or []),
        redo=set(getattr(args, "redo", []) or []),
        web_cut=getattr(args, "web_cut", None),
        allow_release_mismatch=getattr(args, "allow_release_mismatch", False),
        allow_unfixed_cli=getattr(args, "allow_unfixed_cli", False),
        thumbnails=not getattr(args, "no_thumbnails", False),
        command=build_command(getattr(args, "argv", None) or sys.argv[1:]),
    )


def build_command(argv: Sequence[str]) -> str:
    """This invocation, for provenance, with machine paths shortened."""
    text = shlex.join(["build_showcase.py", *argv])
    for old, new in ((str(REPO_ROOT), "$REPO"), (str(Path.home()), "~")):
        text = text.replace(old, new)
    return text


def check_output_location(path: Path, config: Config, what: str) -> None:
    """Refuse an output directory inside the repository or an input directory.

    The build reads the manuscript data and the CLI's data in place; writing
    next to them (or into the checkout, where the fixtures and the demo live)
    could overwrite an input or leave gigabytes in ``git status``.
    """
    target = path.expanduser().resolve()
    protected = {"the repository": REPO_ROOT}
    for name in ("nm_data", "cli_data"):
        expanded = config.expand(f"{{{name}}}")
        if "{" not in expanded:
            protected[f"[paths] {name}"] = Path(expanded)
    for label, directory in protected.items():
        directory = directory.expanduser().resolve()
        if target == directory or directory in target.parents:
            raise BuildError(
                f"{what} {path} is inside {label} ({directory}); choose a "
                "directory outside the repository and the inputs"
            )


def selected_ids(
    args: argparse.Namespace, config: Config, *, default_all: bool = False
) -> list[str]:
    ids = list(args.only or [])
    if getattr(args, "all", False) or (default_all and not ids):
        ids = list(config.datasets)
    unknown = [i for i in ids if i not in config.datasets]
    if unknown:
        raise BuildError(
            f"unknown dataset(s) {unknown}; known: {list(config.datasets)}"
        )
    if not ids:
        raise BuildError("choose datasets with --only ID (repeatable) or --all")
    return ids


def persist_web_cut(ctx: Context, decision: bool | None) -> None:
    """Record ``--web-cut``/``--no-web-cut`` so later builds keep the decision."""
    if decision is None:
        return
    if decision and not ctx.dataset.get("web_cut"):
        raise BuildError(f"{ctx.ds_id} has no web_cut columns in showcase.toml")
    if ctx.dry_run:
        ctx.log(f"web cut would be {'on' if decision else 'off'} from now on")
        return
    ctx.record("web_cut", decision)
    ctx.log(f"web cut {'on' if decision else 'off'} (kept for later builds)")


def cmd_build(args: argparse.Namespace, config: Config) -> int:
    ids = selected_ids(args, config)
    cli = None
    if args.cli_root:
        # check-inputs refuses a CLI without the prerequisites (fix branch, #452).
        cli = Cli(args.cli_root, dry_run=args.dry_run)
    elif not args.dry_run and not args.verify_only:
        raise BuildError("--cli-root is required (the checkout with the fixed CLI)")
    if not args.dry_run:
        check_output_location(args.out_root, config, "--out-root")
    failed = []
    for ds_id in ids:
        ctx = make_context(args, config, ds_id, cli)
        ctx.log(
            f"{'verify' if args.verify_only else 'build'} {ctx.dataset['kind']} → {ctx.final}"
        )
        ctx.log(f"default view ({ctx.view_source}): {ctx.view}")
        if args.verify_only:
            ok, _ = verify(ctx)
            failed += [] if ok else [ds_id]
            continue
        with build_lock(ctx):
            persist_web_cut(ctx, args.web_cut)
            if not args.dry_run:
                ctx.web_cut = None  # from here on, the recorded decision
            execute(ctx, recipe_steps(ctx))
            if args.dry_run:
                continue
            ok, _ = verify(ctx)
            if not args.skip_report:
                report(ctx)
            failed += [] if ok else [ds_id]
    if failed:
        print(
            f"verification did not pass for {failed} (see <id>/verify.json)",
            file=sys.stderr,
        )
        return 1
    return 0


def cmd_report(args: argparse.Namespace, config: Config) -> int:
    for ds_id in selected_ids(args, config):
        report(make_context(args, config, ds_id, None))
    return 0


def cmd_record_load(args: argparse.Namespace, config: Config) -> int:
    ids = selected_ids(args, config)
    if len(ids) != 1:
        raise BuildError("record-load measures one dataset: pass --only ID once")
    ctx = make_context(args, config, ids[0], None)
    record = record_load(
        ctx, seconds=args.seconds, heap_mb=args.heap_mb, machine=args.machine
    )
    ctx.log(f"recorded {json.dumps(record)} → {d2_measurement_path(ctx)}")
    ok, _ = verify(ctx)
    return 0 if ok else 1


def cmd_stage_release(args: argparse.Namespace, config: Config) -> int:
    staging = args.staging or args.out_root / "staging" / "showcase"
    check_output_location(staging, config, "--staging")
    stage_release(
        config,
        args.out_root,
        args.release,
        staging,
        selected_ids(args, config, default_all=True),
        force=args.force,
    )
    return 0


def cmd_stage_perf(args: argparse.Namespace, config: Config) -> int:
    nm_dir = args.nm_dir or config.path("{nm_data}").parent
    check_output_location(args.out, config, "--out")
    try:
        stage_perf(args.out, nm_dir, write_manifest=not args.no_manifest)
    except SystemExit as error:
        raise BuildError(str(error)) from None
    print("\nThe repository owner publishes the staged files with:\n")
    for command in publish_commands(
        PERF_RELEASE,
        args.out,
        "Perf datasets",
        "Bundles for the WebGL perf harness (pnpm perf:fetch), byte-identical "
        "to the files the ProtSpace manuscript measured. See perf/README.md.",
    ):
        print(command)
    return 0


def parse_args(argv: Sequence[str] | None = None) -> argparse.Namespace:
    base = argparse.ArgumentParser(add_help=False)
    base.add_argument(
        "--config",
        type=Path,
        default=DEFAULT_CONFIG,
        help="recipes (default: showcase.toml)",
    )
    base.add_argument(
        "--path",
        action="append",
        default=[],
        metavar="NAME=VALUE",
        help="override a [paths] entry",
    )
    base.add_argument("-v", "--verbose", action="store_true")

    common = argparse.ArgumentParser(add_help=False, parents=[base])
    common.add_argument(
        "--out-root", type=Path, help="output root (default: [build] out_root)"
    )
    common.add_argument(
        "--release",
        help="UniProt release the refresh targets (default: [build] uniprot_release)",
    )
    common.add_argument(
        "--only", action="append", metavar="ID", help="dataset id (repeatable)"
    )
    common.add_argument(
        "--all", action="store_true", help="every dataset in showcase.toml"
    )

    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    sub = parser.add_subparsers(dest="command", required=True)

    build = sub.add_parser("build", parents=[common], help="build or resume bundles")
    build.add_argument(
        "--cli-root", type=Path, help="checkout providing the fixed protspace CLI"
    )
    build.add_argument(
        "--dry-run",
        action="store_true",
        help="print the plan and commands, run and write nothing",
    )
    build.add_argument(
        "--verify-only", action="store_true", help="only run the gates on built bundles"
    )
    build.add_argument(
        "--redo",
        action="append",
        metavar="STEP",
        help="re-run a step (and what follows); 'all' for every step",
    )
    build.add_argument(
        "--enable-stage",
        action="append",
        metavar="NAME",
        help="enable a stage marked enabled = false",
    )
    build.add_argument(
        "--web-cut",
        action=argparse.BooleanOptionalAction,
        default=None,
        help="drop the dataset's web_cut columns (D2 fallback); the decision is "
        "kept for later builds until --no-web-cut",
    )
    build.add_argument("--allow-release-mismatch", action="store_true")
    build.add_argument("--allow-unfixed-cli", action="store_true")
    build.add_argument("--skip-report", action="store_true")
    build.add_argument("--no-thumbnails", action="store_true")

    verify_ = sub.add_parser(
        "verify", parents=[common], help="run the gates on built bundles"
    )
    verify_.set_defaults(verify_only=True, cli_root=None, dry_run=False)

    report_ = sub.add_parser(
        "report", parents=[common], help="clustering report + thumbnails"
    )
    report_.add_argument("--no-thumbnails", action="store_true")

    load = sub.add_parser(
        "record-load",
        parents=[common],
        help="record the D2 browser measurement of a built bundle",
    )
    load.add_argument("--seconds", type=float, required=True, help="load time")
    load.add_argument("--heap-mb", type=float, required=True, help="JS heap in MB")
    load.add_argument(
        "--machine", required=True, help="the reference machine and browser"
    )

    stage = sub.add_parser(
        "stage-release",
        parents=[common],
        help="stage the verified showcase bundles and their manifest",
    )
    stage.add_argument(
        "--staging", type=Path, help="default: <out-root>/staging/showcase"
    )
    stage.add_argument(
        "--force",
        action="store_true",
        help="stage files whose verification is missing, stale or not passed",
    )

    perf = sub.add_parser(
        "stage-perf",
        parents=[base],
        help="stage the perf-datasets release assets",
    )
    perf.add_argument("--out", type=Path, required=True, help="staging directory")
    perf.add_argument(
        "--nm-dir",
        type=Path,
        help="the manuscript workspace (default: the parent of [paths] nm_data)",
    )
    perf.add_argument(
        "--no-manifest",
        action="store_true",
        help=f"do not rewrite {PERF_MANIFEST.relative_to(REPO_ROOT)}",
    )
    return parser.parse_args(argv)


def main(argv: Sequence[str] | None = None) -> int:
    args = parse_args(argv)
    args.argv = list(sys.argv[1:] if argv is None else argv)
    logging.basicConfig(
        level=logging.DEBUG if args.verbose else logging.INFO, format="%(message)s"
    )
    handlers = {
        "build": cmd_build,
        "verify": cmd_build,
        "report": cmd_report,
        "record-load": cmd_record_load,
        "stage-release": cmd_stage_release,
        "stage-perf": cmd_stage_perf,
    }
    if args.command == "verify":
        args.verify_only = True
        for name, value in {
            "dry_run": False,
            "redo": [],
            "enable_stage": [],
            "web_cut": None,
            "allow_release_mismatch": False,
            "allow_unfixed_cli": False,
            "skip_report": True,
            "no_thumbnails": True,
        }.items():
            setattr(args, name, getattr(args, name, value))
    try:
        overrides = dict(item.split("=", 1) for item in args.path)
        config = Config.load(args.config, overrides)
        if args.command != "stage-perf":
            args.release = args.release or config.build.get("uniprot_release")
            args.out_root = (
                args.out_root
                or config.path(
                    config.build.get("out_root", "{home}/protspace-showcase")
                )
            ).expanduser()
        return handlers[args.command](args, config)
    except BuildError as error:
        print(f"error: {error}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    sys.exit(main())
