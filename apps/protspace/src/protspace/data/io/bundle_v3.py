"""ParquetBundle format v3: columnar annotation encoding.

v2 stringifies every annotation cell and packs multi-values as ``;``-joined
hits with ``|``-suffixed scores/evidence, which forces the browser to re-split
and dictionary-code 573K strings on load.  v3 moves that work to write time:
part 1 carries int32 dictionary codes (or per-row CSR hit counts) and float64
numerics, part 3 carries wide float32 projections, and a new part 6 carries the
label dictionaries plus the CSR code/score/evidence payloads as raw
little-endian buffers.

Every CSR *length* family is stored as per-row counts, never as cumulative
offsets: offsets are near-incompressible (snappy manages 0.4% on the real 573K
bundle) while their first differences compress about 8x, which is the difference
between a v3 bundle 14% larger than v2 and one 21% smaller.  The reader turns
counts back into offsets with one prefix-sum pass.

Only the *container* changes.  ``encode_v3`` takes the v2-shaped tables the
pipeline already builds and the (sibling) ``decode_v3`` turns v3 parts back
into them, so every Python consumer keeps its string-cell logic and
``BUNDLE_FORMAT_VERSION = 2`` in :mod:`~protspace.data.annotations.encoding`
still versions the cell grammar.

The classification rules below intentionally mirror the browser's v2 reader
(``packages/core/src/components/data-loader/utils/conversion.ts``) so a v3
bundle and its v2 equivalent produce identical colours, code order and legend
entries.  Deviations are documented on the constants they come from.
"""

from __future__ import annotations

import io
import json
import logging
from typing import Any

import numpy as np
import pyarrow as pa
import pyarrow.compute as pc
import pyarrow.parquet as pq

from protspace.data.annotations.encoding import (
    FORMAT_VERSION_KEY,
    decode_field,
    encode_field,
    migrate_legacy_annotation_table,
    read_format_version,
    stamp_format_version,
)

logger = logging.getLogger(__name__)

CONTAINER_VERSION = 3
MANIFEST_KEY = b"protspace_v3_manifest"

#: Cell spellings that block numeric inference, mirroring
#: ``MISSING_VALUE_TOKENS`` in
#: ``packages/utils/src/visualization/missing-values.ts``; compared against the
#: lower-cased, whitespace-trimmed cell.  They are *only* consulted there: a
#: column of ``NA`` stays categorical instead of becoming all-NaN numeric, but a
#: cell literally spelled ``none`` keeps that label, because the file has to
#: preserve the token it was given (``protspace style`` and the Dash legend key
#: on it, and ``phosphatase.predicted_transmembrane`` is 1383 of 1587 rows of
#: literal ``none``).  The browser re-applies ``normalizeMissingValue`` at read
#: time, so folding these into NA stays *its* decision, on both v2 and v3.
MISSING_TOKENS = frozenset({"na", "n/a", "nan", "null", "none", "__na__"})

#: ``EVIDENCE_CODE_RE`` from ``conversion.ts``: the part after a hit's last
#: ``|`` is an evidence code, not a score.
EVIDENCE_RE = r"^(?:[A-Z]{2,5}|ECO:\d+)$"

#: What JavaScript's ``Number()`` accepts *and* ``Number.isFinite`` keeps,
#: restricted to decimal literals.  Governs both column-level numeric inference
#: and score suffixes.  Deviation from the browser: JS also parses
#: ``0x10``/``0o17``/``0b1`` as numbers, so a column of hex literals is
#: categorical here and numeric there, and the hit ``"X|0x10"`` keeps its whole
#: string as the label here while the browser reads it as ``X`` scored ``16``
#: (which shifts the label set, code order and palette with it).  Non-decimal
#: literals occur nowhere in the five shipped datasets and supporting them would
#: cost a Python-level parse.  ``Infinity``/``1e999`` are excluded by the
#: post-cast finiteness check.
JS_NUMBER_RE = r"^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$"

#: hyparquet only hands back zero-copy typed arrays for REQUIRED flat PLAIN
#: columns, so every v3 column is written non-nullable, undictionaried and in
#: one row group.
_PQ: dict[str, Any] = {
    "use_dictionary": False,
    "column_encoding": "PLAIN",
    "compression": "snappy",
    "write_statistics": False,
}

_EVIDENCE_DICT_NAME = "__evidence"

#: ``sourceType`` for an Arrow type ``pa.type_for_alias`` cannot parse back
#: (dictionary, list, decimal, ...).  ``decode_v3`` must fall back to its
#: per-kind default for these instead of throwing on an unknown alias.
_UNRESTORABLE_SOURCE_TYPE = "?"

#: Counts are prefix-summed into an int32 offset by the reader.
_INT32_MAX = 2**31 - 1


# --------------------------------------------------------------------------- #
# encoder
# --------------------------------------------------------------------------- #


