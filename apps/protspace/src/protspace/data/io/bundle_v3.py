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
into them, so every Python consumer keeps its string-cell logic.

Two footer keys, two meanings.  Part 1 of a v3 container carries
``protspace_container_version`` (:data:`CONTAINER_VERSION_KEY`) = ``3`` and no
``protspace_format_version``: that key is the annotation *cell grammar*
version (``BUNDLE_FORMAT_VERSION = 2`` in
:mod:`~protspace.data.annotations.encoding`), and a v3 part 1 has no cells to
parse -- its labels sit decoded in the part-6 dictionaries.  The v2-shaped
tables on either side of the codec carry the grammar stamp and never the
container key.  ``encode_v3`` refuses a table without a v2 stamp instead of
guessing its grammar; a caller that holds v1 cells migrates them first
(:func:`~protspace.data.annotations.encoding.migrate_legacy_annotation_table`,
:func:`~protspace.data.annotations.encoding.upgrade_cell_grammar`).

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

from protspace.core.constants import BROWSER_MISSING_TOKENS
from protspace.data.annotations.encoding import (
    ARROW_BOOLEAN_LABELS,
    BUNDLE_FORMAT_VERSION,
    FORMAT_VERSION_KEY,
    decode_field,
    encode_field,
    has_format_version,
    read_format_version,
    stamp_format_version,
)

logger = logging.getLogger(__name__)

CONTAINER_VERSION = 3
#: Part 1's footer key for the container version.  Its presence is what makes a
#: bundle v3; a legacy (v1/v2) bundle never carries it.
CONTAINER_VERSION_KEY = b"protspace_container_version"
MANIFEST_KEY = b"protspace_v3_manifest"

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

#: Footer keys the codec owns: never copied from an input table into part 1, and
#: never handed back from part 1 to a decoded table.
_FORMAT_KEYS = frozenset({CONTAINER_VERSION_KEY, FORMAT_VERSION_KEY, MANIFEST_KEY})

#: Counts are prefix-summed into an int32 offset by the reader.
_INT32_MAX = 2**31 - 1
#: The largest magnitude up to which every integer is exact as a float64.
_FLOAT64_EXACT_INT = 2**53


def read_container_version(schema: pa.Schema) -> int | None:
    """The :data:`CONTAINER_VERSION_KEY` in a part's footer, ``None`` if absent."""
    raw = (schema.metadata or {}).get(CONTAINER_VERSION_KEY)
    if raw is None:
        return None
    try:
        return int(raw)
    except ValueError:
        raise ValueError(
            f"parquetbundle part 1 declares container version {raw!r}, not an integer"
        ) from None


def write_part(table: pa.Table, **options: Any) -> bytes:
    """Serialize one bundle part to parquet bytes (``options`` go to pyarrow)."""
    buf = io.BytesIO()
    pq.write_table(table, buf, **options)
    return buf.getvalue()


def read_part(part: bytes, columns: list[str] | None = None) -> pa.Table:
    """Read one bundle part (optionally only ``columns``) back into a table."""
    return pq.read_table(io.BytesIO(part), columns=columns)


# --------------------------------------------------------------------------- #
# encoder
# --------------------------------------------------------------------------- #


def _write(table: pa.Table) -> bytes:
    """Serialize one v3 part: single row group, PLAIN, no dictionary."""
    return write_part(table, row_group_size=max(table.num_rows, 1), **_PQ)


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


def _is_list(type_: pa.DataType) -> bool:
    return (
        pa.types.is_list(type_)
        or pa.types.is_large_list(type_)
        or pa.types.is_fixed_size_list(type_)
    )


def _join_list_cells(arr: pa.Array) -> pa.Array:
    """Each list cell as v2 hits: its elements percent-encoded and ``;``-joined.

    An element is one hit taken literally, so a ``;`` or ``|`` inside it stays
    part of its label.  A null or empty element is no hit, and a null or empty
    list is a missing cell.
    """
    if pa.types.is_nested(arr.type.value_type):
        raise pa.ArrowNotImplementedError(f"nested list type {arr.type}")
    elements = _as_string(pc.list_flatten(arr)).to_pylist()
    parents = np.asarray(pc.list_parent_indices(arr))
    hits: list[list[str]] = [[] for _ in range(len(arr))]
    for row, element in zip(parents, elements, strict=True):
        if element:
            hits[row].append(encode_field(element))
    return pa.array([";".join(row) or None for row in hits], type=pa.string())


