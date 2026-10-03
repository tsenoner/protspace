#!/usr/bin/env python3
"""Build the curated showcase bundles behind protspace.app's Import-menu examples.

Strategy R (OpenSpec change ``curated-example-datasets``, design Decision 9): keep
each paper dataset's membership and published coordinates and refresh every
annotation source with the fixed CLI at the current UniProt release. The EAT
example (``embed-build``) has no source bundle: its membership is a pinned
accession list, and the build embeds, projects, labels, holds out and transfers it
itself. Recipes live in ``showcase.toml``; the README next to this file has usage
examples per dataset.

Every protspace step runs as a subprocess of the CLI checkout given by
``--cli-root`` (``uv run --frozen --project <cli-root> protspace …``), so the data
does not depend on which branch this script is run from. The bundle *container* is
the exception: this script reads and writes it with this repository's own protspace
package (``protspace.data.io.bundle``, the one implementation of the format), so it
reads a file of any container version (a legacy v1/v2 paper source, or the
intermediates of a CLI from before format v3) and always writes the final bundle as
v3, whatever version the CLI checkout writes. Inputs are read-only; everything is
written under the output root (default ``~/protspace-showcase/2026_03``), which may
not lie inside the repository or an input directory.

Subcommands::

    build          build (or resume) bundles: --only ID (repeatable) or --all
    verify         run the verification gates on built bundles (= build --verify-only)
    report         clustering report + thumbnails for the default-view choice
    record-load    record the D2 browser measurement of a built bundle (tied to its sha256)
    stage-release  stage the verified showcase bundles, write the example manifest with
                   write_manifest.py, and print the owner's commands (reads the
                   release's assets and notes with `gh release view`)
    stage-perf     stage the perf-datasets release assets, rewrite
                   perf/datasets.manifest.json, and print the owner's commands

Neither staging command publishes anything: creating and uploading a release is the
repository owner's step.
"""

from __future__ import annotations

import argparse
import contextlib
import csv
import datetime as dt
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
from dataclasses import dataclass, field, replace
from pathlib import Path
from typing import Any

import pandas as pd
import pyarrow as pa
import pyarrow.compute as pc
import pyarrow.parquet as pq

from protspace.core.constants import BROWSER_MISSING_TOKENS
from protspace.data.annotations.configuration import (
    INTERNAL_ANNOTATIONS,
    SOURCE_ANNOTATIONS,
)
from protspace.data.annotations.encoding import (
    BUNDLE_FORMAT_VERSION,
    decode_field,
    migrate_legacy_annotation_table,
    read_format_version,
    stamp_format_version,
)
from protspace.data.annotations.manager import UNKNOWN_RELEASE, read_release_stamp
from protspace.data.annotations.retrievers.taxonomy_retriever import (
    TAXONOMY_ANNOTATIONS,
)
from protspace.data.io.atomic import atomic_write_bytes
from protspace.data.io.bundle import PARQUET_BUNDLE_DELIMITER as DELIMITER
from protspace.data.io.bundle import BundleContents as Bundle
from protspace.data.io.bundle import (
    read_bundle_contents,
    replace_annotations_in_bundle,
    replace_settings_in_bundle,
)
from protspace.data.io.bundle_v3 import CONTAINER_VERSION
from protspace.data.io.settings_converter import (
    KELLYS_COLORS,
    LEGEND_SETTINGS_KEY,
    NA_PINNED_COLOR,
    is_frontend_envelope,
    rewrap_settings,
    unwrap_settings,
)
from protspace.data.loaders.h5 import split_h5_spec
from protspace.stats.base import CLUSTER_COLUMN_PREFIX
from protspace.utils.add_annotation_style import resolve_style_key, style_keys

logger = logging.getLogger("build_showcase")

SCRIPT_DIR = Path(__file__).resolve().parent
REPO_ROOT = SCRIPT_DIR.parents[3]
DEFAULT_CONFIG = SCRIPT_DIR / "showcase.toml"
# The web app's example manifest. Only write_manifest.py (next to this file)
# writes it; stage-release stages a new one through that writer.
EXAMPLE_MANIFEST = REPO_ROOT / "apps/web/src/explore/example-manifest.ts"
GITHUB_REPO = "tsenoner/protspace"
#: ``[build] file_pattern`` when showcase.toml sets none. The ``_v3`` suffix keeps a
#: v3 file from taking the name of a published v2 asset: a release file name never
#: carries different bytes.
DEFAULT_FILE_PATTERN = "{id}_{release}_v3.parquetbundle"

ID_COLUMN = "protein_id"
LEGACY_COLUMNS = ("length_fixed", "length_quantile")
TOOLTIP_ONLY_COLUMNS = frozenset({"gene_name", "protein_name", "uniprot_kb_id"})
PRED_MARKER = "__pred_"
KINDS = ("paper-refresh", "demo-refresh", "embed-build")


def is_missing_label(text: str) -> bool:
    """Whether the web app shows this display value as N/A (W10).

    The web's missing tokens (protspace's ``BROWSER_MISSING_TOKENS``), compared
    trimmed and case-insensitively, plus the empty string: a gate here counts
    N/A exactly as the legend does.
    """
    stripped = text.strip()
    return not stripped or stripped.lower() in BROWSER_MISSING_TOKENS


# Kelly's colours in the web app's order, without the two greys at its end.
KELLYS = tuple(KELLYS_COLORS[:19])
OTHER_COLOR = "#B8B8B8"

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
    "holdout",
    "transfer",
    "embeddings",
)

UNIPROT_REST = "https://rest.uniprot.org/uniprotkb"
RELEASE_PROBE = f"{UNIPROT_REST}/search?query=accession:P69905&size=1&fields=accession"
# A stated UniProt release; anything else (a note such as "inferred; confirm")
# is an author fact still to confirm (tasks 7.1).
RELEASE_RE = re.compile(r"^\d{4}_\d{2}$")


class BuildError(RuntimeError):
    """A build step cannot continue (bad input, failed CLI step, violated guard)."""


# ---------------------------------------------------------------------------
# Annotation cell grammar (protspace.data.annotations.encoding)
#
# Two versions meet in this script. The *container* version of a bundle (3, or
# none for a legacy v1/v2 file) is part 1's ``protspace_container_version``; the
# *cell grammar* of an annotations table (1 = legacy raw text, 2 = percent-encoded)
# is its ``protspace_format_version`` stamp. Every table the build handles is
# v2-shaped: a v3 file's annotations come back from protspace's reader decoded into
# grammar-2 cells, so the gates and reports below parse strings in every case.
# ---------------------------------------------------------------------------


def format_version(table: pa.Table) -> int:
    """The annotations table's cell-grammar version (unstamped = legacy v1).

    Not the container version: see :attr:`Bundle.container_version`.
    """
    return read_format_version(table)


def cell_labels(cell: Any) -> list[str]:
    """Clean category labels of a cell for gates and reports (missing → []).

    In the web's order (``splitCategoricalAnnotationValues`` in conversion.ts):
    each ``;`` hit is tested for N/A as it stands, suffix included, and only then
    loses its ``|score``/``|evidence`` suffix. So ``None|0.9`` is a category
    ``None`` here as in the legend, while a hit whose label is empty after the
    suffix goes (``|0.9``) is dropped.
    """
    if cell is None:
        return []
    if not isinstance(cell, str):
        return [str(cell)]
    labels = []
    for hit in cell.split(";"):
        if is_missing_label(hit):
            continue
        label = decode_field(hit.split("|", 1)[0]).strip()
        if label:
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
#
# The container is protspace's (``protspace.data.io.bundle``): its reader checks
# the part layout and decodes a v3 core, its writers encode one, so this script
# has no bundle codec of its own. A bundle is read as protspace's ``BundleContents``
# (``Bundle`` here): the v2-shaped tables the gates parse, the settings, the
# statistics and the container version. What it writes is always a v3 container.
# ---------------------------------------------------------------------------


def read_bundle(path: Path) -> Bundle:
    """Read a bundle of any container version with protspace's reader.

    It checks the container (six parts if and only if part 1 declares container
    version 3; three to five for a legacy file) and decodes a v3 core into the
    v2-shaped tables the gates parse. The build reads legacy files on purpose
    (the paper's pinned source bundles, the intermediates of a CLI from before
    format v3), so without protspace's deprecation warning, which would suggest
    converting a pinned input.
    """
    try:
        return read_bundle_contents(path, warn_legacy=False)
    except ValueError as error:
        raise BuildError(f"{path} is not a readable parquetbundle: {error}") from None


def parquet_bytes(table: pa.Table) -> bytes:
    """One plain parquet file (a work table the CLI reads)."""
    buffer = io.BytesIO()
    pq.write_table(table, buffer)
    blob = buffer.getvalue()
    if DELIMITER in blob:
        raise BuildError("a serialized part contains the bundle delimiter")
    return blob


def rebuild_bundle(
    bundle_path: Path, table: pa.Table, settings: dict | None, out_path: Path
) -> None:
    """Write ``bundle_path`` again as a v3 container, with new annotations and settings.

    protspace's writers do it: ``replace_annotations_in_bundle`` encodes the
    annotations (a v3 input keeps its projection parts as stored and each column
    the kind it had; a legacy input, from a CLI before format v3, is encoded
    whole, as ``protspace convert`` encodes one), then
    ``replace_settings_in_bundle`` sets the settings part. The statistics part
    keeps its bytes. ``settings=None`` keeps the input's settings. ``table`` must
    carry the v2 cell-grammar stamp (the encoder refuses to guess a grammar).
    """
    try:
        if settings is None:
            replace_annotations_in_bundle(bundle_path, out_path, table)
            return
        staged = out_path.with_name(f".{out_path.name}.annotations-{os.getpid()}")
        try:
            replace_annotations_in_bundle(bundle_path, staged, table)
            replace_settings_in_bundle(staged, out_path, settings)
        finally:
            staged.unlink(missing_ok=True)
    except ValueError as error:
        raise BuildError(f"protspace cannot write {out_path.name}: {error}") from None


def normalize_id(table: pa.Table) -> pa.Table:
    """Name the identifier column ``protein_id`` (annotate writes ``identifier``)."""
    names = table.column_names
    if ID_COLUMN in names:
        return table
    source = "identifier" if "identifier" in names else names[0]
    return table.rename_columns([ID_COLUMN if n == source else n for n in names])


def extract_ann(bundle_path: Path) -> pa.Table:
    """The annotations of a CLI ``prepare``/``transfer`` output: the selected
    columns only (never the ``tmp/all_annotations`` cache), v2-shaped (a v3 file
    decoded by protspace's reader), without the internal lookup columns."""
    annotations = read_bundle(bundle_path).annotations
    return drop_columns(normalize_id(annotations), INTERNAL_ANNOTATIONS)


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


def read_projection_source(source: Path) -> tuple[pa.Table, pa.Table]:
    """Projection metadata and data from a bundle or a projections directory."""
    if source.is_dir():
        return (
            pq.read_table(source / "projections_metadata.parquet"),
            pq.read_table(source / "projections_data.parquet"),
        )
    bundle = read_bundle(source)
    return bundle.metadata, bundle.projections


def projection_ids(data: pa.Table) -> list[str]:
    """Identifiers of the first projection, in file order."""
    first = data.column("projection_name")[0].as_py()
    rows = data.filter(pc.equal(data.column("projection_name"), first))
    return [str(v) for v in rows.column("identifier").to_pylist()]


def coordinate_map(data: pa.Table) -> dict[tuple[str, str], tuple]:
    """``{(projection, id): (x, y, z)}`` at float32, the precision a v3 file
    stores and the browser draws (a missing axis is ``None``)."""

    def axis(name: str) -> list:
        if name not in data.column_names:
            return [None] * data.num_rows
        return pc.cast(data.column(name), pa.float32()).to_pylist()

    names = data.column("projection_name").to_pylist()
    ids = data.column("identifier").to_pylist()
    xs, ys, zs = axis("x"), axis("y"), axis("z")
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


def query_mask(
    table: pa.Table, split_column: str, query_value: str | Sequence[str]
) -> list[bool]:
    """Rows whose ``split_column`` holds ``query_value`` (or one of several)."""
    wanted = {query_value} if isinstance(query_value, str) else set(query_value)
    values = table.column(split_column).to_pylist()
    return [bool(wanted & set(cell_labels(v))) for v in values]