def _write(table: pa.Table) -> bytes:
    """Serialize one v3 part: single row group, PLAIN, no dictionary."""
    buf = io.BytesIO()
    pq.write_table(table, buf, row_group_size=max(table.num_rows, 1), **_PQ)
    return buf.getvalue()


def _required_table(
    columns: dict[str, pa.Array], metadata: dict | None = None
) -> pa.Table:
    """Build a table whose every field is non-nullable."""
    schema = pa.schema(
        [pa.field(name, arr.type, nullable=False) for name, arr in columns.items()],
        metadata=metadata,
    )
    return pa.table(list(columns.values()), schema=schema)


def _source_type(type_: pa.DataType) -> str:
    """The alias ``decode_v3`` can restore ``type_`` from, else the fallback marker."""
    alias = str(type_)
    try:
        return alias if pa.type_for_alias(alias) == type_ else _UNRESTORABLE_SOURCE_TYPE
    except ValueError:
        return _UNRESTORABLE_SOURCE_TYPE


def _counts_i32(counts: np.ndarray, what: str) -> np.ndarray:
    """Per-row counts as little-endian int32, guarding the reader's prefix sum."""
    total = int(counts.sum())
    if total > _INT32_MAX:
        raise ValueError(
            f"{what} total {total} exceeds the int32 range of the v3 CSR offsets"
        )
    return counts.astype("<i4")


def _as_string(column: pa.ChunkedArray | pa.Array) -> pa.Array:
    """Flatten to a single ``string`` array, rendering bools as ``True``/``False``."""
    arr = column.combine_chunks() if isinstance(column, pa.ChunkedArray) else column
    if isinstance(arr, pa.ChunkedArray):  # combine_chunks keeps the wrapper
        arr = arr.combine_chunks()
    if pa.types.is_boolean(arr.type):
        return pc.if_else(arr, pa.scalar("True"), pa.scalar("False"))
    if pa.types.is_string(arr.type):
        return arr
    return pc.cast(arr, pa.string())


def _blank_mask(trimmed: pa.Array) -> np.ndarray:
    """Genuinely absent: null or the empty string (whitespace already trimmed)."""
    mask = pc.or_(pc.is_null(trimmed), pc.equal(trimmed, pa.scalar("")))
    return np.asarray(pc.fill_null(mask, True))


def _missing_mask(trimmed: pa.Array) -> np.ndarray:
    """``normalizeMissingValue``: null, blank, or a MISSING_TOKENS spelling."""
    token = pc.is_in(pc.utf8_lower(trimmed), value_set=pa.array(sorted(MISSING_TOKENS)))
    return _blank_mask(trimmed) | np.asarray(pc.fill_null(token, False))


def _regex_ok(values: pa.Array, pattern: str) -> np.ndarray:
    return np.asarray(pc.fill_null(pc.match_substring_regex(values, pattern), False))


def _parse_floats(values: pa.Array, ok: np.ndarray) -> np.ndarray:
    """Cast the entries flagged by ``ok`` to float64; substitute 0 elsewhere."""
    safe = pc.if_else(pa.array(ok), values, pa.scalar("0"))
    return pc.cast(safe, pa.float64()).to_numpy(zero_copy_only=False)


def _frequency_order(codes: np.ndarray, n_labels: int) -> tuple[np.ndarray, np.ndarray]:
    """Return ``(rank, order)`` for the browser's descending-frequency sort.

    ``conversion.ts:1600-1605`` sorts ``Map.keys()`` (first-occurrence order)
    with a stable descending-count comparator, so ties keep first occurrence.
    """
    counts = np.bincount(codes, minlength=n_labels)
    order = np.argsort(-counts, kind="stable")
    rank = np.empty(n_labels, dtype=np.int32)
    rank[order] = np.arange(n_labels, dtype=np.int32)
    return rank, order


def _dict_payloads(name: str, labels: list[str]) -> list[tuple[str, bytes]]:
    """``dict:<name>`` utf8 blob + ``dict:<name>:len`` int32 per-label byte lengths."""
    encoded = [label.encode("utf-8") for label in labels]
    lengths = np.array([len(b) for b in encoded], dtype=np.int64)
    return [
        (f"dict:{name}", b"".join(encoded)),
        (f"dict:{name}:len", _counts_i32(lengths, f"dict:{name}").tobytes()),
    ]


def _split_last_pipe(hits: pa.Array) -> tuple[pa.Array, pa.Array]:
    """Split each hit on its LAST ``|`` (``conversion.ts:440``).

    Returns ``(head, suffix_raw)``.  A hit without a ``|`` gets ``suffix_raw``
    ``""``, which is the same branch as a trailing-pipe hit: both keep the whole
    hit as the label.
    """
    parts = pc.split_pattern(hits, "|", max_splits=1, reverse=True)
    lengths = np.asarray(pc.list_value_length(parts))
    starts = np.concatenate(([0], np.cumsum(lengths, dtype=np.int64)[:-1]))
    flat = pc.list_flatten(parts)
    head = flat.take(pa.array(starts))
    has_two = lengths == 2
    suffix = pc.if_else(
        pa.array(has_two),
        flat.take(pa.array(np.where(has_two, starts + 1, starts))),
        pa.scalar(""),
    )
    return head, suffix