def _as_string(column: pa.ChunkedArray | pa.Array) -> pa.Array:
    """Flatten to a single ``string`` array, bools as ``ARROW_BOOLEAN_LABELS``.

    A list column becomes ``;``-joined hits (:func:`_join_list_cells`); a type
    with no text form (a struct, a map, a list of lists) raises
    ``pa.ArrowNotImplementedError``.
    """
    arr = _flat(column)
    if pa.types.is_boolean(arr.type):
        false, true = ARROW_BOOLEAN_LABELS
        return pc.if_else(arr, pa.scalar(true), pa.scalar(false))
    if pa.types.is_string(arr.type):
        return arr
    if _is_list(arr.type):
        return _join_list_cells(arr)
    return pc.cast(arr, pa.string())


def _blank_mask(trimmed: pa.Array) -> np.ndarray:
    """Genuinely absent: null or the empty string (whitespace already trimmed)."""
    mask = pc.or_(pc.is_null(trimmed), pc.equal(trimmed, pa.scalar("")))
    return np.asarray(pc.fill_null(mask, True))


def _missing_mask(trimmed: pa.Array) -> np.ndarray:
    """``normalizeMissingValue``: null, blank, or a ``BROWSER_MISSING_TOKENS`` spelling.

    Only numeric inference consults it: a column of ``NA`` stays categorical
    instead of becoming all-NaN numeric, but a cell literally spelled ``none``
    keeps that label, because the file has to preserve the token it was given
    (``protspace style`` and the Dash legend key on it, and
    ``phosphatase.predicted_transmembrane`` is 1383 of 1587 rows of literal
    ``none``).  The browser re-applies ``normalizeMissingValue`` at read time, so
    folding these into NA stays *its* decision, on both v2 and v3.
    """
    tokens = pa.array(sorted(BROWSER_MISSING_TOKENS))
    token = pc.is_in(pc.utf8_lower(trimmed), value_set=tokens)
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


def _numeric_entry(
    values: np.ndarray,
    source_type: str,
    empty_is_int: bool = False,
    placed: np.ndarray | None = None,
) -> tuple[dict[str, Any], pa.Array, list[tuple[str, bytes]]]:
    """:func:`_encode_annotation_column`'s result for float64 ``values`` (NaN = missing).

    ``numericType`` is decided over the ``placed`` rows, as the v2 browser
    inferred it over the proteins it showed and the v3 reader takes it as
    written: an annotation-only ``2.5`` must not turn an int column float.
    Without a placed value it is decided over every row.
    """
    present = ~np.isnan(values)
    if placed is not None and (present & placed).any():
        present &= placed
    finite = values[present]
    # ``np.all([]) is True`` would call an all-missing float column int.
    integral = bool(np.all(np.mod(finite, 1) == 0)) if finite.size else empty_is_int
    entry = {
        "kind": "numeric",
        "numericType": "int" if integral else "float",
        "sourceType": source_type,
    }
    return entry, pa.array(values, type=pa.float64()), []


def _fits_float64(arr: pa.Array) -> bool:
    """Whether every value of integer ``arr`` is exact as a float64 (|v| <= 2**53)."""
    bounds = pc.min_max(arr)
    low, high = bounds["min"].as_py(), bounds["max"].as_py()
    return low is None or (low >= -_FLOAT64_EXACT_INT and high <= _FLOAT64_EXACT_INT)