def refill_violations(
    table: pa.Table,
    split_column: str,
    query_value: str | Sequence[str],
    columns: Sequence[str],
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
    table: pa.Table,
    split_column: str,
    query_value: str | Sequence[str],
    columns: Sequence[str],
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

    ``origin`` maps a column to its group (``refreshed``, ``source``, …); columns
    not in it are ``computed`` when they are cluster or transfer (``__pred_``)
    columns and ``refreshed`` otherwise.
    """
    groups: dict[str, dict[str, Any]] = {}
    for column in columns:
        if column == ID_COLUMN:
            continue
        group = origin.get(column)
        if group is None:
            computed = column.startswith(CLUSTER_COLUMN_PREFIX) or PRED_MARKER in column
            group = "computed" if computed else "refreshed"
        entry = groups.setdefault(
            group, {"release": releases.get(group), "columns": []}
        )
        entry["columns"].append(column)
    return groups


# ---------------------------------------------------------------------------
# EAT accuracy against a withheld truth (logic of research/critic/c3_eat.py)
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
    query_value: str | Sequence[str],
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


def filter_styles(
    styles: dict[str, dict], table: pa.Table
) -> tuple[dict[str, dict], list[str]]:
    """Drop style entries naming columns or values the built data lacks.

    ``protspace style`` fails on an unknown colour/shape value, and refreshed
    annotations can lose a category; a value counts as present when protspace's
    own resolver finds it (:func:`resolve_style_key`: the value, the data's N/A
    spelling, or the same number spelled another way). Pinned lists shrink the
    same way, and ``maxVisibleValues`` follows a pinned list that has no
    ``__REST__``.
    """
    kept: dict[str, dict] = {}
    notes: list[str] = []
    for column, entry in styles.items():
        if column not in table.column_names:
            notes.append(f"style for missing column {column!r} dropped")
            continue
        values = style_keys(table.column(column).to_pylist())
        entry = json.loads(json.dumps(entry))
        for key in ("colors", "shapes"):
            if key in entry:
                for value in list(entry[key]):
                    if resolve_style_key(value, values) is None:
                        notes.append(f"{column}: {key} for absent {value!r} dropped")
                        del entry[key][value]
        if "hiddenValues" in entry:
            entry["hiddenValues"] = [
                v
                for v in entry["hiddenValues"]
                if resolve_style_key(v, values) is not None
            ]
        if "pinnedValues" in entry:
            pinned = []
            for value in entry["pinnedValues"]:
                if value == "__REST__" or resolve_style_key(value, values) is not None:
                    pinned.append(value)
                else:
                    notes.append(f"{column}: pinned {value!r} absent, dropped")
            entry["pinnedValues"] = pinned
            if "__REST__" not in pinned and pinned:
                entry["maxVisibleValues"] = len(pinned)
        kept[column] = entry
    return kept, notes


def filter_legend(entry: dict, table: pa.Table, column: str) -> tuple[dict, list[str]]:
    """Keep a carried-over legend's categories that still exist in the data.

    A category the web shows as N/A is kept whatever the data holds.
    """
    values = style_keys(table.column(column).to_pylist())
    entry = json.loads(json.dumps(entry))
    categories = entry.get("categories") or {}
    dropped = [
        key
        for key in categories
        if not is_missing_label(key) and resolve_style_key(key, values) is None
    ]
    for key in dropped:
        del categories[key]
    return entry, [f"{column}: legend category {k!r} absent, dropped" for k in dropped]


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

    rows = bundle.projections.filter(
        pc.equal(bundle.projections.column("projection_name"), projection)
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
    """How many rows (of a split, optionally) received a transfer, and how many
    of those at reliability ≥ ``threshold``.

    ``expected_*`` are exact unless ``rel_tol`` gives a band (a rebuild on new
    embeddings moves the count a little). A missing ``expected_at_threshold`` is
    pending: record the built value in showcase.toml.
    """
    column = params["column"]
    values = table.column(f"{column}__pred_value").to_pylist()
    confidence = table.column(f"{column}__pred_confidence").to_pylist()
    rows = [True] * table.num_rows
    if "split_column" in params:
        rows = query_mask(table, params["split_column"], params["query_value"])
    predicted = [
        c
        for v, c, row in zip(values, confidence, rows, strict=True)
        if row and not is_missing(v)
    ]
    threshold = params.get("threshold", 0.5)
    high = sum(1 for c in predicted if c is not None and c >= threshold)
    rel = params.get("rel_tol", 0.0)
    predicted_rel = params.get("predicted_rel_tol", 0.0)
    problems = []
    if "expected_predicted" in params and not within(
        len(predicted), params["expected_predicted"], predicted_rel, 0
    ):
        problems.append(
            f"{len(predicted)} transfers, expected {params['expected_predicted']}"
            + (f" ± {predicted_rel:.0%}" if predicted_rel else "")
        )
    if "expected_at_threshold" in params and not within(
        high, params["expected_at_threshold"], rel, 0
    ):
        problems.append(
            f"{high} at ≥ {threshold}, expected {params['expected_at_threshold']}"
            + (f" ± {rel:.0%}" if rel else "")
        )
    where = f" on {params['query_value']} rows" if "split_column" in params else ""
    detail = f"{high} of {len(predicted)} transfers{where} at reliability ≥ {threshold}"
    if problems:
        status, detail = "fail", "; ".join(problems)
    elif "expected_at_threshold" not in params:
        status = "pending"
        detail += "; record the built value as expected_at_threshold"
    else:
        status = "pass"
    return Gate(
        f"eat:{column}",
        status,
        detail,
        {"predicted": len(predicted), "at_threshold": high},
    )


def gate_eat_fanout(table: pa.Table, params: dict) -> Gate:
    """No reference donates its label to more than ``max_fanout`` queries."""
    column = params["column"]
    sources = Counter(
        decode_field(str(s))
        for s in table.column(f"{column}__pred_source").to_pylist()
        if not is_missing(s)
    )
    top = sources.most_common(1)
    largest, count = top[0] if top else (None, 0)
    ok = count <= params["max_fanout"]
    return Gate(
        f"eat-fanout:{column}",
        "pass" if ok else "fail",
        f"{len(sources)} sources; the largest, {largest}, donates to {count} "
        f"(max {params['max_fanout']})",
        {"sources": len(sources), "largest": largest, "fanout": count},
    )


def gate_name_agreement(
    table: pa.Table, params: dict, names: Sequence[str | None] | None = None
) -> Gate:
    """Transfers agree with the class a query's own name states.

    ``rules`` are ``[regex, label]`` pairs tried in order on the lower-cased
    name; the first that matches is the class the name states. Rows whose name
    states none are not counted. ``names`` (by row) replaces ``name_column``:
    the bundle's ``protein_name`` holds no TrEMBL submission names, UniProt's
    full "Protein names" do (:func:`name_agreement_gate`).
    """
    column = params["column"]
    rules = [(re.compile(pattern), label) for pattern, label in params["rules"]]
    rows = [True] * table.num_rows
    if "split_column" in params:
        rows = query_mask(table, params["split_column"], params["query_value"])
    if names is None:
        names = table.column(params.get("name_column", "protein_name")).to_pylist()
    predicted = table.column(f"{column}__pred_value").to_pylist()
    stated = agree = 0
    confusions: Counter = Counter()
    for row, name, value in zip(rows, names, predicted, strict=True):
        if not row or is_missing(value) or name is None:
            continue
        text = decode_field(str(name)).lower()
        label = next((lab for rx, lab in rules if rx.search(text)), None)
        if label is None:
            continue
        stated += 1
        guess = first_label(value)
        if guess == label:
            agree += 1
        else:
            confusions[f"{label} → {guess}"] += 1
    fraction = agree / stated if stated else 0.0
    minimum = params.get("min_fraction", 0.85)
    ok = stated >= params.get("min_n", 1) and fraction >= minimum
    return Gate(
        f"name-agreement:{column}",
        "pass" if ok else "fail",
        f"{agree} of {stated} transfers match the class the name states "
        f"({fraction:.1%}, min {minimum:.0%})",
        {"stated": stated, "agree": agree, "confusions": dict(confusions)},
    )


def holdout_ids_sha256(ids: Iterable[str]) -> str:
    """sha256 of the held-out ids, sorted, one per line."""
    return hashlib.sha256(
        "".join(f"{pid}\n" for pid in sorted(ids)).encode()
    ).hexdigest()


def held_out_ids(table: pa.Table, split_column: str, value: str) -> list[str]:
    return [
        pid
        for pid, split in zip(
            row_ids(table), table.column(split_column).to_pylist(), strict=True
        )
        if split == value
    ]


def gate_holdout_split(table: pa.Table, params: dict) -> Gate:
    """Which rows are held out is pinned, not only how many.

    The counts follow from the class sizes and ``round()`` whatever the seeded
    draw picks, and NumPy does not promise ``Generator.choice`` streams across
    versions (NEP 19): a dependency bump could change the held-out set, and the
    card's accuracy with it, under unchanged counts. ``split_sha256`` is
    :func:`holdout_ids_sha256` of the rows whose ``split_column`` is ``value``;
    without it the gate is pending and names the value to pin.
    """
    column = params.get("split_column", "eat_split")
    value = params.get("value", "holdout")
    ids = held_out_ids(table, column, value)
    digest = holdout_ids_sha256(ids)
    data = {"held_out": len(ids), "split_sha256": digest}
    pinned = params.get("split_sha256")
    if not pinned:
        return Gate(
            "holdout-split",
            "pending",
            f"pin the {len(ids)} held-out rows in showcase.toml: "
            f"split_sha256 = {digest!r}",
            data,
        )
    if digest != pinned:
        return Gate(
            "holdout-split",
            "fail",
            f"the {len(ids)} held-out rows differ from the pin "
            f"({digest[:12]}… vs {pinned[:12]}…): the draw changed (seed, "
            "fraction, labels or NumPy); re-record the card's hold-out numbers",
            data,
        )
    return Gate("holdout-split", "pass", f"{len(ids)} held-out rows as pinned", data)


def gate_eat_accuracy(table: pa.Table, params: dict) -> Gate:
    """Transfer accuracy on the withheld rows, in percent.

    ``expected_*`` pin a reproduced benchmark exactly (within ``tol_pp``);
    ``min_accuracy`` / ``min_accuracy_at_threshold`` / ``min_n`` are floors for a
    split drawn by the build, whose numbers move with the embeddings (G4).
    """
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
    checks = []
    if "expected_n" in params:
        checks.append(result["n"] == params["expected_n"])
    if "expected_accuracy" in params:
        checks.append(
            result["accuracy"] is not None
            and abs(result["accuracy"] - params["expected_accuracy"]) <= tol
        )
    if "expected_n_at_threshold" in params:
        checks.append(result["n_at_threshold"] == params["expected_n_at_threshold"])
    if "expected_accuracy_at_threshold" in params:
        checks.append(
            result["accuracy_at_threshold"] is not None
            and abs(
                result["accuracy_at_threshold"]
                - params["expected_accuracy_at_threshold"]
            )
            <= tol
        )
    if "min_n" in params:
        checks.append(result["n"] >= params["min_n"])
    if "min_accuracy" in params:
        checks.append((result["accuracy"] or 0.0) >= params["min_accuracy"])
    if "min_accuracy_at_threshold" in params:
        checks.append(
            (result["accuracy_at_threshold"] or 0.0)
            >= params["min_accuracy_at_threshold"]
        )
    ok = bool(checks) and all(checks)
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
    "eat_accuracy": gate_eat_accuracy,
    "eat_fanout": gate_eat_fanout,
    "holdout_split": gate_holdout_split,
    "no_refill": gate_no_refill,
    "coverage": gate_coverage,
}
BUNDLE_GATE_TYPES = {"neighbourhood": gate_neighbourhood}


#: Columns whose one value marks the rows it is on (``fragment`` is ``yes`` or
#: empty by design), so one value next to empty rows is informative.
PRESENCE_FLAG_COLUMNS = frozenset({"fragment"})
#: The only ``root`` values a fixed CLI writes: the top-level nodes of UniProt's
#: taxonomy, the cellular and acellular roots and the two that hold synthetic
#: and metagenomic sequences. The deepest-"no rank" bug wrote deeper clades
#: ("melanogaster subgroup", "Bacillus cereus group"), hundreds of them (G2).
TAXONOMY_ROOTS = frozenset(
    {"cellular organisms", "Viruses", "other entries", "unclassified entries"}
)


def uninformative_columns(table: pa.Table) -> dict[str, str]:
    """Annotation columns the legend could only show as N/A or as one value.

    Counted with the web's N/A rules (:func:`is_missing_label`); the id and the
    ``__pred_`` overlay columns are not annotations. A presence flag
    (:data:`PRESENCE_FLAG_COLUMNS`) with one value and some empty rows counts
    as informative.
    """
    found: dict[str, str] = {}
    for column in table.column_names:
        if column == ID_COLUMN or PRED_MARKER in column:
            continue
        counts = label_counts(table, column)
        if not counts:
            found[column] = "all N/A"
        elif len(counts) == 1:
            value = next(iter(counts))
            if column in PRESENCE_FLAG_COLUMNS and counts[value] < table.num_rows:
                continue
            found[column] = f"one value {value!r}"
    return found


def informative_gate(table: pa.Table, dataset: dict, view: dict) -> Gate:
    """No all-N/A or single-valued column ships unless a recipe keeps it (W10, G13).

    Nothing is dropped here: the gate lists the columns, and the recipe either
    leaves them out of its fetch or names them in ``keep_uninformative`` (a
    documented column). The default view's annotation and tooltip are kept
    implicitly.
    """
    found = uninformative_columns(table)
    kept = {
        view.get("annotation"),
        *(view.get("tooltip") or []),
        *dataset.get("keep_uninformative", []),
    }
    blocking = {c: why for c, why in found.items() if c not in kept}
    allowed = {c: why for c, why in found.items() if c in kept}
    if blocking:
        detail = f"all N/A or one value: {blocking}"
        if allowed:
            detail += f"; kept by the recipe: {sorted(allowed)}"
    elif allowed:
        detail = f"kept by the recipe: {allowed}"
    else:
        detail = "every column has at least two values"
    return Gate(
        "informative-columns",
        "fail" if blocking else "pass",
        detail,
        {"blocking": blocking, "kept": allowed},
    )


def taxonomy_root_gate(table: pa.Table) -> Gate | None:
    """``root`` is a top-level taxonomy node, not the deepest "no rank" (G2).

    Every value is one of :data:`TAXONOMY_ROOTS`: human + fly had only two
    values, but one was "melanogaster subgroup"; the β-lactamases have all four.
    """
    if "root" not in table.column_names:
        return None
    counts = label_counts(table, "root")
    unexpected = sorted(value for value in counts if value not in TAXONOMY_ROOTS)
    shown = dict(counts.most_common(5))
    return Gate(
        "root-values",
        "fail" if unexpected else "pass",
        f"{len(counts)} distinct values: {shown}"
        + (
            f"; not a top-level node: {unexpected[:5]}; rebuild on a CLI with "
            "the root fix"
            if unexpected
            else ""
        ),
        {"distinct": len(counts), "unexpected": len(unexpected)},
    )


def literal_none_gate(table: pa.Table, column: str) -> Gate | None:
    """A literal ``none`` the web shows as N/A instead of a category (G2, W10).

    TMbed writes ``none`` for "no transmembrane segment"; the web's N/A tokens
    include it, so the category the docs promise would vanish into N/A. A hit is
    tested as the web tests it, suffix included (:func:`cell_labels`).
    """
    if column not in table.column_names:
        return None
    count = sum(
        1
        for cell in table.column(column).to_pylist()
        if cell is not None
        and any(hit.strip().lower() == "none" for hit in str(cell).split(";"))
    )
    return Gate(
        f"literal-none:{column}",
        "fail" if count else "pass",
        f"{count} cells hold a literal 'none' (shown as N/A)"
        + ("; rebuild on a CLI that names the category" if count else ""),
        {"count": count},
    )


def common_gates(bundle: Bundle, dataset: dict, view: dict) -> list[Gate]:
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
    proj_ids = (
        set(projection_ids(bundle.projections))
        if bundle.projections.num_rows
        else set()
    )
    gates.append(
        Gate(
            "membership",
            "pass" if not duplicates and set(ids) == proj_ids else "fail",
            f"{duplicates} duplicate ids; {len(set(ids) ^ proj_ids)} ids differ "
            "between annotations and projections",
        )
    )
    leaked = [c for c in INTERNAL_ANNOTATIONS + LEGACY_COLUMNS if c in columns]
    gates.append(
        Gate(
            "no-internal-or-legacy",
            "fail" if leaked else "pass",
            f"present: {leaked}" if leaked else "no sequence/organism_id/length bins",
        )
    )
    gates.append(format_gate(bundle))

    # The column and any copy of it (e.g. a withheld truth). A parser defect
    # always fails: every family column is refreshed by the fixed CLI.
    family_columns = [
        c for c in columns if c.startswith("protein_families") and PRED_MARKER not in c
    ]
    for column in family_columns:
        defects = family_defects(table, column)
        bad = defects["truncated_tc"] + defects["section_pseudo"]
        gates.append(
            Gate(
                f"family-parser:{column}",
                "fail" if bad else "pass",
                f"{len(defects['truncated_tc'])} '(TC n' and "
                f"{len(defects['section_pseudo'])} 'In the … section' labels",
                defects,
            )
        )

    if dataset.get("xref_pdb_both", True) and "xref_pdb" in columns:
        values = {first_label(v) for v in table.column("xref_pdb").to_pylist()}
        both = {"True", "False"} <= values
        gates.append(
            Gate(
                "xref_pdb",
                "pass" if both else "fail",
                f"values {sorted(v for v in values if v)}",
            )
        )

    gates.append(informative_gate(table, dataset, view))
    gates += [
        gate
        for gate in (
            taxonomy_root_gate(table),
            literal_none_gate(table, "predicted_transmembrane"),
        )
        if gate is not None
    ]

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
        ok = is_frontend_envelope(settings) and all(
            settings.get(k) == v for k, v in envelope.items()
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


def format_gate(bundle: Bundle) -> Gate:
    """The built file is a v3 container whose cells decode in the v2 grammar.

    Every build writes v3 (:func:`rebuild_bundle`), so a legacy container here
    is a file from before the conversion: it fails rather than shipping a format
    whose reading is deprecated.
    """
    grammar = format_version(bundle.annotations)
    if bundle.container_version is None:
        return Gate(
            "format-v3",
            "fail",
            f"legacy (v1/v2) container, cell grammar v{grammar}; the build writes "
            f"v{CONTAINER_VERSION}",
        )
    ok = (
        bundle.container_version == CONTAINER_VERSION
        and grammar == BUNDLE_FORMAT_VERSION
    )
    return Gate(
        "format-v3",
        "pass" if ok else "fail",
        f"container v{bundle.container_version}, cell grammar v{grammar}",
    )


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
    {
        "full_length_inputs",
        "source_column_kept",
        "pfam_duplicates",
        "browser_load",
        "mature_inputs",
        "name_agreement",
    }
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
    xy,
    labels: Sequence[str | None],
    path: Path,
    title: str,
    top: int,
    rings: Sequence[str | None] | None = None,
) -> None:
    """A scatter of the legend view; ``rings`` (EAT) outlines each unlabelled
    point that received a transfer in the transferred label's colour."""
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
    for label, color in ((None, NA_PINNED_COLOR), ("Other", OTHER_COLOR)):
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
    if rings is not None:
        ring_colors = [
            colors.get(r, OTHER_COLOR) if r is not None and lab is None else None
            for r, lab in zip(rings, labels, strict=True)
        ]
        mask = np.array([c is not None for c in ring_colors])
        if mask.any():
            ax.scatter(
                *xy[mask].T,
                s=size * 4,
                facecolors="none",
                edgecolors=[c for c in ring_colors if c is not None],
                linewidths=0.6,
                rasterized=True,
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
    """Score every candidate annotation × projection; write JSON, Markdown, PNGs.

    ``cluster_*`` columns are never candidates (W21): k-means on the layout
    agrees with the layout by construction, so they would always rank first.
    """
    table = bundle.annotations
    ann_ids = row_ids(table)
    row_of = {pid: i for i, pid in enumerate(ann_ids)}
    projections = (
        candidates.get("projections")
        or bundle.metadata.column("projection_name").to_pylist()
    )
    annotations = [
        a
        for a in candidates.get("annotations", [])
        if not a.startswith(CLUSTER_COLUMN_PREFIX)
    ]
    if thumbnails:  # a candidate dropped from the recipe leaves no stale picture
        shutil.rmtree(out_dir / "thumbs", ignore_errors=True)
    rows: list[dict[str, Any]] = []
    for projection in projections:
        ids, xy = _coords(bundle, projection)
        for annotation in annotations:
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
                rings = None
                predicted = f"{annotation}{PRED_MARKER}value"
                if predicted in table.column_names:
                    cells = table.column(predicted).to_pylist()
                    rings = [
                        first_label(cells[row_of[i]]) if i in row_of else None
                        for i in ids
                    ]
                render_thumbnail(
                    xy,
                    labels,
                    thumb,
                    f"{ds_id} · {annotation} · {projection}",
                    top,
                    rings=rings,
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


#: The UniProt fields an ``embed-build`` reads for its sequences and labels.
ENTRY_FIELDS = (
    "accession",
    "reviewed",
    "protein_name",
    "organism_name",
    "organism_id",
    "length",
    "fragment",
    "ft_signal",
    "ft_propep",
    "ft_chain",
    "ft_peptide",
    "cc_similarity",
    "xref_interpro",
    "sequence",
)


def fetch_uniprot_entries(
    accessions: Sequence[str], fields: Sequence[str] = ENTRY_FIELDS, *, chunk: int = 100
) -> tuple[list[dict[str, str]], set[str]]:
    """UniProt TSV rows for ``accessions``, keyed by the requested field names.

    Batches use ``/uniprotkb/accessions`` (the stream endpoint drops large
    responses mid-way). A batch that does not answer 200 after the retries
    fails the call, so a partial membership can never pass silently. Returns
    the rows and every release the responses reported.
    """
    rows: list[dict[str, str]] = []
    releases: set[str] = set()
    for start in range(0, len(accessions), chunk):
        batch = list(accessions[start : start + chunk])
        response = _http_get(
            f"{UNIPROT_REST}/accessions",
            {
                "accessions": ",".join(batch),
                "fields": ",".join(fields),
                "format": "tsv",
            },
        )
        if response.status_code != 200:
            raise BuildError(
                f"UniProt answered {response.status_code} for accessions "
                f"{batch[0]}…{batch[-1]}"
            )
        release = response.headers.get("X-UniProt-Release")
        if release:
            releases.add(release)
        lines = response.text.splitlines()
        for line in lines[1:]:
            if not line.strip():
                continue
            values = line.split("\t")
            values += [""] * (len(fields) - len(values))
            rows.append(dict(zip(fields, values[: len(fields)], strict=True)))
    return rows, releases


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


def cache_release_stamp(path: Path) -> set[str]:
    """Releases the CLI stamped on an annotation cache parquet (schema only).

    The CLI keeps them in ``DataFrame.attrs``, which pandas writes to the
    ``PANDAS_ATTRS`` key (older pandas: ``attrs`` inside the ``pandas`` key),
    and reads them with protspace's :func:`read_release_stamp`: no stamp, or no
    cache, is unknown.
    """
    attrs: dict = {}
    if path.is_file():
        metadata = pq.read_schema(path).metadata or {}
        if b"PANDAS_ATTRS" in metadata:
            attrs = json.loads(metadata[b"PANDAS_ATTRS"])
        elif b"pandas" in metadata:
            attrs = json.loads(metadata[b"pandas"]).get("attrs") or {}
    frame = pd.DataFrame()
    frame.attrs = attrs
    return read_release_stamp(frame)


ANNOTATION_SOURCES = tuple(SOURCE_ANNOTATIONS)

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

    def argv(self, args: Sequence[str], extras: Sequence[str] = ()) -> list[str]:
        """``uv run`` of the checkout's protspace; ``extras`` are its optional
        dependency groups a command needs (``local`` for on-device embedding)."""
        extra_flags = [flag for name in extras for flag in ("--extra", name)]
        return [
            "uv",
            "run",
            "--frozen",
            "--project",
            str(self.project),
            *extra_flags,
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
        extras: Sequence[str] = (),
    ) -> CliResult:
        """Run one protspace command; a non-zero exit raises.

        An exit of 0 is not a complete run: the result names the annotation
        sources the command reported as not fully retrieved.
        """
        command = self.argv(args, extras)
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
    "keep_source_columns",
    "first_columns",
    "drop_columns",
    "missing_rows",
    "fill_missing_taxonomy",
    "membership_file",
    "membership_sha256",
    "labels",
    "holdout",
)
STATS_KEYS = (
    "stats",
    "stats_annotations",
    "cluster_selection",
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
    #: Optional dependency groups of the CLI the command needs (``uv --extra``).
    extras: tuple[str, ...] = ()

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
        pattern = self.config.build.get("file_pattern", DEFAULT_FILE_PATTERN)
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
        atomic_write_bytes(
            facts_path, json.dumps(facts, indent=1, sort_keys=True).encode()
        )

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
                ctx.log("    $ " + shlex.join(ctx.cli.argv(step.command, step.extras)))
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
            atomic_write_bytes(
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


def is_embed_build(ctx: Context) -> bool:
    return ctx.dataset.get("kind") == "embed-build"


def embed_model(ctx: Context) -> str:
    return (ctx.dataset.get("embed") or {}).get("model", "prot_t5")


def embed_h5(ctx: Context) -> Path:
    """The embeddings an ``embed-build`` makes (``protspace embed`` names the
    file after the model)."""
    return ctx.work / "embed" / f"{embed_model(ctx)}.h5"


def dataset_embeddings(ctx: Context) -> list[str]:
    """``path:name`` specs of the dataset's embeddings: the recipe's read-only
    inputs, or the file an ``embed-build`` makes."""
    if is_embed_build(ctx):
        return [f"{embed_h5(ctx)}:{embed_model(ctx)}"]
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
    """Where the coordinates come from: the paper's projections, the source
    bundle, or (``embed-build``) the build's own ``prepare`` output."""
    if is_embed_build(ctx):
        return ctx.work / "ann" / "data.parquetbundle"
    if "projections_source" in ctx.dataset:
        return ctx.config.first_existing(ctx.dataset["projections_source"])
    return find_source(ctx)


def membership_path(ctx: Context) -> Path:
    """The pinned accession list of an ``embed-build`` (relative to this script)."""
    path = ctx.path(ctx.dataset["membership_file"])
    return path if path.is_absolute() else SCRIPT_DIR / path


def read_membership(path: Path) -> list[str]:
    """Accessions of a membership file: one per line, ``#`` starts a comment."""
    ids = []
    for line in path.read_text().splitlines():
        text = line.split("#", 1)[0].strip()
        if text:
            ids.append(text)
    if len(set(ids)) != len(ids):
        raise BuildError(f"{path} lists an accession twice")
    return ids


def membership_ids(ctx: Context) -> list[str]:
    """Row order of an ``embed-build``: the pinned list, checked against its pin."""
    path = membership_path(ctx)
    pinned = ctx.dataset.get("membership_sha256")
    if not path.is_file():
        raise BuildError(f"membership file {path} is missing")
    if pinned and sha256_file(path) != pinned:
        raise BuildError(f"{path}: sha256 differs from membership_sha256")
    return read_membership(path)


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


def record_data_release(ctx: Context, step: str, releases: set[str]) -> None:
    """Note the UniProt release(s) a fetch step's data came from, as the CLI
    (or UniProt's response headers, for the FASTA) recorded them.

    What it could not tell is ``unknown`` (``UNKNOWN_RELEASE``), so provenance
    cannot claim a release no source reported.
    """
    value = sorted(releases)
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
        if is_embed_build(ctx):
            # The build makes its embeddings and coordinates; its one input is
            # the pinned accession list.
            try:
                ids = membership_ids(ctx)
                ctx.log(f"membership: {len(ids)} accessions in {membership_path(ctx)}")
                if len(ids) != ctx.dataset.get("proteins"):
                    problems.append(
                        f"membership lists {len(ids)} accessions, proteins = "
                        f"{ctx.dataset.get('proteins')}"
                    )
            except BuildError as error:
                problems.append(str(error))
        else:
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
    releases: Callable[[], set[str]],
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


def projection_args(ctx: Context) -> list[str]:
    """``-m`` and the reducer options of ``prepare``.

    A paper dataset keeps the paper's coordinates, so its ``-m pca2`` is cheap
    and discarded. An ``embed-build`` keeps them: ``methods`` and
    ``projection_params`` (UMAP n_neighbors, min_dist, the seed) are spelled
    out, so the command in the provenance states them.
    """
    args = ["-m", ctx.dataset.get("methods", "pca2")]
    for key, value in (ctx.dataset.get("projection_params") or {}).items():
        args += [f"--{key.replace('_', '-')}", str(value)]
    return args


def prepare_steps(ctx: Context) -> list[Step]:
    """Staged, resumable annotation fetch through ``prepare``'s per-source cache.

    Each stage adds sources and reuses the cached ones, so a failure costs only
    the stage that failed. An ``embed-build`` passes its full-length FASTA with
    ``-f``: the sequence-based sources (InterPro with Phobius, Biocentral) see
    full-length sequences although the embeddings are of the mature chains (G8).
    """
    inputs: list[str] = []
    for spec in dataset_embeddings(ctx):
        inputs += ["-i", spec]
    full_length = ctx.work / "full_length.fasta"
    if is_embed_build(ctx):
        inputs += ["-f", str(full_length)]
    ann_dir = ctx.work / "ann"
    run_log = ann_dir / "run.log"
    steps = []
    for number, groups in enumerate(enabled_stage_groups(ctx), start=1):
        args = [
            "prepare",
            *inputs,
            *projection_args(ctx),
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

        def releases(offset=offset) -> set[str]:
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
                    ],
                    **(
                        {"fasta": fingerprint(full_length)}
                        if is_embed_build(ctx)
                        else {}
                    ),
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


def annotate_releases(cache: Path) -> Callable[[], set[str]]:
    """The release(s) ``annotate --cache-dir`` stamped on its cache.

    ``annotate`` writes no run.log and its output file carries no release, so
    its cache's stamp is where the CLI records it (unknown without
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
        atomic_write_bytes(out / "projections_metadata.parquet", parquet_bytes(meta))
        atomic_write_bytes(out / "projections_data.parquet", parquet_bytes(data))

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


def write_annotations(
    ctx: Context, table: pa.Table, report: dict, name: str = "annotations.parquet"
) -> None:
    first = [ctx.view.get("annotation"), *ctx.dataset.get("first_columns", [])]
    drop = (
        INTERNAL_ANNOTATIONS
        + LEGACY_COLUMNS
        + tuple(ctx.dataset.get("drop_columns", []))
    )
    table = order_columns(drop_columns(table, drop), [c for c in first if c])
    table = stamp_format_version(strip_pandas_metadata(table))
    atomic_write_bytes(ctx.work / name, parquet_bytes(table))
    (ctx.work / "assemble_report.json").write_text(
        json.dumps(report, indent=1, default=str)
    )


def paper_annotations(ctx: Context) -> pa.Table | None:
    """The paper's own annotations next to its projections, if it kept them."""
    source = find_projection_source(ctx)
    if source.is_dir():
        path = source / "annotations.parquet"
        return normalize_id(pq.read_table(path)) if path.is_file() else None
    return normalize_id(read_bundle(source).annotations)


def fill_missing_taxonomy(
    table: pa.Table, paper: pa.Table | None
) -> tuple[pa.Table, dict[str, Any]]:
    """Give rows without a species (an entry UniProt no longer has) the paper's
    species and that species' refreshed lineage (W18, G13).

    Such rows otherwise hold the literal strings ``"None"`` the fetch wrote for
    them; the web shows those as N/A. Their species comes from the paper's
    annotations; every other taxonomy column is the lineage the refreshed rows
    of that species share (so ``root`` follows the refreshed rule). The other
    literal missing tokens on those rows become nulls. Rows the paper has no
    species for are left as they are and reported.
    """
    if "species" not in table.column_names:
        return table, {"filled": 0}
    ids = row_ids(table)
    columns = {name: table.column(name).to_pylist() for name in table.column_names}
    missing = [i for i, cell in enumerate(columns["species"]) if is_missing(cell)]
    if not missing:
        return table, {"filled": 0}
    paper_species: dict[str, str] = {}
    if paper is not None and "species" in paper.column_names:
        paper_species = {
            pid: first_label(cell)
            for pid, cell in zip(
                row_ids(paper), paper.column("species").to_pylist(), strict=True
            )
            if first_label(cell)
        }
    present = [c for c in TAXONOMY_ANNOTATIONS if c in columns and c != "species"]
    lineage: dict[str, dict[str, Any]] = {}
    for row, species in enumerate(columns["species"]):
        label = first_label(species)
        if label is None:
            continue
        counts = lineage.setdefault(label, {c: Counter() for c in present})
        for column in present:
            value = columns[column][row]
            if not is_missing(value):
                counts[column][value] += 1
    filled, unresolved = [], []
    for row in missing:
        species = paper_species.get(ids[row])
        if species is None:
            unresolved.append(ids[row])
            continue
        for name, values in columns.items():
            if (
                name != ID_COLUMN
                and isinstance(values[row], str)
                and is_missing(values[row])
            ):
                values[row] = None
        columns["species"][row] = species
        for column in present:
            counts = lineage.get(species, {}).get(column)
            if counts:
                columns[column][row] = counts.most_common(1)[0][0]
        filled.append(ids[row])
    arrays = [
        pa.array(columns[name], type=table.schema.field(name).type)
        for name in table.column_names
    ]
    report = {"filled": len(filled), "ids": filled, "unresolved": unresolved}
    return pa.Table.from_arrays(arrays, names=table.column_names), report


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
                    normalize_id(pq.read_table(missing_parquet)), INTERNAL_ANNOTATIONS
                )
            )
        table = concat_aligned(pieces) if len(pieces) > 1 else pieces[0]
        ids = paper_ids()
        extra = sorted(set(row_ids(table)) - set(ids))
        table, absent = align_rows(table, ids)
        taxonomy_fill: dict[str, Any] = {"filled": 0}
        if ctx.dataset.get("fill_missing_taxonomy"):
            table, taxonomy_fill = fill_missing_taxonomy(table, paper_annotations(ctx))
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
                "taxonomy_filled_from_paper": taxonomy_fill,
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


# ---------------------------------------------------------------------------
# embed-build: a dataset without a source bundle (G3). Membership is a pinned
# accession list; the build fetches the entries, embeds their mature chains,
# projects them, derives labels, holds out a stratified share and transfers.
# ---------------------------------------------------------------------------

_FEATURE_RE = re.compile(
    r"\b(?P<kind>SIGNAL|PROPEP|CHAIN|PEPTIDE)\s+(?P<start>[<>?]?\d*)\.\.(?P<end>[<>?]?\d*)"
)
#: The UniProt TSV field of each feature kind.
FEATURE_FIELDS = {
    "SIGNAL": "ft_signal",
    "PROPEP": "ft_propep",
    "CHAIN": "ft_chain",
    "PEPTIDE": "ft_peptide",
}


def feature_regions(text: str, kind: str) -> list[tuple[int, int]]:
    """``(start, end)`` of every ``kind`` feature in a UniProt TSV feature cell.

    Fuzzy ends (``<1``, ``1..>25``, on fragments) count as their number; a
    feature with an unknown end (``?``) is skipped.
    """
    regions = []
    for match in _FEATURE_RE.finditer(text or ""):
        if match["kind"] != kind:
            continue
        start, end = match["start"].lstrip("<>"), match["end"].lstrip("<>")
        if start.isdigit() and end.isdigit():
            regions.append((int(start), int(end)))
    return regions


@dataclass(frozen=True)
class MatureChain:
    """The part of an entry's sequence that is embedded, and how it was found."""

    accession: str
    start: int
    end: int
    sequence: str
    derivation: str
    fragment: bool
    #: The reviewed entry whose curated N-terminal propeptide this (unreviewed)
    #: chain also lost, by homology (:func:`mature_chains`); empty otherwise.
    propeptide_from: str = ""


#: Derivation of a chain cut after the family's signal-peptide motif.
SIGNAL_MOTIF = "signal motif"
#: Suffix of a derivation whose homologous curated propeptide was cut too.
HOMOLOGOUS_PROPEPTIDE = " + homologous propeptide"


def mature_chain(
    entry: dict[str, str],
    signal_motif: re.Pattern[str] | None = None,
    motif_window: int = 40,
) -> MatureChain:
    """The mature chain UniProt annotates for an entry (G1).

    Swiss-Prot often holds a toxin as the mature chain sequenced from venom,
    TrEMBL as the precursor translated from a transcript. Embedding what each
    entry's Chain feature marks (Peptide when it has no Chain; the longest one
    when there are several) puts both on the same footing. Without either, the
    signal peptide and any terminal propeptide are cut off. An entry with none
    of these features is cut after the first ``signal_motif`` match in its
    first ``motif_window`` residues (a precursor, or a fragment starting inside
    its signal peptide, that UniProt gives no feature), else used as deposited.
    A fragment's fuzzy ends are kept.
    """
    accession = entry.get("accession", "")
    sequence = entry.get("sequence", "")
    length = len(sequence)
    fragment = bool((entry.get("fragment") or "").strip())

    def valid(kind: str) -> list[tuple[int, int]]:
        return [
            (s, e)
            for s, e in feature_regions(entry.get(FEATURE_FIELDS[kind], ""), kind)
            if 1 <= s <= e <= length
        ]

    for kind, derivation in (("CHAIN", "chain"), ("PEPTIDE", "peptide")):
        regions = valid(kind)
        if regions:
            start, end = max(regions, key=lambda r: (r[1] - r[0], -r[0]))
            return MatureChain(
                accession, start, end, sequence[start - 1 : end], derivation, fragment
            )
    start, end, removed = 1, length, []
    signals = valid("SIGNAL")
    if signals:
        start = max(e for _, e in signals) + 1
        removed.append("signal peptide")
    for s, e in sorted(valid("PROPEP")):
        if s <= start <= e + 1:  # N-terminal, right after the signal peptide
            start = e + 1
            removed.append("propeptide")
        elif e >= end > s:  # C-terminal
            end = s - 1
            removed.append("propeptide")
    if not 1 <= start <= end <= length:
        start, end, removed = 1, length, []
    if removed:
        derivation = " and ".join(dict.fromkeys(removed)) + " removed"
    else:
        derivation = "as deposited"
        match = signal_motif.search(sequence[:motif_window]) if signal_motif else None
        if match and match.end() < length:
            start, derivation = match.end() + 1, SIGNAL_MOTIF
    return MatureChain(
        accession, start, end, sequence[start - 1 : end], derivation, fragment
    )


def curated_propeptides(entries: dict[str, dict[str, str]]) -> list[tuple[str, str]]:
    """``(accession, sequence)`` of each reviewed entry's N-terminal propeptide:
    a Propeptide feature that starts right after its Signal feature."""
    found = []
    for accession, entry in sorted(entries.items()):
        if entry.get("reviewed") != "reviewed":
            continue
        sequence = entry.get("sequence", "")
        signals = feature_regions(entry.get("ft_signal", ""), "SIGNAL")
        if not signals:
            continue
        after = max(e for _, e in signals) + 1
        for s, e in feature_regions(entry.get("ft_propep", ""), "PROPEP"):
            if s == after and e <= len(sequence):
                found.append((accession, sequence[s - 1 : e]))
    return found


def mismatches(a: str, b: str) -> int:
    """Positions where two equally long strings differ."""
    return sum(x != y for x, y in zip(a, b, strict=True))


def homologous_propeptide(
    sequence: str, curated: Sequence[tuple[str, str]], max_mismatches: int
) -> tuple[str, str] | None:
    """The curated propeptide (``(accession, sequence)``) that ``sequence``
    starts with, within ``max_mismatches``: the closest, then the first by
    accession. None when none is that close (or the rest would be empty)."""
    best = None
    for accession, propeptide in curated:
        head = sequence[: len(propeptide)]
        if len(head) < len(propeptide) or len(sequence) == len(propeptide):
            continue
        score = mismatches(head, propeptide)
        if score <= max_mismatches and (best is None or score < best[0]):
            best = (score, accession, propeptide)
    return (best[1], best[2]) if best else None


def mature_chains(
    entries: dict[str, dict[str, str]], ids: Sequence[str], options: dict | None = None
) -> list[MatureChain]:
    """:func:`mature_chain` of every id, cut by one rule for references and queries.

    ``options`` is the recipe's ``[mature]`` table. ``signal_motif`` (a regex)
    and ``motif_window`` reach :func:`mature_chain`. With
    ``propeptide_max_mismatches``, an unreviewed chain (whose Chain feature is
    SignalP's, so it keeps any propeptide) that starts with a propeptide a
    reviewed entry of the set has curated, within that many mismatches, loses
    it too: otherwise the colubrid queries keep the 15 residues their curated
    references were embedded without, and form an island of their own.
    """
    options = options or {}
    motif = options.get("signal_motif")
    pattern = re.compile(motif) if motif else None
    window = int(options.get("motif_window", 40))
    chains = [mature_chain(entries[pid], pattern, window) for pid in ids]
    limit = options.get("propeptide_max_mismatches")
    if limit is None:
        return chains
    curated = curated_propeptides({pid: entries[pid] for pid in ids})
    result = []
    for chain in chains:
        match = None
        if entries[chain.accession].get("reviewed") != "reviewed":
            match = homologous_propeptide(chain.sequence, curated, int(limit))
        if match is None:
            result.append(chain)
            continue
        accession, propeptide = match
        result.append(
            replace(
                chain,
                start=chain.start + len(propeptide),
                sequence=chain.sequence[len(propeptide) :],
                derivation=chain.derivation + HOMOLOGOUS_PROPEPTIDE,
                propeptide_from=accession,
            )
        )
    return result


_SIMILARITY_SPLIT = re.compile(r"SIMILARITY:\s*")
_EVIDENCE = re.compile(r"\{ECO:[^}]*\}")
_BELONGS = re.compile(r"^(?:In the [^;]*section;\s*)?belongs to the\s+", re.I)


def similarity_path(text: str, family: str) -> str | None:
    """The ``cc_similarity`` statement for ``family``, without evidence and the
    "Belongs to the" prefix: ``"three-finger toxin family. Short-chain
    subfamily. Type I alpha-neurotoxin sub-subfamily"``. None without one."""
    for part in _SIMILARITY_SPLIT.split(text or ""):
        part = _BELONGS.sub("", _EVIDENCE.sub("", part).strip()).strip()
        if part.lower().startswith(family.lower()):
            return part.rstrip(". ").strip()
    return None


def derive_label(path: str | None, rules: Sequence[Sequence[str]]) -> str:
    """The label of the first rule whose text occurs in the lower-cased path."""
    if not path:
        return ""
    text = path.lower()
    return next((label for needle, label in rules if needle.lower() in text), "")


def holdout_split(
    ids: Sequence[str],
    reviewed: dict[str, bool],
    strata: dict[str, str],
    *,
    fraction: float,
    seed: int,
    values: dict[str, str],
) -> dict[str, str]:
    """The split column: references, their held-out share, and the queries.

    Reviewed rows are references; ``fraction`` of those with a label is held
    out per label (``round(fraction · n)``). Unreviewed rows are the queries.
    Labels and ids are visited sorted and the draw uses one seeded generator,
    so the split depends on the seed alone (G4: iterating a set did not).
    """
    import numpy as np

    rng = np.random.default_rng(seed)
    split: dict[str, str] = {}
    by_label: dict[str, list[str]] = {}
    for pid in sorted(ids):
        if reviewed.get(pid):
            split[pid] = values["reference"]
            if strata.get(pid):
                by_label.setdefault(strata[pid], []).append(pid)
        else:
            split[pid] = values["query"]
    for label in sorted(by_label):
        members = by_label[label]
        count = int(round(fraction * len(members)))
        if count:
            for pid in rng.choice(members, size=count, replace=False):
                split[str(pid)] = values["holdout"]
    return split


def read_entries(path: Path) -> dict[str, dict[str, str]]:
    """``{accession: entry}`` from the TSV the ``entries`` step wrote."""
    with path.open(newline="") as handle:
        header = handle.readline().rstrip("\n").split("\t")
        entries = {}
        for line in handle:
            values = line.rstrip("\n").split("\t")
            values += [""] * (len(header) - len(values))
            entry = dict(zip(header, values, strict=True))
            entries[entry["accession"]] = entry
    return entries


def h5_vectors_sha256(path: Path) -> tuple[str, int]:
    """A digest of an H5's vectors (ids sorted, float32 bytes) and their count.

    Unlike the file's sha256 it does not depend on how HDF5 laid the file out,
    so it pins what the projections and the transfer read.
    """
    import h5py
    import numpy as np

    digest = hashlib.sha256()
    with h5py.File(path, "r") as handle:
        keys = sorted(handle.keys())
        for key in keys:
            digest.update(key.encode() + b"\0")
            digest.update(np.asarray(handle[key][()], dtype=np.float32).tobytes())
    return digest.hexdigest(), len(keys)


def entries_step(ctx: Context, out: Path) -> Step:
    """The pinned entries' full-length sequences, features and similarity text."""

    def action() -> None:
        ids = membership_ids(ctx)
        require_served_release(ctx, "entries")
        rows, releases = fetch_uniprot_entries(ids)
        by_id = {row["accession"]: row for row in rows}
        missing = [pid for pid in ids if pid not in by_id]
        if missing:
            raise BuildError(
                f"UniProt returned no entry for {len(missing)} pinned accessions "
                f"(first: {missing[:5]}); the membership file needs a new release"
            )
        out.parent.mkdir(parents=True, exist_ok=True)
        lines = ["\t".join(ENTRY_FIELDS)]
        lines += ["\t".join(by_id[pid].get(f, "") for f in ENTRY_FIELDS) for pid in ids]
        atomic_write_bytes(out, ("\n".join(lines) + "\n").encode())
        record_data_release(ctx, "entries", releases)
        reviewed = sum(1 for pid in ids if by_id[pid]["reviewed"] == "reviewed")
        ctx.log(f"entries: {len(ids)} ({reviewed} reviewed)")

    return Step(
        "entries",
        f"UniProt entries of the pinned membership → {out.name}",
        action,
        inputs=lambda: {
            "release": ctx.release,
            "fields": ENTRY_FIELDS,
            "membership": content_sha256(membership_path(ctx)),
        },
        fetches=True,
    )


def sequences_step(ctx: Context, entries_tsv: Path) -> Step:
    """Mature chains to embed, full-length sequences to annotate (G1, G8)."""
    mature_fasta = ctx.work / "mature.fasta"
    full_fasta = ctx.work / "full_length.fasta"
    mature_tsv = ctx.work / "mature.tsv"

    def action() -> None:
        entries = read_entries(entries_tsv)
        ids = membership_ids(ctx)
        chains = mature_chains(entries, ids, ctx.dataset.get("mature"))
        write_fasta(mature_fasta, {c.accession: c.sequence for c in chains}, ids)
        write_fasta(full_fasta, {pid: entries[pid]["sequence"] for pid in ids}, ids)
        lines = [
            "accession\treviewed\tfragment\tfull_length\tmature_start\tmature_end"
            "\tmature_length\tderivation\tpropeptide_from"
        ]
        for chain in chains:
            entry = entries[chain.accession]
            lines.append(
                "\t".join(
                    map(
                        str,
                        (
                            chain.accession,
                            entry["reviewed"],
                            "yes" if chain.fragment else "",
                            len(entry["sequence"]),
                            chain.start,
                            chain.end,
                            len(chain.sequence),
                            chain.derivation,
                            chain.propeptide_from,
                        ),
                    )
                )
            )
        atomic_write_bytes(mature_tsv, ("\n".join(lines) + "\n").encode())
        derivations = Counter(c.derivation for c in chains)
        ctx.record("mature:derivations", dict(derivations))
        ctx.log(f"mature chains: {dict(derivations)}")

    return Step(
        "sequences",
        "mature chains (embedded) and full-length sequences (annotated)",
        action,
        inputs=lambda: {
            "entries": fingerprint(entries_tsv),
            "membership": content_sha256(membership_path(ctx)),
            "mature": ctx.dataset.get("mature"),
        },
    )


def embed_step(ctx: Context) -> Step:
    """``protspace embed`` of the mature chains, or the pinned H5 when present.

    ``embed.input`` names a pinned copy of the embeddings (the Zenodo file); a
    rebuild that finds it uses its bytes instead of re-embedding, so the
    coordinates and transfers come out the same. The ``embeddings-pin`` gate
    checks the result against ``embed.sha256`` and ``embed.vectors_sha256``.
    """
    options = ctx.dataset.get("embed") or {}
    backend = options.get("backend", "local")
    fasta = ctx.work / "mature.fasta"
    out = embed_h5(ctx)
    args = [
        "embed",
        "-i",
        str(fasta),
        "-e",
        embed_model(ctx),
        "-o",
        str(out.parent),
        "--backend",
        backend,
        "-v",
    ]
    extras = ("local",) if backend == "local" else ()

    def action() -> None:
        pinned = ctx.path(options["input"]) if options.get("input") else None
        out.parent.mkdir(parents=True, exist_ok=True)
        if pinned is not None and pinned.is_file():
            ctx.log(f"embed: the pinned embeddings {pinned}")
            shutil.copyfile(pinned, out)
        else:
            # A left-over file would be resumed; start from nothing so the
            # vectors are this run's.
            out.unlink(missing_ok=True)
            ctx.need_cli().run(
                args,
                cwd=ctx.work,
                log=ctx.log,
                transcript=ctx.work / "logs" / "embed.log",
                extras=extras,
            )
        vectors, count = h5_vectors_sha256(out)
        ctx.record(
            "embeddings",
            {
                "file": out.name,
                "sha256": sha256_file(out),
                "vectors_sha256": vectors,
                "vectors": count,
                "backend": backend,
                "model": embed_model(ctx),
                "from_pinned_input": pinned is not None and pinned.is_file(),
            },
        )
        ctx.log(f"embed: {count} vectors, vectors_sha256 {vectors}")

    return Step(
        "embed",
        shlex.join(args),
        action,
        command=args,
        inputs=lambda: {
            "cli": ctx.cli_identity(),
            "fasta": fingerprint(fasta),
            "options": {k: options.get(k) for k in ("model", "backend", "input")},
            "pinned": fingerprint(ctx.path(options["input"]))
            if options.get("input")
            else None,
        },
        extras=extras,
    )


def label_table(
    ids: Sequence[str],
    entries: dict[str, dict[str, str]],
    labels: dict,
    holdout: dict,
) -> tuple[dict[str, list], dict[str, Any]]:
    """The derived label columns, the split and the withheld truth, by row.

    Each ``labels.columns`` entry derives one column from the entry's
    ``cc_similarity`` statement for ``labels.family``. Unreviewed entries only
    carry UniProt's automatic rule labels, so their value moves to
    ``<column>_uniprot_rule`` (for the columns in ``labels.keep_rule_labels``)
    and the column is left empty: they are the transfer's queries. The
    hold-out blanks its rows too and keeps their truth in ``<column>_withheld``.
    """
    family = labels["family"]
    reviewed = {pid: entries[pid]["reviewed"] == "reviewed" for pid in ids}
    paths = {pid: similarity_path(entries[pid]["cc_similarity"], family) for pid in ids}
    derived = {
        spec["name"]: {pid: derive_label(paths[pid], spec["rules"]) for pid in ids}
        for spec in labels["columns"]
    }
    values = holdout_values(holdout)
    split = holdout_split(
        ids,
        reviewed,
        derived[holdout["stratify"]],
        fraction=holdout["fraction"],
        seed=holdout["seed"],
        values=values,
    )
    columns: dict[str, list] = {}
    blanked = set(holdout.get("columns", list(derived)))
    for name, by_id in derived.items():
        shown = []
        for pid in ids:
            keep = reviewed[pid] and not (
                split[pid] == values["holdout"] and name in blanked
            )
            shown.append(by_id[pid] if keep and by_id[pid] else None)
        columns[name] = shown
    for name in labels.get("keep_rule_labels", []):
        columns[f"{name}_uniprot_rule"] = [
            (derived[name][pid] or None) if not reviewed[pid] else None for pid in ids
        ]
    for name in derived:
        if name in blanked:
            columns[f"{name}_withheld"] = [
                (derived[name][pid] or None)
                if split[pid] == values["holdout"]
                else None
                for pid in ids
            ]
    columns[holdout["split_column"]] = [split[pid] for pid in ids]
    summary = {
        "split": dict(Counter(split.values())),
        "reviewed_without_label": {
            name: sorted(pid for pid in ids if reviewed[pid] and not by_id[pid])
            for name, by_id in derived.items()
        },
        "reviewed_labels": {
            name: dict(
                Counter(by_id[pid] for pid in ids if reviewed[pid] and by_id[pid])
            )
            for name, by_id in derived.items()
        },
        "uniprot_rule_labels": {
            name: dict(
                Counter(
                    derived[name][pid]
                    for pid in ids
                    if not reviewed[pid] and derived[name][pid]
                )
            )
            for name in labels.get("keep_rule_labels", [])
        },
        "holdout": {
            "fraction": holdout["fraction"],
            "seed": holdout["seed"],
            "stratify": holdout["stratify"],
            "per_label": dict(
                Counter(
                    derived[holdout["stratify"]][pid]
                    for pid in ids
                    if split[pid] == values["holdout"]
                )
            ),
        },
    }
    return columns, summary


def embed_build_steps(ctx: Context) -> list[Step]:
    """three-finger-toxins: pinned membership, mature-chain embeddings made here,
    the build's own projections, derived labels, a hold-out and EAT."""
    entries_tsv = ctx.work / "entries.tsv"
    mature_tsv = ctx.work / "mature.tsv"
    full_fasta = ctx.work / "full_length.fasta"
    ann_bundle = ctx.work / "ann" / "data.parquetbundle"
    assembled = ctx.work / "annotations.assembled.parquet"
    steps = [
        entries_step(ctx, entries_tsv),
        sequences_step(ctx, entries_tsv),
        embed_step(ctx),
        *prepare_steps(ctx),
    ]
    labels = ctx.dataset["labels"]
    holdout = ctx.dataset["holdout"]

    def assemble() -> None:
        ids = membership_ids(ctx)
        fetched = extract_ann(ann_bundle)
        table, absent = align_rows(fetched, ids)
        entries = read_entries(entries_tsv)
        columns, summary = label_table(ids, entries, labels, holdout)
        with mature_tsv.open() as handle:
            header = handle.readline().rstrip("\n").split("\t")
            mature = {
                row[0]: dict(zip(header, row, strict=True))
                for row in (line.rstrip("\n").split("\t") for line in handle)
            }
        columns["mature_length"] = [int(mature[pid]["mature_length"]) for pid in ids]
        origin = {c: "refreshed" for c in table.column_names if c != ID_COLUMN}
        for name, values in columns.items():
            if name in table.column_names:
                raise BuildError(f"derived column {name!r} clashes with a fetched one")
            array = pa.array(
                values, type=pa.int64() if name == "mature_length" else pa.string()
            )
            table = table.append_column(name, array)
            if name.endswith("_withheld"):
                origin[name] = "withheld-truth"
            elif name == holdout["split_column"]:
                origin[name] = "computed"
            else:
                origin[name] = "refreshed"
        queries = [v for k, v in holdout_values(holdout).items() if k != "reference"]
        blanked = holdout.get("columns", [c["name"] for c in labels["columns"]])
        assert_no_refill(table, holdout["split_column"], queries, blanked)
        # G8 evidence, as for the demo: InterPro and Biocentral read these.
        lengths = {
            a: len(s) for a, s in parse_fasta_text(full_fasta.read_text()).items()
        }
        uniprot = (
            dict(zip(ids, table.column("length").to_pylist(), strict=True))
            if "length" in table.column_names
            else {}
        )
        equal = sum(1 for a, n in lengths.items() if as_int(uniprot.get(a)) == n)
        derivations = Counter(m["derivation"] for m in mature.values())
        # The derived labels as a file of their own (the Zenodo deposit's
        # label CSV; `protspace prepare -a labels.csv` reads the same shape).
        derived_names = [n for n in columns if n != "mature_length"]
        with (ctx.work / "labels.csv").open("w", newline="") as handle:
            writer = csv.writer(handle)
            writer.writerow(["identifier", *derived_names])
            for row, pid in enumerate(ids):
                writer.writerow([pid, *(columns[n][row] or "" for n in derived_names)])
        write_annotations(
            ctx,
            table,
            {
                "rows": table.num_rows,
                "rows_without_annotations": absent,
                "origin": origin,
                "fresh_rows_without_entry": obsolete_rows(table),
                "full_length": {
                    "sequences": len(lengths),
                    "length_matches_uniprot": equal,
                },
                "mature": {
                    "derivations": dict(derivations),
                    "fragments": sum(1 for m in mature.values() if m["fragment"]),
                    "homologous_propeptides": sum(
                        1 for m in mature.values() if m.get("propeptide_from")
                    ),
                },
                "labels": summary,
            },
            name=assembled.name,
        )

    steps.append(
        assemble_step(
            ctx,
            "prepare output + derived labels + the hold-out split",
            assemble,
            [ann_bundle, entries_tsv, mature_tsv, full_fasta],
        )
    )
    steps.append(projections_step(ctx, drop_quality=True))
    steps += transfer_steps(ctx, assembled)
    return steps


def holdout_values(holdout: dict) -> dict[str, str]:
    return {
        "reference": "reference",
        "holdout": "holdout",
        "query": "trembl",
        **holdout.get("values", {}),
    }


def transfer_steps(ctx: Context, assembled: Path) -> list[Step]:
    """EAT with ``protspace transfer`` (it reads a bundle), then its annotations
    become ``work/annotations.parquet`` for the statistics and the final bundle.
    """
    options = ctx.dataset["transfer"]
    pre = ctx.work / "pre_transfer.parquetbundle"
    post = ctx.work / "transferred.parquetbundle"
    bundle_args = [
        "bundle",
        "-p",
        str(ctx.work / "proj"),
        "-a",
        str(assembled),
        "-o",
        str(pre),
        "-v",
    ]
    transfer_args = ["transfer", "-b", str(pre), "-e", dataset_embeddings(ctx)[0]]
    for column in options["columns"]:
        transfer_args += ["-t", column]
    transfer_args += [
        "--k",
        str(options.get("k", 1)),
        "--metric",
        options.get("metric", "euclidean"),
    ]
    for clause in options.get("query_where", []):
        transfer_args += ["--query-where", clause]
    for clause in options.get("reference_where", []):
        transfer_args += ["--reference-where", clause]
    transfer_args += ["-o", str(post), "-v"]
    holdout = ctx.dataset["holdout"]

    def bundle() -> None:
        ctx.need_cli().run(bundle_args, cwd=ctx.work, log=ctx.log)

    def transfer() -> None:
        ctx.need_cli().run(transfer_args, cwd=ctx.work, log=ctx.log)
        table = extract_ann(post)
        queries = [v for k, v in holdout_values(holdout).items() if k != "reference"]
        # The transfer writes __pred_ columns only; the labels stay withheld.
        assert_no_refill(table, holdout["split_column"], queries, options["columns"])
        missing = [
            c
            for c in options["columns"]
            if f"{c}{PRED_MARKER}value" not in table.column_names
        ]
        if missing:
            raise BuildError(f"protspace transfer wrote no predictions for {missing}")
        atomic_write_bytes(
            ctx.work / "annotations.parquet",
            parquet_bytes(stamp_format_version(strip_pandas_metadata(table))),
        )

    return [
        Step(
            "pre-transfer",
            shlex.join(bundle_args),
            bundle,
            command=bundle_args,
            inputs=lambda: {
                "cli": ctx.cli_identity(),
                "annotations": fingerprint(assembled),
                "projections": fingerprint(ctx.work / "proj"),
            },
        ),
        Step(
            "transfer",
            shlex.join(transfer_args),
            transfer,
            command=transfer_args,
            inputs=lambda: {
                "cli": ctx.cli_identity(),
                "bundle": fingerprint(pre),
                "embeddings": fingerprint(embed_h5(ctx)),
                "transfer": options,
                "holdout": holdout,
            },
        ),
    ]


def demo_refresh_steps(ctx: Context) -> list[Step]:
    """The startup demo: its four projections kept, every annotation refreshed
    from full-length sequences, the mature-peptide length kept."""
    steps, fasta, fresh = annotate_source_steps(ctx)
    keep = list(ctx.dataset.get("keep_source_columns", []))

    def assemble() -> None:
        # Migrated before normalize_id, which would drop a renamed table's stamp.
        source = normalize_id(
            migrate_legacy_annotation_table(read_bundle(find_source(ctx)).annotations)
        )
        ids = row_ids(source)
        fetched = drop_columns(normalize_id(pq.read_table(fresh)), INTERNAL_ANNOTATIONS)
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
    cluster legends are merged in afterwards, untouched. ``bundle`` and ``style``
    write whatever container the CLI checkout writes (v2 before protspace 4.16);
    ``finalize`` writes the shipped file as v3 with this repository's protspace
    (:func:`rebuild_bundle`).
    """
    work = ctx.work
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
        if with_stats:
            if not stats_list:
                raise BuildError("stats need an explicit stats_annotations list (G12)")
            ctx.need_cli().run(stats_args, cwd=work, log=ctx.log)

    def stats_inputs() -> dict[str, Any]:
        return {
            "recipe": ctx.recipe(STATS_KEYS),
            "cli": ctx.cli_identity() if with_stats else None,
            "annotations": fingerprint(work / "annotations.parquet"),
            "projections": fingerprint(work / "proj"),
            "embeddings": [
                fingerprint(split_h5_spec(s)[0]) for s in dataset_embeddings(ctx)
            ],
        }

    if with_stats:
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
        steps.append(Step("stats", "no statistics", stats, inputs=stats_inputs))

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
        if format_version(table) != BUNDLE_FORMAT_VERSION:
            raise BuildError("the bundled annotations lost their cell-grammar v2 stamp")
        legends, notes = carried_legends(ctx, table)
        legends.update(bundle_.settings or {})  # the styled legends win
        envelope = ctx.dataset.get("envelope")
        # The frontend's envelope when EAT display settings apply, else flat.
        settings = (
            rewrap_settings(
                legends, {LEGEND_SETTINGS_KEY: {}, "exportOptions": {}, **envelope}
            )
            if envelope
            else legends or None
        )
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
            # The container rebuild_bundle writes (protspace's writer, not the
            # CLI's): a format change re-runs this step.
            "container": CONTAINER_VERSION,
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
            f"legends + provenance, v{CONTAINER_VERSION} container → "
            f"{ctx.file_name}{cut_note}",
            finalize,
            inputs=finalize_inputs,
        )
    )
    return steps


def carried_legends(ctx: Context, table: pa.Table) -> tuple[dict, list[str]]:
    """Cluster legends from ``stats`` plus the legends ``source_legends`` names,
    carried over from the source bundle."""
    legends: dict = {}
    notes: list[str] = []
    wanted = ctx.dataset.get("source_legends")
    if wanted:
        source_settings = read_bundle(find_source(ctx)).settings or {}
        for column, entry in unwrap_settings(source_settings).items():
            if column in wanted and column in table.column_names:
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
        **(eat_provenance(ctx, table) if is_embed_build(ctx) else {}),
    }


def eat_provenance(ctx: Context, table: pa.Table) -> dict[str, Any]:
    """How an ``embed-build`` held out and transferred, and where its vectors
    came from, so the card can state the seed, the metric and the split."""
    holdout = ctx.dataset.get("holdout") or {}
    transfer = ctx.dataset.get("transfer") or {}
    embeddings = ctx.facts().get("embeddings") or {}
    record: dict[str, Any] = {}
    if holdout:
        column = holdout["split_column"]
        value = holdout_values(holdout)["holdout"]
        ids = held_out_ids(table, column, value) if column in table.column_names else []
        record["holdout"] = {
            "split_column": column,
            "stratify": holdout.get("stratify"),
            "fraction": holdout.get("fraction"),
            "seed": holdout.get("seed"),
            "held_out": len(ids),
            "split_sha256": holdout_ids_sha256(ids),
        }
    if transfer:
        record["transfer"] = {
            k: transfer.get(k) for k in ("columns", "k", "metric") if k in transfer
        }
    if embeddings:
        record["embeddings"] = {
            "model": embeddings.get("model"),
            "backend": embeddings.get("backend"),
            "source": "the pinned embed.input file"
            if embeddings.get("from_pinned_input")
            else "embedded in this build",
            "vectors": embeddings.get("vectors"),
            "vectors_sha256": embeddings.get("vectors_sha256"),
        }
    return record


def pipeline_commands(ctx: Context) -> list[str]:
    """The CLI commands of this build, machine paths replaced by placeholders."""
    replacements = [
        (str(ctx.work), "$WORK"),
        (ctx.config.expand("{nm_data}"), "$NM_DATA"),
        (ctx.config.expand("{cli_data}"), "$CLI_DATA"),
        (str(REPO_ROOT), "$REPO"),
        (str(Path.home()), "~"),
    ]
    pinned_input = bool((ctx.facts().get("embeddings") or {}).get("from_pinned_input"))
    commands = []
    for step in recipe_steps(ctx):
        if not step.command:
            continue
        text = "protspace " + shlex.join(step.command)
        for old, new in replacements:
            if old and "{" not in old:
                text = text.replace(old, new)
        if step.name == "embed" and pinned_input:
            # Not run: the build copied the pinned file this command once made.
            text += "  # not run here: the vectors are the pinned embed.input file"
        commands.append(text)
    return commands


def recipe_steps(ctx: Context) -> list[Step]:
    kind = ctx.dataset["kind"]
    if kind == "paper-refresh":
        body = paper_refresh_steps(ctx)
    elif kind == "embed-build":
        body = embed_build_steps(ctx)
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
    gates = common_gates(bundle, ctx.dataset, ctx.view)
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
    atomic_write_bytes(
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


def embeddings_pin_gate(ctx: Context) -> Gate:
    """The embeddings an ``embed-build`` made are the pinned ones.

    ``embed.vectors_sha256`` pins what the projections and the transfer read;
    ``embed.sha256`` pins the file that goes to Zenodo. Other vectors fail (a
    rebuild on other hardware: point ``embed.input`` at the pinned file); the
    same vectors in another file layout only warn. Unpinned is pending.
    """
    options = ctx.dataset.get("embed") or {}
    h5 = embed_h5(ctx)
    if not h5.is_file():
        return Gate("embeddings-pin", "fail", f"{h5.name} was not built")
    vectors, count = h5_vectors_sha256(h5)
    file_sha = sha256_file(h5)
    data = {"vectors_sha256": vectors, "sha256": file_sha, "vectors": count}
    pinned = options.get("vectors_sha256")
    if not pinned:
        return Gate(
            "embeddings-pin",
            "pending",
            f"pin the embeddings in showcase.toml: embed.vectors_sha256 = "
            f"{vectors!r}, embed.sha256 = {file_sha!r}",
            data,
        )
    if vectors != pinned:
        return Gate(
            "embeddings-pin",
            "fail",
            f"{count} vectors differ from the pin ({vectors[:12]}… vs {pinned[:12]}…); "
            "rebuild from the pinned file with embed.input",
            data,
        )
    if options.get("sha256") and file_sha != options["sha256"]:
        return Gate(
            "embeddings-pin", "warn", "the pinned vectors in another file layout", data
        )
    return Gate("embeddings-pin", "pass", f"{count} vectors as pinned", data)


def membership_gate(ctx: Context, table: pa.Table) -> Gate:
    """The rows are exactly the pinned accession list, in its order."""
    try:
        pinned = membership_ids(ctx)
    except BuildError as error:
        return Gate("membership-pinned", "fail", str(error))
    ids = row_ids(table)
    differ = set(ids) ^ set(pinned)
    ok = ids == pinned
    return Gate(
        "membership-pinned",
        "pass" if ok else "fail",
        f"{len(ids)} rows; {len(differ)} ids differ from {membership_path(ctx).name}"
        + ("" if ok or differ else "; the order differs"),
    )


def name_agreement_gate(ctx: Context, table: pa.Table, params: dict) -> Gate:
    """:func:`gate_name_agreement` on UniProt's full "Protein names" of each
    entry (``names_from = "entries"``: the ``entries`` step's TSV), which carry
    the TrEMBL submission names the bundle's ``protein_name`` lacks."""
    names = None
    if params.get("names_from") == "entries":
        path = ctx.work / "entries.tsv"
        if not path.is_file():
            return Gate(f"name-agreement:{params['column']}", "fail", "no entries.tsv")
        entries = read_entries(path)
        names = [entries.get(pid, {}).get("protein_name") for pid in row_ids(table)]
    return gate_name_agreement(table, params, names)


def _text(value: Any) -> str:
    """An HDF5 string attribute as text (h5py may hand back bytes)."""
    return value.decode() if isinstance(value, bytes) else str(value)


def _signal_flag(value: Any) -> bool:
    """A ``predicted_signal_peptide`` cell that predicts one (``True``/``yes``)."""
    return any(label.lower() in ("true", "yes") for label in cell_labels(value))


def mature_inputs_gate(
    ctx: Context, params: dict, table: pa.Table | None = None
) -> Gate:
    """Every row was embedded as its mature chain, by one rule for references
    and queries (G1), including the reviewed entries only the family clause
    brings in (G7).

    Reads the build's ``entries.tsv``, ``mature.tsv``, ``mature.fasta`` and the
    H5, and checks what :func:`mature_chains` promises without calling it:

    - each pinned accession has a vector, embedded from exactly
      ``sequence[start-1:end]`` of its entry, and the vector's
      ``protspace_sequence_sha256`` (which ``protspace embed`` stores) is that
      sequence's: so a pinned ``embed.input`` must have been made from these
      chains too;
    - no row used as deposited is predicted to carry a signal peptide
      (``predicted_signal_peptide`` of the bundle, from the full-length
      sequence) or holds the recipe's ``signal_motif`` in its first
      ``motif_window`` residues;
    - no unreviewed row still starts with a propeptide a reviewed entry of the
      set has curated (within ``propeptide_max_mismatches``, default the
      recipe's), which its references were embedded without.

    ``family_only_xref`` names the InterPro entry the query's first clause
    matches; the reviewed entries without it must number
    ``expected_family_only`` and all be embedded.
    """
    import h5py

    work = ctx.work
    options = ctx.dataset.get("mature") or {}
    try:
        pinned = membership_ids(ctx)
        entries = read_entries(work / "entries.tsv")
        with (work / "mature.tsv").open() as handle:
            header = handle.readline().rstrip("\n").split("\t")
            mature = {
                row[0]: dict(zip(header, row, strict=True))
                for row in (line.rstrip("\n").split("\t") for line in handle)
            }
        embedded = parse_fasta_text((work / "mature.fasta").read_text())
        with h5py.File(embed_h5(ctx), "r") as handle:
            keys = set(handle.keys())
            digests = {
                key: handle[key].attrs.get("protspace_sequence_sha256") for key in keys
            }
    except (BuildError, OSError, KeyError) as error:
        return Gate("mature-inputs", "fail", f"cannot check: {error}")
    problems = []
    no_vector = [pid for pid in pinned if pid not in keys]
    if no_vector:
        problems.append(f"{len(no_vector)} without a vector (first {no_vector[:3]})")

    def expected(pid: str) -> str | None:
        row = mature.get(pid)
        if row is None or pid not in entries:
            return None
        start, end = int(row["mature_start"]), int(row["mature_end"])
        return entries[pid]["sequence"][start - 1 : end]

    wrong = [
        pid
        for pid in pinned
        if expected(pid) is None or embedded.get(pid) != expected(pid)
    ]
    if wrong:
        problems.append(
            f"{len(wrong)} not embedded as the recorded mature chain (first {wrong[:3]})"
        )
    other_residues = [
        pid
        for pid in pinned
        if pid in keys
        and _text(digests.get(pid))
        != hashlib.sha256(embedded.get(pid, "").encode()).hexdigest()[:16]
    ]
    if other_residues:
        problems.append(
            f"{len(other_residues)} vectors not computed from the embedded chain "
            f"(protspace_sequence_sha256; first {other_residues[:3]})"
        )
    as_deposited = [
        pid for pid in pinned if mature.get(pid, {}).get("derivation") == "as deposited"
    ]
    flagged = []
    if table is not None and "predicted_signal_peptide" in table.column_names:
        predicted = dict(
            zip(
                row_ids(table),
                table.column("predicted_signal_peptide").to_pylist(),
                strict=True,
            )
        )
        flagged = [pid for pid in as_deposited if _signal_flag(predicted.get(pid))]
        if flagged:
            problems.append(
                f"{len(flagged)} used as deposited but predicted to carry a signal "
                f"peptide (first {flagged[:3]})"
            )
    motif = options.get("signal_motif")
    if motif:
        pattern = re.compile(motif)
        window = int(options.get("motif_window", 40))
        with_motif = [
            pid
            for pid in as_deposited
            if pattern.search(entries[pid]["sequence"][:window])
        ]
        if with_motif:
            problems.append(
                f"{len(with_motif)} used as deposited with the signal motif in "
                f"their first {window} residues (first {with_motif[:3]})"
            )
    limit = params.get(
        "propeptide_max_mismatches", options.get("propeptide_max_mismatches")
    )
    kept_propeptide = []
    if limit is not None:
        curated = curated_propeptides({pid: entries[pid] for pid in pinned})
        kept_propeptide = [
            pid
            for pid in pinned
            if entries[pid]["reviewed"] != "reviewed"
            and homologous_propeptide(embedded.get(pid, ""), curated, int(limit))
        ]
        if kept_propeptide:
            problems.append(
                f"{len(kept_propeptide)} unreviewed rows embedded with a curated "
                f"propeptide their references lack (first {kept_propeptide[:3]})"
            )
    data: dict[str, Any] = {
        "derivations": dict(Counter(m["derivation"] for m in mature.values())),
        "homologous_propeptides": sum(
            1 for m in mature.values() if m.get("propeptide_from")
        ),
        "as_deposited_predicted_signal": len(flagged),
        "embedded_equals_full_length": sum(
            1
            for pid in pinned
            if pid in mature
            and int(mature[pid]["mature_length"]) == int(mature[pid]["full_length"])
        ),
    }
    xref = params.get("family_only_xref")
    if xref:
        family_only = [
            pid
            for pid in pinned
            if entries[pid]["reviewed"] == "reviewed"
            and xref not in entries[pid]["xref_interpro"]
        ]
        data["family_only"] = len(family_only)
        data["family_only_derivations"] = dict(
            Counter(mature[pid]["derivation"] for pid in family_only if pid in mature)
        )
        expected_family_only = params.get("expected_family_only")
        if (
            expected_family_only is not None
            and len(family_only) != expected_family_only
        ):
            problems.append(
                f"{len(family_only)} reviewed entries without {xref}, "
                f"expected {expected_family_only}"
            )
        missing = [pid for pid in family_only if pid not in keys]
        if missing:
            problems.append(f"{len(missing)} family-only entries without a vector")
    detail = "; ".join(problems) or (
        f"{len(pinned)} mature chains embedded ({data['derivations']}); "
        "every vector computed from its chain"
        + (
            f"; {data['family_only']} family-only reviewed entries included"
            if xref
            else ""
        )
    )
    return Gate("mature-inputs", "fail" if problems else "pass", detail, data)


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
        same = coordinate_map(expected) == coordinate_map(bundle.projections)
        source = "the build's own projections" if is_embed_build(ctx) else "paper"
        gates.append(
            Gate(
                "coordinates",
                "pass" if same else "fail",
                f"{source} coordinates unchanged" if same else "differ from the source",
            )
        )
    except BuildError as error:
        gates.append(Gate("coordinates", "fail", str(error)))

    if is_embed_build(ctx):
        gates.append(membership_gate(ctx, bundle.annotations))
        gates.append(embeddings_pin_gate(ctx))

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
        elif kind == "mature_inputs":
            gates.append(mature_inputs_gate(ctx, spec, bundle.annotations))
        elif kind == "name_agreement":
            gates.append(name_agreement_gate(ctx, bundle.annotations, spec))
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
    atomic_write_bytes(d2_measurement_path(ctx), json.dumps(record, indent=1).encode())
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
    pattern = config.build.get("file_pattern", DEFAULT_FILE_PATTERN)
    return out_root / ds_id / pattern.format(id=ds_id, release=release)


def published_name_conflicts(
    previous: dict | None, tag: str | None, files: dict[str, Path]
) -> list[str]:
    """Built release files that would put new bytes under a name ``tag`` publishes.

    ``previous`` is the committed manifest. A release file name never carries
    different bytes: the published asset stays as uploaded, and a deploy, a
    cache or a Zenodo copy would disagree with the new file. A rebuilt file
    therefore needs a new name (``[build] file_pattern``, as the v3 files got
    ``_v3``), and a file staged again with its published bytes is fine.
    """
    if not previous or not tag:
        return []
    published: dict[str, str] = {}
    if previous.get("release") == tag:
        published.update(
            (record["file"], record["sha256"])
            for record in previous.get("examples", {}).values()
            if record.get("hosting") == "release"
        )
    published.update(
        (entry["file"], entry["sha256"])
        for entry in previous.get("retained", [])
        if entry.get("release") == tag
    )
    return [
        f"{ds_id}: {path.name} is already published in {tag} with other bytes; "
        "give the new file a new name ([build] file_pattern)"
        for ds_id, path in files.items()
        if path.name in published and published[path.name] != sha256_file(path)
    ]


def live_release(repo: str, tag: str) -> dict | None:
    """The release ``tag`` as GitHub serves it: its ``assets`` and notes (``body``).

    ``{}`` when ``repo`` has no such release; None when ``gh`` cannot tell (not
    installed, offline, not logged in). Read-only (``gh release view``).
    """
    try:
        result = subprocess.run(
            ["gh", "release", "view", tag, "--repo", repo, "--json", "assets,body"],
            capture_output=True,
            text=True,
            timeout=60,
            check=False,
        )
    except (OSError, subprocess.TimeoutExpired):
        return None
    if result.returncode != 0:
        return {} if "release not found" in result.stderr else None
    try:
        return json.loads(result.stdout)
    except json.JSONDecodeError:
        return None


def live_asset_conflicts(
    live: dict | None, tag: str | None, staged: dict[str, str]
) -> tuple[list[str], set[str]]:
    """Check the files to upload (name → sha256) against the assets ``tag`` holds.

    The committed manifest names only the files it serves, so a name it no
    longer lists (the v2 files once the manifest is re-pinned to the v3 ones)
    is known only to the release, which records each asset's sha256 as its
    ``digest``. Returns the conflicts, a name the release holds with other bytes
    or with no digest to compare, and the names it already holds with exactly
    these bytes, which need no upload.
    """
    if not live or not tag:
        return [], set()
    held = {asset["name"]: asset.get("digest") for asset in live.get("assets", [])}
    conflicts: list[str] = []
    uploaded: set[str] = set()
    for name, digest in staged.items():
        if name not in held:
            continue
        if held[name] == f"sha256:{digest}":
            uploaded.add(name)
        elif held[name]:
            conflicts.append(
                f"{name} is already an asset of {tag} with other bytes; give the "
                "new file a new name ([build] file_pattern, [build] checksums_file)"
            )
        else:
            conflicts.append(
                f"{name} is already an asset of {tag}, and GitHub reports no "
                "digest to compare its bytes with; give the new file a new name"
            )
    return conflicts, uploaded


def stage_release(
    config: Config,
    out_root: Path,
    release: str,
    staging: Path,
    ids: Sequence[str] | None = None,
    *,
    force: bool = False,
    previous_manifest: Path = EXAMPLE_MANIFEST,
    live: dict | None = None,
) -> dict:
    """Stage the showcase files and the example manifest; print the owner's steps.

    Every file must be built and must have passed ``verify`` on exactly its
    bytes (:func:`release_readiness`); ``force`` stages it anyway, with a
    warning. The manifest is written by ``write_manifest.py`` from the staged
    files, with the committed manifest as the previous one (retained files,
    Zenodo DOIs), so it is the module the web app, the docs page and
    ``pnpm examples:fetch`` read. A release file whose name the committed
    manifest already publishes in this release with other bytes is refused, even
    with ``force`` (:func:`published_name_conflicts`), and so is one whose name
    the release itself holds with other bytes (``live``, :func:`live_release`;
    None when GitHub could not be asked, :func:`live_asset_conflicts`). For a
    published release, ``RELEASE_NOTES.md`` is its notes with the added files
    appended. Returns the manifest.
    """
    writer = manifest_writer()
    ids = list(ids or config.datasets)
    tag = config.build.get("release_tag")
    previous = (
        writer.parse_manifest(previous_manifest.read_text())
        if previous_manifest.is_file()
        else None
    )
    release_files = {
        ds_id: built_file(config, out_root, ds_id, release)
        for ds_id in ids
        if config.datasets[ds_id].get("hosting") != "repo"
    }
    conflicts = published_name_conflicts(
        previous,
        tag,
        {ds_id: path for ds_id, path in release_files.items() if path.is_file()},
    )
    # The committed manifest already names this release, or GitHub has it: it
    # is published, so the new files are uploaded into it, next to its files.
    published = (bool(previous) and previous.get("release") == tag) or bool(live)
    sums_name = config.build.get("checksums_file", "SHA256SUMS")
    if published and release_files and sums_name == "SHA256SUMS":
        conflicts.append(
            f"{tag} is published and holds its SHA256SUMS; set [build] "
            "checksums_file to a new name for the added files' checksums"
        )
    release_digests = {
        path.name: sha256_file(path)
        for path in release_files.values()
        if path.is_file()
    }
    sums = "".join(f"{digest}  {name}\n" for name, digest in release_digests.items())
    live_conflicts, already_uploaded = live_asset_conflicts(
        live,
        tag,
        {**release_digests, sums_name: hashlib.sha256(sums.encode()).hexdigest()}
        if release_digests
        else {},
    )
    conflicts.extend(live_conflicts)
    if conflicts:
        raise BuildError("refusing to stage:\n  " + "\n  ".join(conflicts))
    if release_digests and tag and live is None:
        print(
            f"WARNING: could not read {tag} from GitHub (gh release view): only "
            "the names the committed manifest publishes were checked"
        )
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

    (staging / sums_name).write_text(sums)
    lines: dict[str, str] = {}
    for ds_id, record in manifest["examples"].items():
        annotations = ", ".join(
            f"{g} {r}" for g, r in record["releases"]["annotations"].items()
        )
        lines[ds_id] = (
            f"- `{record['file']}` ({ds_id}, {record['hosting']}): "
            f"{record['proteins']:,} proteins, {record['bytes'] / 1e6:.1f} MB; "
            f"UniProt {annotations or 'n/a'}"
        )
    body = (live or {}).get("body", "").rstrip()
    added = [
        lines[ds_id]
        for ds_id, _ in assets
        if f"`{manifest['examples'][ds_id]['file']}`" not in body
    ]
    if not published:
        notes = ["Curated example datasets for protspace.app.", "", *lines.values()]
    else:
        # The release keeps its files and its notes: the added files are
        # appended to the published text, which `gh release upload` leaves as is.
        notes = [body, ""] if body else []
        if added:
            notes += [f"Added to this release (checksums in `{sums_name}`):", ""]
        notes += added
    (staging / "RELEASE_NOTES.md").write_text("\n".join(notes).rstrip() + "\n")

    print(f"Staged {len(repo) + len(assets)} bundles and the manifest in {staging}")
    print("\nThe repository owner publishes them with (not run by this script):\n")
    if assets:
        files = " ".join(
            shlex.quote(str(p))
            for p in [*(p for _, p in assets), staging / sums_name]
            if p.name not in already_uploaded
        )
        repo_name = config.build.get("github_repo", GITHUB_REPO)
        if published:
            # No --clobber: a name the release already holds must fail, not
            # take new bytes.
            notes_file = shlex.quote(str(staging / "RELEASE_NOTES.md"))
            if files:
                print(
                    f"# {tag} is published; add the new files to it:\n"
                    f"gh release upload {tag} --repo {repo_name} {files}"
                )
            else:
                print(f"# {tag} already holds every staged file with these bytes")
            if added and body:
                print(
                    "# then list them in its notes (RELEASE_NOTES.md is the "
                    "published text with the added files appended):\n"
                    f"gh release edit {tag} --repo {repo_name} --notes-file {notes_file}"
                )
            elif added:
                print(f"# then add RELEASE_NOTES.md's lines to {tag}'s notes by hand")
        else:
            print(
                # --latest=false: a data release must not become the repository's
                # "Latest" release, which names the newest ProtSpace version (W33).
                f"gh release create {tag} --repo {repo_name} --latest=false "
                f"--title {shlex.quote(f'Showcase datasets ({release})')} "
                f"--notes-file {shlex.quote(str(staging / 'RELEASE_NOTES.md'))} "
                f"{files}"
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
        f"gh release create {release} --repo {GITHUB_REPO} --latest=false "
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


#: Options whose value is a machine path, and the placeholder the provenance
#: shows instead (W12: a scratch --cli-root was printed on every docs card).
PATH_OPTIONS = {
    "--cli-root": "$CLI",
    "--out-root": "$OUT",
    "--staging": "$STAGING",
    "--config": "$CONFIG",
    "--out": "$OUT",
    "--nm-dir": "$NM_DIR",
}


def build_command(argv: Sequence[str]) -> str:
    """This invocation, for provenance, with machine paths replaced.

    Path options become placeholders (``--cli-root $CLI``), a ``--path
    NAME=VALUE`` override (or ``--path=NAME=VALUE``) keeps only its name, and
    any other path left is shortened to ``$REPO`` / ``~``, then by the manifest
    writer's own redaction (scratch paths ``$TMP``, home directories ``~``).
    The parsers refuse abbreviated options (``allow_abbrev=False``), so only
    the spellings listed here can carry a path.
    """
    args = list(argv)
    words: list[str] = ["build_showcase.py"]  # already shell-quoted
    index = 0
    while index < len(args):
        arg = args[index]
        option, sep, value = arg.partition("=")
        if option in PATH_OPTIONS:
            placeholder = PATH_OPTIONS[option]
            if sep:
                words.append(f"{option}={placeholder}")
            else:
                words.append(option)
                if index + 1 < len(args):
                    words.append(placeholder)
                    index += 1
        elif option == "--path" and (sep or index + 1 < len(args)):
            if not sep:
                index += 1
                value = args[index]
            name = value.split("=", 1)[0]
            override = f"{shlex.quote(name)}=${name.upper()}"
            words += [f"--path={override}"] if sep else ["--path", override]
        else:
            words.append(shlex.quote(arg))
        index += 1
    text = " ".join(words)
    for old, new in ((str(REPO_ROOT), "$REPO"), (str(Path.home()), "~")):
        text = text.replace(old, new)
    return manifest_writer().redact_command(text)


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
    tag = config.build.get("release_tag")
    stage_release(
        config,
        args.out_root,
        args.release,
        staging,
        selected_ids(args, config, default_all=True),
        force=args.force,
        live=live_release(config.build.get("github_repo", GITHUB_REPO), tag)
        if tag
        else None,
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
    # No abbreviated options: build_command() redacts the spellings it knows,
    # so "--cli /private/…" must not be accepted as --cli-root.
    base = argparse.ArgumentParser(add_help=False, allow_abbrev=False)
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

    common = argparse.ArgumentParser(add_help=False, parents=[base], allow_abbrev=False)
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
        description=__doc__,
        formatter_class=argparse.RawDescriptionHelpFormatter,
        allow_abbrev=False,
    )
    sub = parser.add_subparsers(dest="command", required=True)

    build = sub.add_parser(
        "build",
        parents=[common],
        allow_abbrev=False,
        help="build or resume bundles",
    )
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
        "verify",
        parents=[common],
        allow_abbrev=False,
        help="run the gates on built bundles",
    )
    verify_.set_defaults(verify_only=True, cli_root=None, dry_run=False)

    report_ = sub.add_parser(
        "report",
        parents=[common],
        allow_abbrev=False,
        help="clustering report + thumbnails",
    )
    report_.add_argument("--no-thumbnails", action="store_true")

    load = sub.add_parser(
        "record-load",
        parents=[common],
        allow_abbrev=False,
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
        allow_abbrev=False,
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
        allow_abbrev=False,
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