def _encode_annotation_column(
    column: pa.ChunkedArray | pa.Array,
    name: str,
    num_rows: int,
    evidence_dict: dict[str, int],
) -> tuple[dict[str, Any], pa.Array, list[tuple[str, bytes]]]:
    """Encode one annotation column.

    Returns ``(manifest_entry, part1_array, payloads)``.  ``part1_array`` is the
    ``<col>`` codes / values or the ``<col>__count`` per-row CSR hit counts; the
    caller picks the physical column name from ``manifest_entry["kind"]``.
    """
    source_type = _source_type(column.type)
    arr = column.combine_chunks() if isinstance(column, pa.ChunkedArray) else column

    # Arrow-numeric source columns stay numeric regardless of content.  The
    # browser would call an all-null column categorical, but keeping the kind
    # tied to the Arrow type is what lets `decode_v3` restore `sourceType`.
    if pa.types.is_integer(arr.type) or pa.types.is_floating(arr.type):
        values = pc.cast(arr, pa.float64()).to_numpy(zero_copy_only=False)
        values = np.where(np.isfinite(values), values, np.nan)
        finite = values[~np.isnan(values)]
        if finite.size:
            numeric_type = "int" if np.all(np.mod(finite, 1) == 0) else "float"
        else:
            # ``np.all([]) is True`` would call an all-null float column int.
            numeric_type = "int" if pa.types.is_integer(arr.type) else "float"
        entry = {
            "kind": "numeric",
            "numericType": numeric_type,
            "sourceType": source_type,
        }
        return entry, pa.array(values, type=pa.float64()), []

    strings = _as_string(arr)
    trimmed = pc.utf8_trim_whitespace(strings)
    blank = _blank_mask(trimmed)

    # --- numeric inference (conversion.ts:71-125) --------------------------- #
    # Only here does a MISSING_TOKENS spelling count as absent, so a column of
    # ``NA`` stays categorical rather than turning into an all-NaN numeric.
    missing = _missing_mask(trimmed)
    if not missing.all():
        numeric_ok = _regex_ok(trimmed, JS_NUMBER_RE) | missing
        if numeric_ok.all():
            values = _parse_floats(trimmed, ~missing)
            if np.isfinite(values[~missing]).all():
                values = np.where(missing, np.nan, values)
                finite = values[~missing]
                numeric_type = "int" if np.all(np.mod(finite, 1) == 0) else "float"
                entry = {
                    "kind": "numeric",
                    "numericType": numeric_type,
                    "sourceType": source_type,
                }
                return entry, pa.array(values, type=pa.float64()), []

    # --- categorical: split cells into hits --------------------------------- #
    # ``_blank_mask``, not ``_missing_mask``: v3 is a container encoding and must
    # hand back the label it was given, so ``none``/``NA``/``null`` stay ordinary
    # categories here and the browser folds them into NA on read as it always has.
    cells = pc.if_else(pa.array(~blank), trimmed, pa.scalar(None, pa.string()))
    hit_lists = pc.split_pattern(cells, ";")
    row_of_hit = np.asarray(pc.list_parent_indices(hit_lists))
    hits = pc.utf8_trim_whitespace(pc.list_flatten(hit_lists))
    keep = ~_blank_mask(hits)
    if not keep.all():
        hits = hits.filter(pa.array(keep))
        row_of_hit = row_of_hit[keep]

    n_hits = len(hits)
    per_row = (
        np.bincount(row_of_hit, minlength=num_rows)
        if n_hits
        else np.zeros(num_rows, int)
    )
    max_hits = int(per_row.max()) if num_rows else 0

    if n_hits == 0:
        entry = {"kind": "categorical", "sourceType": source_type}
        codes = np.full(num_rows, -1, dtype=np.int32)
        return entry, pa.array(codes, type=pa.int32()), _dict_payloads(name, [])

    # --- per-hit label / score / evidence (conversion.ts:433-468) ----------- #
    head, suffix_raw = _split_last_pipe(hits)
    no_suffix = np.asarray(pc.equal(suffix_raw, pa.scalar("")))
    suffix = pc.utf8_trim_whitespace(suffix_raw)
    is_evidence = ~no_suffix & _regex_ok(suffix, EVIDENCE_RE)

    scored = np.zeros(n_hits, dtype=bool)
    hit_score_count = np.zeros(n_hits, dtype=np.int64)
    score_values = np.zeros(0, dtype=np.float64)

    candidate = np.flatnonzero(~no_suffix & ~is_evidence)
    if candidate.size:
        pieces = pc.split_pattern(suffix.take(pa.array(candidate)), ",")
        piece_len = np.asarray(pc.list_value_length(pieces)).astype(np.int64)
        flat = pc.utf8_trim_whitespace(pc.list_flatten(pieces))
        blank = np.asarray(pc.equal(flat, pa.scalar("")))
        numeric = _regex_ok(flat, JS_NUMBER_RE)
        parsed = _parse_floats(flat, numeric)
        # ``Number("")`` is ``0`` in JavaScript, so an empty score part
        # (``"label|1,"``) is a valid score of 0 -- ``_parse_floats`` already
        # substituted 0 for it, because a blank never matches JS_NUMBER_RE.
        valid = blank | (numeric & np.isfinite(parsed))
        owner = np.repeat(np.arange(candidate.size), piece_len)
        bad = np.bincount(owner, weights=~valid, minlength=candidate.size)
        ok = bad == 0
        scored[candidate[ok]] = True
        hit_score_count[candidate[ok]] = piece_len[ok]
        score_values = parsed[np.repeat(ok, piece_len)]

    use_head = pa.array(is_evidence | scored)
    labels = pc.if_else(use_head, pc.utf8_trim_whitespace(head), hits)

    # --- dictionary in decoded space --------------------------------------- #
    encoded_dict = pc.dictionary_encode(labels)
    raw_labels = encoded_dict.dictionary.to_pylist()
    unify: dict[str, int] = {}
    fold = np.empty(len(raw_labels), dtype=np.int32)
    for i, raw in enumerate(raw_labels):
        fold[i] = unify.setdefault(decode_field(raw), len(unify))
    provisional = fold[np.asarray(encoded_dict.indices)]
    rank, order = _frequency_order(provisional, len(unify))
    codes = rank[provisional].astype(np.int32)
    ordered_labels = list(unify)
    ordered_labels = [ordered_labels[i] for i in order]

    payloads = _dict_payloads(name, ordered_labels)
    has_scores = bool(scored.any())
    has_evidence = bool(is_evidence.any())

    if max_hits <= 1 and not has_scores and not has_evidence:
        row_codes = np.full(num_rows, -1, dtype=np.int32)
        row_codes[row_of_hit] = codes
        entry = {"kind": "categorical", "sourceType": source_type}
        return entry, pa.array(row_codes, type=pa.int32()), payloads

    row_counts = _counts_i32(per_row, f"column '{name}' hits")
    payloads.append((f"csr:{name}", codes.astype("<i4").tobytes()))

    if has_scores:
        counts = _counts_i32(hit_score_count, f"column '{name}' scores")
        payloads.append((f"score_count:{name}", counts.tobytes()))
        payloads.append((f"scores:{name}", score_values.astype("<f8").tobytes()))
    if has_evidence:
        idx = np.flatnonzero(is_evidence)
        local = pc.dictionary_encode(suffix.take(pa.array(idx)))
        global_ids = np.array(
            [
                evidence_dict.setdefault(text, len(evidence_dict))
                for text in local.dictionary.to_pylist()
            ],
            dtype=np.int32,
        )
        ev_codes = np.full(n_hits, -1, dtype=np.int32)
        ev_codes[idx] = global_ids[np.asarray(local.indices)]
        payloads.append((f"evidence:{name}", ev_codes.astype("<i4").tobytes()))

    entry = {"kind": "multi", "sourceType": source_type}
    if has_scores:
        entry["scores"] = True
    if has_evidence:
        entry["evidence"] = True
    return entry, pa.array(row_counts, type=pa.int32()), payloads