def _encode_annotation_column(
    column: pa.ChunkedArray | pa.Array,
    name: str,
    num_rows: int,
    evidence_dict: dict[str, int],
    placed: np.ndarray | None = None,
    numeric: str = "infer",
) -> tuple[dict[str, Any], pa.Array, list[tuple[str, bytes]]]:
    """Encode one annotation column.

    Returns ``(manifest_entry, part1_array, payloads)``.  ``part1_array`` is the
    ``<col>`` codes / values or the ``<col>__count`` per-row CSR hit counts; the
    caller picks the physical column name from ``manifest_entry["kind"]``.

    ``placed`` marks the rows the browser shows (a finite coordinate in some
    projection), ``None`` for all of them.  ``numeric`` is ``"infer"`` for
    numeric inference on a text column, ``"placed"`` to only mark the column
    ``placedNumeric``, never to write it numeric, and ``"never"`` for neither;
    the last two are for a column a bundle already stores as labels
    (:func:`replace_annotations_v3`).
    """
    source_type = _source_type(column.type)
    arr = _flat(column)

    # Arrow-numeric source columns stay numeric regardless of content.  The
    # browser would call an all-null column categorical, but keeping the kind
    # tied to the Arrow type is what lets `decode_v3` restore `sourceType`.
    # An integer column float64 cannot hold exactly (a 64-bit hash or id) is the
    # exception: it is stored as its exact decimal labels, as the v2 browser
    # reader showed a non-safe bigint, and ``decode_v3`` casts them back.
    exact_labels = pa.types.is_integer(arr.type) and not _fits_float64(arr)
    if not exact_labels and (
        pa.types.is_integer(arr.type) or pa.types.is_floating(arr.type)
    ):
        values = pc.cast(arr, pa.float64()).to_numpy(zero_copy_only=False)
        values = np.where(np.isfinite(values), values, np.nan)
        return _numeric_entry(
            values, source_type, pa.types.is_integer(arr.type), placed
        )

    try:
        strings = _as_string(arr)
    except pa.ArrowNotImplementedError:
        raise ValueError(
            f"annotation column '{name}' has Arrow type {arr.type}, which a bundle "
            "cannot store: an annotation must be a scalar or a list of scalars"
        ) from None
    trimmed = pc.utf8_trim_whitespace(strings)
    blank = _blank_mask(trimmed)

    # --- numeric inference (conversion.ts:71-125) --------------------------- #
    # Only here does a missing-token spelling count as absent (``_missing_mask``).
    # A list column is never inferred numeric: its elements are labels, taken
    # literally, even when every cell holds one number (the v2 browser read a
    # list cell as ``String(array)``, which ``parseNumericAnnotationValue``
    # never takes for a number).
    #
    # The browser infers over the proteins it shows, the ``placed`` ones, and
    # the file over every row.  They disagree only when an annotation-only
    # protein decides it: a column numeric over every row but missing on every
    # placed protein is written as labels, as v2 showed it; one numeric over
    # the placed proteins only (an unplaced ``unknown`` among numbers) must
    # keep that label, so it is written as labels too, marked ``placedNumeric``
    # for the browser to read as numbers once it has dropped the unplaced rows.
    missing = _missing_mask(trimmed)
    extra: dict[str, Any] = {}
    if not exact_labels and not _is_list(arr.type) and numeric != "never":
        shown = placed if placed is not None and placed.any() else slice(None)
        numeric_ok = _regex_ok(trimmed, JS_NUMBER_RE) | missing
        if numeric_ok[shown].all():
            present = ~missing
            values = _parse_floats(trimmed, numeric_ok & present)
            usable = numeric_ok & (missing | np.isfinite(values))

            def numeric_over(rows) -> bool:
                return bool(present[rows].any() and usable[rows].all())

            if numeric_over(shown):
                if numeric == "infer" and numeric_over(slice(None)):
                    values = np.where(missing, np.nan, values)
                    return _numeric_entry(values, source_type, placed=placed)
                extra["placedNumeric"] = True

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
        entry = {"kind": "categorical", "sourceType": source_type, **extra}
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

    entry = {"kind": "multi", "sourceType": source_type, **extra}
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
    """Pivot the long projections table to wide float32, aligned to part 1.

    The manifest lists the projections by first appearance in the data rows,
    as the v2 browser did, whatever order the metadata gives them in.
    """
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
    # would be an empty one there and a data-only projection would silently
    # vanish here.  All five shipped datasets agree; refuse the ones that do not.
    # ``pc.unique`` keeps first appearance, the order the browser lists (and
    # opens first) the projections in; part 2 keeps its own order.
    data_order = pc.unique(name_column).to_pylist()
    in_data = set(data_order)
    if in_data != set(names):
        raise ValueError(
            "projections_metadata and projections_data disagree on the projection "
            f"set: metadata-only {sorted(set(names) - in_data, key=str)}, "
            f"data-only {sorted(in_data - set(names), key=str)}"
        )

    declared_dimensions = dict(
        zip(
            names,
            projections_metadata.column("dimensions").to_pylist()
            if "dimensions" in projections_metadata.column_names
            else [None] * len(names),
            strict=True,
        )
    )
    has_z = "z" in projections_data.column_names

    num_rows = len(protein_ids)
    columns: dict[str, pa.Array] = {}
    manifest: list[dict[str, Any]] = []

    for name in data_order:
        declared = declared_dimensions[name]
        rows = projections_data.filter(pc.equal(name_column, pa.scalar(name)))
        identifiers = rows.column("identifier")
        # ``encode_v3`` has already added every projected identifier to part 1,
        # so only a null identifier can miss here.
        if identifiers.null_count:
            raise ValueError(f"projection '{name}' has null identifier(s)")
        positions = np.asarray(
            pc.index_in(identifiers, value_set=protein_ids).combine_chunks()
        )
        if np.unique(positions).size != positions.size:
            repeated = np.flatnonzero(np.bincount(positions, minlength=num_rows) > 1)
            raise ValueError(
                f"projection '{name}' has more than one row for "
                f"{repeated.size} identifier(s): "
                f"{protein_ids.take(pa.array(repeated[:5])).to_pylist()}"
            )

        z = rows.column("z") if has_z else None
        # A finite z, not merely a non-null one: a float z filled with NaN has no
        # nulls, and the legacy readers (``conversion.ts`` and ``ArrowReader``)
        # draw such rows in 2D, so it must not become an all-missing 3D axis.
        z_present = (
            z is not None
            and not pa.types.is_null(z.type)
            and bool(
                np.isfinite(z.to_numpy(zero_copy_only=False).astype(np.float64)).any()
            )
        )
        # The data decides, as in the browser's legacy reader: metadata claiming
        # 3D over missing z would write an all-missing z axis, and metadata
        # claiming 2D over real z would drop it.
        dimension = 3 if z_present else 2
        if declared is not None and _as_dimension(declared) != dimension:
            logger.warning(
                f"projection '{name}': metadata declares dimensions={declared!r} "
                f"but its data is {dimension}D; writing it as {dimension}D"
            )

        for axis in ("x", "y", "z")[:dimension]:
            # NaN, never 0.0, for a protein absent from this projection: the
            # origin is a real coordinate, and a missing point must not be drawn.
            values = np.full(num_rows, np.nan, dtype=np.float32)
            values[positions] = (
                rows.column(axis).to_numpy(zero_copy_only=False).astype(np.float32)
            )
            columns[f"{name}__{axis}"] = pa.array(values, type=pa.float32())
        manifest.append({"name": name, "dimension": dimension})

    return _required_table(columns), manifest


def _as_dimension(value: Any) -> int | None:
    """A declared ``dimensions`` value as an int, ``None`` if it is not one.

    Parquet may hand the dimension back as ``"3"`` or a numpy int.
    """
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def _with_manifest_dimensions(
    projections_metadata: pa.Table, projections: list[dict[str, Any]]
) -> pa.Table:
    """Part 2 with its ``dimensions`` column agreeing with the manifest.

    The manifest's dimension comes from the data (:func:`_encode_projections`),
    so a stale declared value is rewritten rather than left for a reader of
    part 2 to trip over.  A table that already agrees -- ``"3"`` agrees with
    3 -- or has no ``dimensions`` column is returned as it is.  A rewritten
    column keeps its integer type, and becomes ``int64`` when it was not one.
    """
    if "dimensions" not in projections_metadata.column_names:
        return projections_metadata
    derived = {p["name"]: int(p["dimension"]) for p in projections}
    names = projections_metadata.column("projection_name").to_pylist()
    declared = projections_metadata.column("dimensions").to_pylist()
    wanted = [
        derived.get(name, _as_dimension(value))
        for name, value in zip(names, declared, strict=True)
    ]
    if all(_as_dimension(d) == w for d, w in zip(declared, wanted, strict=True)):
        return projections_metadata

    index = projections_metadata.schema.get_field_index("dimensions")
    old_type = projections_metadata.schema.field(index).type
    new_type = old_type if pa.types.is_integer(old_type) else pa.int64()
    return projections_metadata.set_column(
        index, pa.field("dimensions", new_type), pa.array(wanted, type=new_type)
    )


def _add_unannotated_rows(
    annotations: pa.Table, id_column: str, projected: pa.Array | None
) -> pa.Table:
    """Append an all-missing annotations row per ``projected`` identifier it lacks.

    The legacy browser reader showed such a protein with N/A for every
    annotation, so the encoder keeps it rather than refusing the bundle.
    """
    if projected is None:
        return annotations  # ``_encode_projections`` names the missing column
    known = _as_string(annotations.column(id_column))
    absent = projected.filter(pc.invert(pc.is_in(_as_string(projected), known)))
    if not len(absent):
        return annotations

    logger.warning(
        f"{len(absent)} projected identifier(s) have no annotations row, e.g. "
        f"{absent[:5].to_pylist()}; adding them with every annotation missing"
    )
    extra = pa.table(
        [
            pc.cast(absent, field.type)
            if field.name == id_column
            else pa.nulls(len(absent), field.type)
            for field in annotations.schema
        ],
        schema=annotations.schema,
    )
    return pa.concat_tables([annotations, extra])