def _encode_projections(
    projections_metadata: pa.Table,
    projections_data: pa.Table,
    protein_ids: pa.Array,
) -> tuple[pa.Table, list[dict[str, Any]]]:
    """Pivot the long projections table to wide float32, aligned to part 1."""
    required = {"projection_name", "identifier", "x", "y"}
    missing = required - set(projections_data.column_names)
    if missing:
        raise ValueError(
            f"projections_data is missing required column(s): {sorted(missing)}"
        )

    names = projections_metadata.column("projection_name").to_pylist()
    if len(set(names)) != len(names):
        raise ValueError(
            f"Duplicate projection name(s) in projections_metadata: {names}"
        )

    name_column = projections_data.column("projection_name")
    # The browser derives the projection set, order and dimension from the data
    # rows alone (``conversion.ts:1163-1196``), so a metadata-only projection
    # would be an all-zero one there and a data-only projection would silently
    # vanish here.  All five shipped datasets agree; refuse the ones that do not.
    in_data = set(pc.unique(name_column).to_pylist())
    if in_data != set(names):
        raise ValueError(
            "projections_metadata and projections_data disagree on the projection "
            f"set: metadata-only {sorted(set(names) - in_data, key=str)}, "
            f"data-only {sorted(in_data - set(names), key=str)}"
        )

    dimensions = (
        projections_metadata.column("dimensions").to_pylist()
        if "dimensions" in projections_metadata.column_names
        else [None] * len(names)
    )
    has_z = "z" in projections_data.column_names

    num_rows = len(protein_ids)
    columns: dict[str, pa.Array] = {}
    manifest: list[dict[str, Any]] = []

    for name, declared in zip(names, dimensions, strict=True):
        rows = projections_data.filter(pc.equal(name_column, pa.scalar(name)))
        identifiers = rows.column("identifier")
        found = pc.index_in(identifiers, value_set=protein_ids)
        if found.null_count:
            unknown = identifiers.filter(pc.is_null(found)).to_pylist()
            raise ValueError(
                f"projection '{name}' references identifier(s) absent from the "
                f"annotations table: {sorted(set(unknown))[:5]}"
            )
        positions = np.asarray(found.combine_chunks())
        if np.unique(positions).size != positions.size:
            repeated = np.flatnonzero(np.bincount(positions, minlength=num_rows) > 1)
            raise ValueError(
                f"projection '{name}' has more than one row for "
                f"{repeated.size} identifier(s): "
                f"{protein_ids.take(pa.array(repeated[:5])).to_pylist()}"
            )

        z = rows.column("z") if has_z else None
        z_present = (
            z is not None and not pa.types.is_null(z.type) and z.null_count < len(z)
        )
        try:  # parquet may hand the dimension back as "3" or a numpy int
            declared_dim = int(declared)
        except (TypeError, ValueError):
            declared_dim = None
        dimension = declared_dim if declared_dim in (2, 3) else (3 if z_present else 2)

        for axis in ("x", "y", "z")[:dimension]:
            # 0.0, not NaN, for a protein absent from this projection: the browser
            # leaves its zero-initialised Float32Array untouched and guards the
            # write (``conversion.ts:1198-1205``), so the protein renders at the
            # origin.  Preserving that quirk is the contract, not an endorsement.
            values = np.zeros(num_rows, dtype=np.float32)
            if axis != "z" or z_present:
                values[positions] = (
                    rows.column(axis).to_numpy(zero_copy_only=False).astype(np.float32)
                )
            columns[f"{name}__{axis}"] = pa.array(values, type=pa.float32())
        manifest.append({"name": name, "dimension": dimension})

    return _required_table(columns), manifest


def encode_v3(
    annotations: pa.Table,
    projections_metadata: pa.Table,
    projections_data: pa.Table,
) -> tuple[bytes, bytes, bytes, bytes]:
    """Encode the v2-shaped pipeline tables as v3 parts 1, 2, 3 and 6.

    ``annotations`` must carry the format-version stamp unless it really is v1:
    an unstamped v2 table is indistinguishable from a v1 one here and is
    migrated a second time, double-escaping every reserved character.  See the
    precondition on :func:`~protspace.data.io.bundle.write_bundle`.
    """
    if read_format_version(annotations) == 1:
        # Loud, because the alternative failure is silent and unrecoverable: an
        # already-v2 table that lost its stamp (pyarrow drops schema metadata on
        # rename_columns/concat) is migrated twice and every ``%3B`` becomes
        # ``%253B``.  Refusing instead is not an option -- a genuine legacy
        # bundle read back is unstamped too, and that upgrade path is the point.
        logger.warning(
            "annotations table reads as format v1 (no stamp, or stamped 1); "
            "migrating its cell grammar to v2. If it was already v2, re-apply "
            "stamp_format_version() before writing -- migrating twice escapes "
            "every reserved character a second time."
        )
        annotations = migrate_legacy_annotation_table(annotations)

    id_column = next(
        (c for c in ("protein_id", "identifier") if c in annotations.column_names), None
    )
    if id_column is None:
        raise ValueError(
            "annotations table has no 'protein_id' or 'identifier' column; "
            f"found {annotations.column_names}"
        )

    ids = _as_string(annotations.column(id_column))
    if ids.null_count:
        raise ValueError(f"annotations column '{id_column}' contains null values")
    duplicated = pc.sum(pc.greater(pc.value_counts(ids).field("counts"), 1)).as_py()
    if duplicated:
        raise ValueError(
            f"annotations column '{id_column}' contains {duplicated} duplicated value(s); "
            "protein identifiers must be unique"
        )

    num_rows = annotations.num_rows
    existing = set(annotations.column_names)
    evidence_dict: dict[str, int] = {}
    columns: dict[str, pa.Array] = {id_column: ids}
    manifest_columns: dict[str, Any] = {}
    payloads: list[tuple[str, bytes]] = []

    for name in annotations.column_names:
        if name == id_column:
            continue
        entry, array, column_payloads = _encode_annotation_column(
            annotations.column(name), name, num_rows, evidence_dict
        )
        physical = f"{name}__count" if entry["kind"] == "multi" else name
        if physical != name and physical in existing:
            raise ValueError(
                f"column '{name}' is multi-valued but '{physical}' already exists in "
                "the annotations table; rename one of them"
            )
        columns[physical] = array
        manifest_columns[name] = entry
        payloads.extend(column_payloads)

    if evidence_dict:
        payloads.extend(_dict_payloads(_EVIDENCE_DICT_NAME, list(evidence_dict)))

    projections_table, projection_manifest = _encode_projections(
        projections_metadata, projections_data, ids
    )

    manifest = {
        "idColumn": id_column,
        "columns": manifest_columns,
        "projections": projection_manifest,
    }
    metadata = {
        **{
            k: v
            for k, v in (annotations.schema.metadata or {}).items()
            if k != MANIFEST_KEY
        },
        FORMAT_VERSION_KEY: str(CONTAINER_VERSION).encode(),
        MANIFEST_KEY: json.dumps(manifest, separators=(",", ":")).encode(),
    }

    payload_names = [n for n, _ in payloads]
    if len(set(payload_names)) != len(payload_names):
        clashing = sorted({n for n in payload_names if payload_names.count(n) > 1})
        raise ValueError(
            f"payload name collision(s) {clashing}; rename the annotation column(s) "
            "that produce them"
        )

    payload_table = _required_table(
        {
            "name": pa.array([n for n, _ in payloads], type=pa.string()),
            "data": pa.array([d for _, d in payloads], type=pa.binary()),
        }
    )

    return (
        _write(_required_table(columns, metadata)),
        _write(projections_metadata),
        _write(projections_table),
        _write(payload_table),
    )