def _require_v2_grammar(annotations: pa.Table) -> None:
    """Refuse a table whose cells are not declared to be in the v2 grammar.

    An unstamped table is refused rather than read as v1: a v2 table that lost
    its stamp (``rename_columns`` drops it) looks exactly like a legacy one, and
    migrating it escapes every reserved character a second time, unrecoverably.
    """
    if not has_format_version(annotations):
        raise ValueError(
            "annotations table carries no protspace_format_version stamp, so its "
            "cell grammar is unknown. Stamp v2 cells with stamp_format_version(); "
            "migrate v1 (legacy) cells with migrate_legacy_annotation_table() or "
            "upgrade_cell_grammar(table, 1) first."
        )
    version = read_format_version(annotations)
    if version != BUNDLE_FORMAT_VERSION:
        raise ValueError(
            f"annotations table declares cell grammar v{version}; the v3 encoder "
            f"takes v{BUNDLE_FORMAT_VERSION} cells. Migrate a v1 table with "
            "migrate_legacy_annotation_table() first."
        )


def _prepare_annotations(
    annotations: pa.Table, projected: pa.Array | None
) -> tuple[pa.Table, str, pa.Array]:
    """Check the grammar stamp, add the ``projected`` rows it lacks, validate ids.

    The rows come back in the protein order the v2 browser built: ``projected``
    (the projection identifiers in order of first appearance) first, then the
    proteins no projection names, in their own order.  Part 1's row order is
    what breaks frequency ties in every label dictionary, here and in the
    browser's re-rank, so an annotations table sorted differently from its
    projections (a user's table given to ``bundle -a``, say) still gets the
    legend order, colours and dataset hash v2 gave it.

    Returns ``(annotations, id_column, ids)`` with ``ids`` as a string array.
    """
    _require_v2_grammar(annotations)

    id_column = next(
        (c for c in ("protein_id", "identifier") if c in annotations.column_names), None
    )
    if id_column is None:
        raise ValueError(
            "annotations table has no 'protein_id' or 'identifier' column; "
            f"found {annotations.column_names}"
        )

    annotations = _add_unannotated_rows(annotations, id_column, projected)
    ids = _as_string(annotations.column(id_column))
    if ids.null_count:
        raise ValueError(f"annotations column '{id_column}' contains null values")
    duplicated = pc.sum(pc.greater(pc.value_counts(ids).field("counts"), 1)).as_py()
    if duplicated:
        raise ValueError(
            f"annotations column '{id_column}' contains {duplicated} duplicated value(s); "
            "protein identifiers must be unique"
        )

    if projected is not None and len(projected):
        # Every projected id is a row by now (``_add_unannotated_rows``).
        placed = np.asarray(pc.index_in(_as_string(projected), value_set=ids))
        order = np.concatenate(
            [placed, np.setdiff1d(np.arange(len(ids)), placed, assume_unique=True)]
        )
        if (order != np.arange(len(ids))).any():
            indices = pa.array(order)
            annotations, ids = annotations.take(indices), ids.take(indices)
    return annotations, id_column, ids


def _encode_part1(
    annotations: pa.Table,
    id_column: str,
    ids: pa.Array,
    projection_manifest: list[dict[str, Any]],
    placed: np.ndarray | None = None,
    numeric: dict[str, str] | None = None,
) -> tuple[bytes, bytes]:
    """Encode the annotation columns as part 1 (manifest in its footer) and part 6.

    ``placed`` and ``numeric`` (per column, ``"infer"`` when absent) are as for
    :func:`_encode_annotation_column`.
    """
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
            annotations.column(name),
            name,
            num_rows,
            evidence_dict,
            placed=placed,
            numeric=(numeric or {}).get(name, "infer"),
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

    manifest = {
        "idColumn": id_column,
        "columns": manifest_columns,
        "projections": projection_manifest,
    }
    # The grammar stamp stays behind: a v3 part 1 has no cells to parse, and the
    # container key alone says how to read it.
    metadata = {
        **{
            k: v
            for k, v in (annotations.schema.metadata or {}).items()
            if k not in _FORMAT_KEYS
        },
        CONTAINER_VERSION_KEY: str(CONTAINER_VERSION).encode(),
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
    return _write(_required_table(columns, metadata)), _write(payload_table)


def encode_v3(
    annotations: pa.Table,
    projections_metadata: pa.Table,
    projections_data: pa.Table,
) -> tuple[bytes, bytes, bytes, bytes]:
    """Encode the v2-shaped pipeline tables as v3 parts 1, 2, 3 and 6.

    ``annotations`` must be stamped as v2 cell grammar; an unstamped or v1 table
    raises ``ValueError`` instead of being migrated on a guess (see
    :func:`~protspace.data.annotations.encoding.migrate_legacy_annotation_table`).
    """
    projected = (
        pc.unique(projections_data.column("identifier")).drop_null()
        if "identifier" in projections_data.column_names
        else None
    )
    annotations, id_column, ids = _prepare_annotations(annotations, projected)
    projections_table, projection_manifest = _encode_projections(
        projections_metadata, projections_data, ids
    )
    part1, payloads = _encode_part1(
        annotations,
        id_column,
        ids,
        projection_manifest,
        _placed_rows(projections_table, projection_manifest),
    )
    part2 = _write(_with_manifest_dimensions(projections_metadata, projection_manifest))
    return part1, part2, _write(projections_table), payloads


# --------------------------------------------------------------------------- #
# decoder
# --------------------------------------------------------------------------- #


def _read_manifest(part1: bytes) -> tuple[dict[str, Any], dict[bytes, bytes]]:
    """Part 1's manifest and the rest of its footer metadata, without the columns.

    The rest leaves out the codec's own keys, so a decoded table carries neither
    the container version nor a stale manifest.
    """
    metadata = dict(pq.read_schema(io.BytesIO(part1)).metadata or {})
    raw_manifest = metadata.get(MANIFEST_KEY)
    metadata = {k: v for k, v in metadata.items() if k not in _FORMAT_KEYS}
    if raw_manifest is None:
        raise ValueError(
            f"annotations part carries no {MANIFEST_KEY.decode()} key; "
            "it is not a v3 part"
        )
    return json.loads(raw_manifest), metadata


def _axes(projection: dict[str, Any]) -> tuple[str, ...]:
    return ("x", "y", "z")[: int(projection["dimension"])]


def _finite_rows(wide: pa.Table, projection: dict[str, Any]) -> np.ndarray:
    """Rows that ``projection`` covers: every axis finite (NaN means not covered)."""
    name = projection["name"]
    return np.logical_and.reduce(
        [
            np.isfinite(
                _flat(wide.column(f"{name}__{axis}")).to_numpy(zero_copy_only=False)
            )
            for axis in _axes(projection)
        ]
    )


def _placed_rows(wide: pa.Table, projections: list[dict[str, Any]]) -> np.ndarray:
    """Rows some projection covers: the proteins the browser shows."""
    placed = np.zeros(wide.num_rows, dtype=bool)
    for projection in projections:
        placed |= _finite_rows(wide, projection)
    return placed


def _read_payloads(part: bytes) -> dict[str, bytes]:
    table = read_part(part)
    return dict(
        zip(
            table.column("name").to_pylist(),
            table.column("data").to_pylist(),
            strict=True,
        )
    )


def _offsets(counts: np.ndarray, size: int, what: str, unit: str) -> np.ndarray:
    """Prefix-sum per-element ``counts`` into ``counts.size + 1`` offsets.

    A v3 bundle is user-supplied input, and counts that fall short of their
    buffer fail silently downstream (Python slicing clamps, so labels come out
    duplicated or empty; Arrow empties the tail lists), as does a negative count
    (misaligned), so the counts must tile all ``size`` elements exactly.
    """
    offsets = np.concatenate(([0], np.cumsum(counts, dtype=np.int64)))
    total = int(offsets[-1])
    if bool((counts < 0).any()) or total != size:
        raise ValueError(
            f"{what} is corrupt: {counts.size} count(s) totalling {total} over "
            f"{size} {unit}(s)"
        )
    return offsets


def _read_labels(payloads: dict[str, bytes], name: str) -> list[str]:
    """Slice ``dict:<name>`` by the prefix sum of its per-label byte lengths."""
    blob = payloads[f"dict:{name}"]
    lengths = np.frombuffer(payloads[f"dict:{name}:len"], "<i4")
    offsets = _offsets(lengths, len(blob), f"payload 'dict:{name}:len'", "byte")
    return [
        blob[start:end].decode()
        for start, end in zip(offsets[:-1], offsets[1:], strict=True)
    ]


def _list_join(
    counts: np.ndarray, values: pa.Array, separator: str, what: str
) -> pa.Array:
    """Join each run of ``counts`` consecutive ``values`` with ``separator``."""
    offsets = _offsets(counts, len(values), what, "value").astype(np.int32)
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

    # Only present cells are spelled.  ``str(2.0)`` is ``"2.0"`` but an int-typed
    # v2 column spells it ``"2"``, so int columns take the int64 detour, where
    # pyarrow's cast spells integers exactly as Python does.  Floats keep numpy's
    # repr, which is Python's: pyarrow spells them differently (``1e-7`` for
    # ``1e-07``, ``1e+15`` for ``1000000000000000.0``).  The magnitude guard keeps
    # a value past int64 out of an undefined cast, and it is per value: one 1e19
    # cell must not re-spell the whole column as floats.  So is the integral
    # check: ``numericType`` is decided over the placed proteins only, so an
    # annotation-only ``2.5`` can sit in an int column and must not become ``2``.
    kept = values[present]
    if entry.get("numericType") == "int":
        small = (np.abs(kept) < 2.0**63) & (np.mod(kept, 1) == 0)
        text = pc.cast(
            pa.array(np.where(small, kept, 0.0).astype(np.int64)), pa.string()
        )
        if not small.all():
            text = pc.replace_with_mask(
                text, pa.array(~small), pa.array(kept[~small].astype(str))
            )
    else:
        text = pa.array(kept.astype(str), type=pa.string())
    return pc.fill_null(text.take(pa.array(np.cumsum(present) - 1, mask=~present)), "")


def _decode_categorical(
    column: pa.ChunkedArray, labels: pa.Array, entry: dict[str, Any]
) -> pa.Array:
    """int32 codes back to label cells; ``-1`` (missing) becomes ``""``.

    A ``bool`` source column comes back as ``bool`` (missing as null) from its
    ``ARROW_BOOLEAN_LABELS``, as a v2 bundle's ``BOOLEAN`` column always read.
    """
    codes = _flat(column).to_numpy(zero_copy_only=False)
    cells = labels.take(pa.array(codes, mask=codes < 0))
    source_type = entry.get("sourceType")
    if source_type == "bool":
        return pc.equal(cells, pa.scalar(ARROW_BOOLEAN_LABELS[1]))
    # An integer column stored as exact labels (past float64's exact range).
    type_ = _restorable_type(source_type or _UNRESTORABLE_SOURCE_TYPE)
    if type_ is not None and pa.types.is_integer(type_):
        return pc.cast(cells, type_)
    return pc.fill_null(cells, "")


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
    """Wide float32 projections back to the long v2 table, in manifest order.

    Only proteins with finite coordinates get a row: NaN is how part 3 says a
    projection does not cover a protein.
    """
    wide = read_part(part)
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
        axes = {
            axis: _flat(wide.column(f"{name}__{axis}")) for axis in _axes(projection)
        }
        table = pa.table(
            {
                # ``take`` of a one-element array beats materialising N copies.
                "projection_name": pa.array([name], type=pa.string()).take(row),
                "identifier": identifiers,
                "x": axes["x"],
                "y": axes["y"],
                "z": axes.get("z", pa.nulls(num_rows, pa.float32())),
            },
            schema=schema,
        )
        finite = _finite_rows(wide, projection)
        tables.append(table if finite.all() else table.filter(pa.array(finite)))
    return pa.concat_tables(tables) if tables else schema.empty_table()


def decode_v3(parts: list[bytes]) -> tuple[pa.Table, pa.Table, pa.Table]:
    """Decode v3 parts back into the three v2-shaped tables.

    ``parts`` is what :func:`encode_v3` returned: annotations, projections
    metadata, wide projections, payloads (bundle parts 1, 2, 3 and 6).  The
    annotations come back stamped ``protspace_format_version=2``, because what
    comes back *is* the v2 cell grammar every Python consumer parses, and without
    the container key, because they are no longer a v3 part.

    The round trip is not byte-exact, and deliberately so -- v3 stores what the
    browser's v2 reader would have parsed out of the cells, not the cells:

    * a v1 table has to be migrated to the v2 cell grammar before it can be
      encoded, which is what converting a legacy bundle does: all but one of the
      datasets under ``apps/web/public/data/`` were v1 before ``protspace
      convert`` rewrote them, so converting one runs
      :func:`migrate_legacy_annotation_table` and its reserved characters come
      back percent-encoded (display-neutral, and a fix -- but it is a
      difference, and it is the one a conversion actually hits);
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
    * a ``bool`` column comes back ``bool``, but it is *stored* as the labels
      ``true``/``false`` (what the browser always displayed for it);
    * the rows come back in the order the v2 browser listed the proteins: by
      first appearance in the projection rows, then the proteins no projection
      covers, in the order the table gave them;
    * a projected identifier the annotations table lacked comes back as a row
      whose every annotation is missing;
    * a projection's dimension comes from its data (non-null ``z`` means 3D),
      whatever the metadata's ``dimensions`` said, and the returned metadata's
      ``dimensions`` column says the same (the encoder already rewrote part 2;
      the manifest wins over a part 2 written by anything else);
    * projection coordinates come back float32 (``z`` null for a 2D projection),
      and only proteins with finite coordinates get a row: a protein absent from
      a projection, or whose coordinates there were non-finite, has none (the
      file stores NaN for it, never the origin);
    * the identifier column comes back first, wherever it sat before.
    """
    if len(parts) != 4:
        raise ValueError(
            f"decode_v3 expects the 4 parts encode_v3 returns, got {len(parts)}"
        )

    manifest, metadata = _read_manifest(parts[0])
    annotations = read_part(parts[0])
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
            columns[name] = _decode_categorical(annotations.column(name), labels, entry)
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
        _with_manifest_dimensions(read_part(parts[1]), manifest["projections"]),
        _decode_projections(parts[2], manifest["projections"], columns[id_column]),
    )