# --------------------------------------------------------------------------- #
# decoder
# --------------------------------------------------------------------------- #


def _read(part: bytes) -> pa.Table:
    return pq.read_table(io.BytesIO(part))


def _flat(column: pa.ChunkedArray | pa.Array) -> pa.Array:
    """One contiguous Arrow array (``ListArray.from_arrays`` refuses chunks).

    Every v3 part is one row group, so the single-chunk branch is what actually
    runs (a zero-row part still reads back as one empty chunk).  The concat stays
    because pyarrow splits a column past the 2 GB BinaryArray limit into several
    chunks, and taking chunk 0 there would silently truncate the column.
    """
    if not isinstance(column, pa.ChunkedArray):
        return column
    if column.num_chunks == 1:
        return column.chunk(0)
    return pa.concat_arrays(column.chunks)


def _read_payloads(part: bytes) -> dict[str, bytes]:
    table = _read(part)
    return dict(
        zip(
            table.column("name").to_pylist(),
            table.column("data").to_pylist(),
            strict=True,
        )
    )


def _read_labels(payloads: dict[str, bytes], name: str) -> list[str]:
    """Slice ``dict:<name>`` by the prefix sum of its per-label byte lengths.

    A v3 bundle is user-supplied input and Python slicing clamps, so a corrupt
    length array would silently yield duplicated and empty labels instead of an
    error.  The lengths must therefore tile the blob exactly.
    """
    blob = payloads[f"dict:{name}"]
    lengths = np.frombuffer(payloads[f"dict:{name}:len"], "<i4")
    ends = np.cumsum(lengths, dtype=np.int64)
    total = int(ends[-1]) if ends.size else 0
    if bool((lengths < 0).any()) or total != len(blob):
        raise ValueError(
            f"payload 'dict:{name}:len' is corrupt: {lengths.size} label length(s) "
            f"totalling {total} over a {len(blob)}-byte 'dict:{name}' blob"
        )
    return [
        blob[end - length : end].decode()
        for length, end in zip(lengths, ends, strict=True)
    ]


def _list_join(
    counts: np.ndarray, values: pa.Array, separator: str, what: str
) -> pa.Array:
    """Prefix-sum per-element ``counts`` into list offsets, then join each list.

    A total below ``len(values)`` silently empties the tail lists and a negative
    count misaligns them, so a user-supplied bundle has to tile ``values``
    exactly.  (A total above it already raises inside Arrow.)
    """
    ends = np.cumsum(counts, dtype=np.int64)
    total = int(ends[-1]) if ends.size else 0
    if bool((counts < 0).any()) or total != len(values):
        raise ValueError(
            f"{what} is corrupt: {counts.size} count(s) totalling {total} over "
            f"{len(values)} value(s)"
        )
    offsets = np.concatenate(([0], ends)).astype(np.int32)
    lists = pa.ListArray.from_arrays(pa.array(offsets, type=pa.int32()), values)
    return pc.binary_join(lists, separator)


def _restorable_type(alias: str) -> pa.DataType | None:
    """The numeric Arrow type ``alias`` names, or *None* to render v2 strings.

    A string ``sourceType`` deliberately lands here: the v2 spelling of the
    column is what the encoder consumed, so rendering it back is the restoration.
    """
    if alias in (_UNRESTORABLE_SOURCE_TYPE, "string", "large_string"):
        return None
    try:
        type_ = pa.type_for_alias(alias)
    except ValueError:
        return None
    return type_ if pa.types.is_integer(type_) or pa.types.is_floating(type_) else None


def _decode_numeric(column: pa.ChunkedArray, entry: dict[str, Any]) -> pa.Array:
    """float64 + NaN back to the source Arrow type, or to its v2 string cells."""
    values = _flat(column).to_numpy(zero_copy_only=False)
    present = ~np.isnan(values)
    type_ = _restorable_type(entry.get("sourceType", _UNRESTORABLE_SOURCE_TYPE))
    if type_ is not None:
        return pc.cast(pa.array(values, mask=~present), type_)

    finite = np.where(present, values, 0.0)
    # ``str(2.0)`` is ``"2.0"`` but an int-typed v2 column spells it ``"2"``, and
    # numpy's float repr is Python's, so int columns take the int64 detour.  The
    # magnitude guard keeps a value past int64 out of an undefined cast, and it is
    # per value: one 1e19 cell must not re-spell the whole column as floats.
    if entry.get("numericType") == "int":
        small = np.abs(finite) < 2.0**63
        text = np.where(
            small,
            np.where(small, finite, 0.0).astype(np.int64).astype(str),
            finite.astype(str),
        )
    else:
        text = finite.astype(str)
    return pc.if_else(
        pa.array(present), pa.array(text, type=pa.string()), pa.scalar("")
    )


def _decode_categorical(column: pa.ChunkedArray, labels: pa.Array) -> pa.Array:
    """int32 codes back to label cells; ``-1`` (missing) becomes ``""``."""
    codes = _flat(column).to_numpy(zero_copy_only=False)
    return pc.fill_null(labels.take(pa.array(codes, mask=codes < 0)), "")


def _decode_multi(
    column: pa.ChunkedArray,
    name: str,
    entry: dict[str, Any],
    payloads: dict[str, bytes],
    labels: pa.Array,
    evidence_labels: pa.Array,
) -> pa.Array:
    """CSR hits back to ``label|suffix;label|suffix`` cells (``""`` when empty)."""
    hits = labels.take(pa.array(np.frombuffer(payloads[f"csr:{name}"], "<i4")))
    suffix = None

    if entry.get("evidence"):
        codes = np.frombuffer(payloads[f"evidence:{name}"], "<i4")
        suffix = evidence_labels.take(pa.array(codes, mask=codes < 0))

    if entry.get("scores"):
        per_hit = np.frombuffer(payloads[f"score_count:{name}"], "<i4")
        values = np.frombuffer(payloads[f"scores:{name}"], "<f8")
        # float64, not float32: an E-value like ``1e-200`` (the canonical Pfam and
        # InterPro score) underflows float32 to ``0`` and ``1e40`` overflows to
        # ``inf``, which is not even valid v2, so a second round trip would
        # re-classify the hit.  numpy's float64 repr is the shortest spelling that
        # reads back as the same double, but it is *not* character-identical to
        # ``String(number)``: Python pads the exponent to two digits (``1e-07``
        # where JavaScript prints ``1e-7``) and switches to exponential notation
        # at different magnitudes -- below 1e-4 against JavaScript's 1e-6
        # (``2.3e-05`` against ``0.000023``) and from 1e16 against JavaScript's
        # 1e21.  Both spellings parse back to the same double, so the difference
        # is cosmetic in a score suffix and never changes a comparison; only the
        # trailing ``.0`` is normalised away here, because JavaScript never
        # prints it (``[1].join(',')`` is ``"1"``) and it would otherwise shift
        # the label text.
        text = pc.replace_substring_regex(
            pa.array(values.astype(str), type=pa.string()), r"\.0$", ""
        )
        scored = pc.if_else(
            pa.array(per_hit > 0),
            _list_join(per_hit, text, ",", f"payload 'score_count:{name}'"),
            pa.scalar(None, pa.string()),
        )
        suffix = scored if suffix is None else pc.coalesce(suffix, scored)

    if suffix is not None:
        # A null suffix (no evidence, no scores) leaves the bare label: the
        # element-wise join emits null as soon as one side is null.
        hits = pc.coalesce(pc.binary_join_element_wise(hits, suffix, "|"), hits)

    counts = _flat(column).to_numpy(zero_copy_only=False)
    return _list_join(counts, hits, ";", f"column '{name}__count'")


def _decode_projections(
    part: bytes, manifest: list[dict[str, Any]], identifiers: pa.Array
) -> pa.Table:
    """Wide float32 projections back to the long v2 table, in manifest order."""
    wide = _read(part)
    num_rows = len(identifiers)
    row = pa.array(np.zeros(num_rows, dtype=np.int32))
    schema = pa.schema(
        [
            ("projection_name", pa.string()),
            ("identifier", pa.string()),
            ("x", pa.float32()),
            ("y", pa.float32()),
            ("z", pa.float32()),
        ]
    )

    tables = []
    for projection in manifest:
        name = projection["name"]
        dimension = int(projection["dimension"])
        tables.append(
            pa.table(
                {
                    # ``take`` of a one-element array beats materialising N copies.
                    "projection_name": pa.array([name], type=pa.string()).take(row),
                    "identifier": identifiers,
                    "x": _flat(wide.column(f"{name}__x")),
                    "y": _flat(wide.column(f"{name}__y")),
                    "z": _flat(wide.column(f"{name}__z"))
                    if dimension == 3
                    else pa.nulls(num_rows, pa.float32()),
                },
                schema=schema,
            )
        )
    return pa.concat_tables(tables) if tables else schema.empty_table()