# --------------------------------------------------------------------------- #
# replacing the annotations of an encoded core
# --------------------------------------------------------------------------- #


def replace_annotations_v3(
    annotations: pa.Table, parts: list[bytes]
) -> tuple[bytes, bytes, bytes, bytes]:
    """:func:`encode_v3` for new ``annotations`` over an existing v3 core.

    ``parts`` are v3 parts 1, 2, 3 and 6.  The projections stay wide: part 3 is
    realigned to the new rows instead of being decoded to the long table and
    pivoted back, part 2 is kept as stored, and none of the old annotation
    columns are decoded.  The result is what the decode-then-encode round trip
    writes: a protein with finite coordinates the new table lacks is added back
    as an all-missing row, and a new protein gets NaN.

    A column the old part 1 stores as labels (``categorical`` or ``multi``)
    stays labels.  Its decoded cells are text, and some label columns decode to
    cells that all look numeric -- a list of one number per cell, or ``1;``
    whose blank hit was dropped -- which numeric inference would turn into a
    gradient.  ``protspace transfer`` hands every column back this way, not
    only the ones it adds.  One marked ``placedNumeric`` keeps that mark while
    its placed proteins' cells are still numbers.
    """
    manifest, _metadata = _read_manifest(parts[0])
    projections = manifest["projections"]
    old_ids = _flat(read_part(parts[0], columns=[manifest["idColumn"]]).column(0))
    wide = read_part(parts[2])

    finite = [_finite_rows(wide, projection) for projection in projections]
    # In the order the long table lists them, which is the order they are added.
    projected = pc.unique(
        pa.chunked_array(
            [old_ids.filter(pa.array(rows)) for rows in finite], type=old_ids.type
        )
    )
    annotations, id_column, ids = _prepare_annotations(annotations, projected)
    position = np.asarray(pc.fill_null(pc.index_in(ids, value_set=old_ids), -1))
    new = np.flatnonzero(position >= 0)
    old = position[new]

    columns: dict[str, pa.Array] = {}
    for projection, rows in zip(projections, finite, strict=True):
        # A row with any non-finite axis is dropped by the decoder, so every axis
        # of it goes missing here, as the round trip would have written it.
        keep = rows[old]
        for axis in _axes(projection):
            column = f"{projection['name']}__{axis}"
            values = np.full(len(ids), np.nan, dtype=np.float32)
            values[new[keep]] = _flat(wide.column(column)).to_numpy(
                zero_copy_only=False
            )[old[keep]]
            columns[column] = pa.array(values, type=pa.float32())

    realigned = _required_table(columns)
    numeric = {
        name: "placed" if entry.get("placedNumeric") else "never"
        for name, entry in manifest["columns"].items()
        if entry["kind"] in ("categorical", "multi")
    }
    part1, payloads = _encode_part1(
        annotations,
        id_column,
        ids,
        projections,
        _placed_rows(realigned, projections),
        numeric,
    )
    return part1, parts[1], _write(realigned), payloads