def decode_v3(parts: list[bytes]) -> tuple[pa.Table, pa.Table, pa.Table]:
    """Decode v3 parts back into the three v2-shaped tables.

    ``parts`` is what :func:`encode_v3` returned: annotations, projections
    metadata, wide projections, payloads (bundle parts 1, 2, 3 and 6).  The
    result is re-stamped ``protspace_format_version=2`` because what comes back
    *is* the v2 cell grammar every Python consumer parses.

    The round trip is not byte-exact, and deliberately so -- v3 stores what the
    browser's v2 reader would have parsed out of the cells, not the cells:

    * an unstamped (v1-reading) input table is migrated to the v2 cell grammar
      first, which is what every shipped legacy bundle gets: ten of the eleven
      datasets under ``apps/web/public/data/`` carry no stamp, so regenerating
      one runs :func:`migrate_legacy_annotation_table` and its reserved
      characters come back percent-encoded (display-neutral, and a fix -- but it
      is a difference, and it is the one a regeneration actually hits);
    * hits and cells are whitespace-trimmed, and *blank* hits are dropped
      (``"A;;B"`` comes back ``"A;B"``, ``" A |IDA"`` as ``"A|IDA"``);
    * a missing cell -- null or blank -- comes back as ``""`` (a cell spelled
      ``none``/``NA``/``null`` is an ordinary label and comes back unchanged);
    * labels are re-encoded canonically, so ``%3b`` comes back as ``%3B``;
    * scores are re-spelled shortest-first, so ``"0.5700"`` comes back as
      ``"0.57"``;
    * a numeric column comes back in its ``sourceType`` when that is restorable
      and otherwise as its canonical v2 spelling, so an all-integral column
      spells ``100``, never ``100.0``;
    * a non-finite value in an Arrow-numeric column is **lost**: ``±inf`` and
      ``NaN`` both encode as null and come back null (or ``""``).  Unreachable
      from ``prepare`` -- nothing upstream emits one -- but ``protspace bundle
      -a <user parquet>`` will happily hand one over.  Neither is expressible in
      v2 anyway: the cell grammar's number rule rejects ``Infinity`` and the
      browser drops non-finite values on read, so preserving them would produce
      a bundle no reader agrees on;
    * projection coordinates come back float32 (``z`` null for a 2D projection)
      and a protein absent from a projection comes back at the origin;
    * the identifier column comes back first, wherever it sat before.
    """
    if len(parts) != 4:
        raise ValueError(
            f"decode_v3 expects the 4 parts encode_v3 returns, got {len(parts)}"
        )

    annotations = _read(parts[0])
    metadata = dict(annotations.schema.metadata or {})
    raw_manifest = metadata.pop(MANIFEST_KEY, None)
    if raw_manifest is None:
        raise ValueError(
            f"annotations part carries no {MANIFEST_KEY.decode()} key; "
            "it is not a v3 part"
        )
    manifest = json.loads(raw_manifest)
    payloads = _read_payloads(parts[3])

    evidence_labels = pa.array(
        _read_labels(payloads, _EVIDENCE_DICT_NAME)
        if f"dict:{_EVIDENCE_DICT_NAME}" in payloads
        else [],
        type=pa.string(),
    )

    id_column = manifest["idColumn"]
    columns: dict[str, pa.Array] = {id_column: _flat(annotations.column(id_column))}
    for name, entry in manifest["columns"].items():
        kind = entry["kind"]
        if kind == "numeric":
            columns[name] = _decode_numeric(annotations.column(name), entry)
            continue
        # Labels are stored decoded; the v2 cell grammar wants them encoded.
        labels = pa.array(
            [encode_field(label) for label in _read_labels(payloads, name)],
            type=pa.string(),
        )
        if kind == "categorical":
            columns[name] = _decode_categorical(annotations.column(name), labels)
        elif kind == "multi":
            columns[name] = _decode_multi(
                annotations.column(f"{name}__count"),
                name,
                entry,
                payloads,
                labels,
                evidence_labels,
            )
        else:
            raise ValueError(f"column '{name}' has unknown v3 kind '{kind}'")

    return (
        stamp_format_version(pa.table(columns).replace_schema_metadata(metadata)),
        _read(parts[1]),
        _decode_projections(parts[2], manifest["projections"], columns[id_column]),
    )
