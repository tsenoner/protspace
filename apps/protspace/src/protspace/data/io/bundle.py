"""Centralized parquetbundle I/O operations.

A .parquetbundle file concatenates multiple parquet files separated by a
delimiter.  The first three parts are the core data tables; an optional
fourth part carries settings (annotation colours, shapes, etc.); an optional
fifth part carries projection statistics.

Positional layout: ``core(3) + settings? + statistics?`` for a legacy (v1/v2)
container, and always ``core(3) + settings + statistics + payloads`` for v3.
When statistics are present but settings are absent, the fourth part is written
as **zero bytes** so the statistics part is unambiguously the fifth — readers
and writers branch on the fourth part's emptiness, not on the raw part count.
A v3 container writes both of those slots unconditionally (zero bytes when
absent) because the browser reads its payload part positionally, from
``parts[5]``.

v3 is a *container-boundary* encoding: :func:`write_bundle` takes the v2-shaped
tables the pipeline already builds and emits v3 parts, and every read here
(:func:`read_tables`, :func:`read_bundle`, :func:`extract_bundle_to_dir`) hands
back v2-shaped tables again, so nothing above this module has to know.  See
:mod:`protspace.data.io.bundle_v3`.

Reading a legacy container is deprecated: every public *read* of one logs a
single warning pointing at ``protspace convert`` (:func:`convert_bundle`), and
support is removed in protspace 5.0.0.  The writers here read their input
silently -- they emit v3, or (``replace_settings_in_bundle``) keep the parts
byte for byte -- so a command that reads and then rewrites a bundle warns once.
"""

import io
import json
import logging
import tempfile
from pathlib import Path

import pyarrow as pa
import pyarrow.parquet as pq

from protspace.data.annotations.encoding import (
    migrate_legacy_annotation_table,
    read_format_version,
    stamp_format_version,
)
from protspace.data.io.atomic import atomic_write_bytes
from protspace.data.io.bundle_v3 import (
    CONTAINER_VERSION,
    decode_v3,
    encode_v3,
    replace_annotations_v3,
)

logger = logging.getLogger(__name__)

PARQUET_BUNDLE_DELIMITER = b"---PARQUET_DELIMITER---"

CORE_FILENAMES = [
    "selected_annotations.parquet",
    "projections_metadata.parquet",
    "projections_data.parquet",
]

SETTINGS_FILENAME = "settings.parquet"
STATISTICS_FILENAME = "statistics.parquet"

#: The release that drops reading v1/v2 containers.
LEGACY_REMOVAL_VERSION = "5.0.0"


def _part_container_version(part: bytes) -> int:
    """The ``protspace_format_version`` in a part's parquet footer (1 if absent).

    Every six-part read parses part 1's footer, including the settings-only
    :func:`read_settings_from_bundle`, so a corrupt part 1 has to fail as a
    bundle error and not as a raw ``ArrowInvalid`` traceback out of
    ``protspace style --dump-settings``.
    """
    try:
        schema = pq.read_schema(io.BytesIO(part))
    except pa.ArrowInvalid as exc:
        raise ValueError(
            f"parquetbundle part 1 is not readable as parquet: {exc}"
        ) from exc
    return read_format_version(schema)


def _split(data: bytes) -> tuple[list[bytes], bytes | None, bytes | None, bytes | None]:
    """Split raw bundle bytes → ``(core_parts, settings, statistics, payloads)``.

    Six parts is v3 and the part-1 footer has to say so; three to five parts is a
    legacy container, which has no payloads.  The optional parts are normalised
    (the zero-byte settings sentinel and an absent/empty statistics part both
    become ``None``), so callers never branch on the raw part count.
    """
    parts = data.split(PARQUET_BUNDLE_DELIMITER)

    if len(parts) < 3 or len(parts) > 6:
        raise ValueError(f"Expected 3 to 6 parts in parquetbundle, found {len(parts)}")

    payloads = None
    if len(parts) == 6:
        version = _part_container_version(parts[0])
        if version != CONTAINER_VERSION:
            raise ValueError(
                f"6-part parquetbundle declares container version {version}, "
                f"expected {CONTAINER_VERSION}"
            )
        payloads = parts[5]

    settings = parts[3] if len(parts) >= 4 and parts[3] else None
    statistics = parts[4] if len(parts) >= 5 and parts[4] else None
    return parts[:3], settings, statistics, payloads


def _parse_bundle(
    source: Path | str | bytes, *, warn_legacy: bool = True
) -> tuple[list[bytes], bytes | None, bytes | None, bytes | None]:
    """:func:`_split` over a file or raw bytes: the single place a read is decoded.

    Logs the legacy-format deprecation warning, once per call, unless
    ``warn_legacy`` is false (the writers and :func:`convert_bundle`).
    """
    data = source if isinstance(source, bytes) else Path(source).read_bytes()
    parsed = _split(data)
    if warn_legacy and parsed[3] is None:
        name = "This parquetbundle" if isinstance(source, bytes) else str(source)
        logger.warning(
            "%s uses the v1/v2 parquetbundle format. Reading v1/v2 bundles is "
            "deprecated and will be removed in protspace %s; run `protspace convert` "
            "to rewrite it as v3 (or re-export it from protspace.app).",
            name,
            LEGACY_REMOVAL_VERSION,
        )
    return parsed


def _core_tables(
    core: list[bytes], payloads: bytes | None
) -> tuple[pa.Table, pa.Table, pa.Table]:
    """The three core tables in their v2 shape, from :func:`_split`'s output."""
    if payloads is not None:
        return decode_v3([*core, payloads])
    annotations, metadata, projections = (pq.read_table(io.BytesIO(p)) for p in core)
    return annotations, metadata, projections


def _table_to_parquet_bytes(table: pa.Table) -> bytes:
    """Serialize an Arrow table to in-memory parquet bytes."""
    buf = io.BytesIO()
    pq.write_table(table, buf)
    return buf.getvalue()


def _check_no_delimiter(part_bytes: bytes) -> None:
    """Guard: a serialized part must not contain the bundle delimiter.

    If a value (e.g. an annotation string) happens to contain the reserved
    delimiter byte string, the part split on read-back would be corrupted; fail
    loudly at write time instead.
    """
    if PARQUET_BUNDLE_DELIMITER in part_bytes:
        raise ValueError(
            "Serialized parquet part contains the bundle delimiter "
            f"{PARQUET_BUNDLE_DELIMITER!r}; a value includes this reserved byte "
            "string and would corrupt the bundle on read."
        )


def _write_parts(
    path: Path,
    core: list[bytes],
    settings: bytes | None = None,
    statistics: bytes | None = None,
    payloads: bytes | None = None,
) -> None:
    """Assemble and atomically write one container from its already-serialized parts.

    The single writer for every bundle this module produces.  A v3 container
    (``payloads`` given) always emits **six** slots: the browser reads the
    payloads from ``parts[5]`` positionally, so omitting an absent settings or
    statistics part would file the payloads under statistics and the reader would
    report no payloads part.  A legacy container keeps the old trailing-optional
    layout.  Every part, part 6 included, is checked for the delimiter — a label
    carrying those bytes would corrupt the split on read-back.
    """
    if len(core) != 3:
        raise ValueError(f"a parquetbundle needs exactly 3 core parts, got {len(core)}")

    if payloads is not None:
        parts = [*core, settings or b"", statistics or b"", payloads]
    else:
        parts = list(core)
        if settings is not None or statistics is not None:
            parts.append(settings if settings is not None else b"")
        if statistics is not None:
            parts.append(statistics)

    for part in parts:
        _check_no_delimiter(part)

    atomic_write_bytes(path, PARQUET_BUNDLE_DELIMITER.join(parts))


def read_tables(
    path_or_bytes: Path | str | bytes,
) -> tuple[pa.Table, pa.Table, pa.Table]:
    """Read a bundle's three core tables in their v2 shape.

    A v3 container is decoded (all-string annotation cells, long-format
    projections, footer re-stamped ``protspace_format_version=2``); a legacy
    container's parts are read as they are, so a v1 bundle stays v1-stamped and
    is never silently migrated.
    """
    core, _settings, _statistics, payloads = _parse_bundle(path_or_bytes)
    return _core_tables(core, payloads)


def extract_bundle_to_dir(bundle_path: Path, target_dir: Path | None = None) -> str:
    """Extract a .parquetbundle into separate parquet files on disk.

    Supports legacy bundles with 3 parts (core data only), 4 parts (core +
    settings) or 5 parts (core + settings + statistics, where the settings part
    may be zero bytes), and 6-part v3 bundles — whose core is decoded back to the
    v2 shape so everything downstream reads the files it always did.

    Args:
        bundle_path: Path to the .parquetbundle file.
        target_dir: Directory to write into.  A temporary directory is created
            when *None*.

    Returns:
        Path (as string) to the directory containing the extracted files.
    """
    if target_dir is None:
        target_dir = Path(tempfile.mkdtemp(prefix="protspace_bundle_"))
    else:
        target_dir = Path(target_dir)
        target_dir.mkdir(parents=True, exist_ok=True)

    core, settings, statistics, payloads = _parse_bundle(bundle_path)

    if payloads is not None:
        for table, filename in zip(
            decode_v3([*core, payloads]), CORE_FILENAMES, strict=True
        ):
            pq.write_table(table, str(target_dir / filename))
    else:
        for part_bytes, filename in zip(core, CORE_FILENAMES, strict=False):
            if part_bytes:
                (target_dir / filename).write_bytes(part_bytes)
    if settings:
        (target_dir / SETTINGS_FILENAME).write_bytes(settings)
    if statistics:
        (target_dir / STATISTICS_FILENAME).write_bytes(statistics)

    return str(target_dir)


def read_bundle(bundle_path: Path) -> tuple[list[bytes], dict | None]:
    """Read a bundle and return v2-shaped core part bytes plus parsed settings.

    The return shape is preserved (``(core_parts, settings)``) so existing
    callers keep working; use :func:`read_statistics_from_bundle` for the
    optional statistics part.  A v3 container is decoded and re-serialized, so
    the parts callers ``pq.read_table`` are always the v2 shape — prefer
    :func:`read_tables` when you want the tables themselves and not the bytes.

    Returns:
        (core_parts_bytes, settings_dict_or_None)
    """
    core, settings_bytes, _statistics, payloads = _parse_bundle(bundle_path)
    if payloads is not None:
        core = [_table_to_parquet_bytes(t) for t in decode_v3([*core, payloads])]
    settings = read_settings_from_bytes(settings_bytes) if settings_bytes else None
    return core, settings


def read_settings_from_bundle(bundle_path: Path) -> dict | None:
    """Return the parsed settings (fourth part), or None if absent.

    The settings-only read: unlike :func:`read_bundle` it never touches the
    core, so ``protspace style`` no longer pays a full v3 decode plus
    re-serialization of every annotation column just to look at a JSON blob.
    """
    settings = _parse_bundle(bundle_path)[1]
    return read_settings_from_bytes(settings) if settings else None


def read_statistics_from_bundle(bundle_path: Path) -> bytes | None:
    """Return the raw statistics parquet bytes (fifth part), or None if absent."""
    return _parse_bundle(bundle_path)[2]


def write_bundle(
    tables: list[pa.Table],
    bundle_path: Path,
    settings: dict | None = None,
    statistics: "pa.Table | None" = None,
) -> None:
    """Write Arrow tables (and optional settings/statistics) to a .parquetbundle.

    The tables come in v2-shaped (all-string annotation cells, long-format
    projections) and go out as a six-part v3 container.

    **Precondition: ``tables[0]`` must carry the format-version stamp** unless it
    really is v1.  An unstamped table reads back as v1 (:func:`read_format_version`
    defaults it), so :func:`~protspace.data.io.bundle_v3.encode_v3` migrates it --
    and migrating an already-v2 table double-escapes every reserved character
    (``%3B`` becomes ``%253B``), unrecoverably, because ``decode_field`` is not
    its own inverse.  pyarrow drops schema metadata on ``rename_columns``,
    ``concat_tables`` and friends, so a caller that rebuilds the table must
    re-apply :func:`~protspace.data.annotations.encoding.stamp_format_version`
    afterwards, as ``cli/bundle.py`` does.  ``encode_v3`` warns instead of
    refusing, and this function cannot stamp for its callers the way
    :func:`replace_annotations_in_bundle` does: it is also the path a genuine
    legacy bundle is upgraded through, and there the unstamped table really is
    v1.

    Args:
        tables: List of 3 Arrow tables (annotations, projections_metadata,
            projections_data).
        bundle_path: Output file path.
        settings: Optional settings dict to include as 4th part.
        statistics: Optional projection-statistics Arrow table to include as the
            5th part.  A zero-byte slot is written for whichever of the two is
            absent, so the v3 payloads part stays at position six.
    """
    if len(tables) != 3:
        raise ValueError(
            f"write_bundle expects 3 core tables (annotations, projections_metadata, "
            f"projections_data), got {len(tables)}"
        )

    annotations, projections_metadata, projections_data = tables
    part1, part2, part3, payloads = encode_v3(
        annotations, projections_metadata, projections_data
    )

    _write_parts(
        bundle_path,
        [part1, part2, part3],
        create_settings_parquet(settings) if settings is not None else None,
        _table_to_parquet_bytes(statistics) if statistics is not None else None,
        payloads,
    )
    logger.info(f"Saved bundled output to: {bundle_path}")


def replace_settings_in_bundle(
    input_path: Path,
    output_path: Path,
    settings: dict,
) -> None:
    """Append or replace the settings (4th) part in a bundle.

    Every other part is preserved byte-for-byte, so a legacy bundle stays legacy
    and a v3 bundle keeps its payloads; an existing statistics part survives, so
    styling a statistics-bearing bundle is non-lossy.
    """
    core, _settings, statistics, payloads = _parse_bundle(input_path, warn_legacy=False)
    _write_parts(
        output_path, core, create_settings_parquet(settings), statistics, payloads
    )


def replace_annotations_in_bundle(
    input_path: Path,
    output_path: Path,
    annotations_table: pa.Table,
) -> None:
    """Replace the annotations (1st) part of a bundle, preserving the rest.

    Part 1 and the payloads part are re-encoded together, because the payloads
    hold the label dictionaries and CSR buffers *for* part 1.  A v3 input keeps
    its projections as stored (realigned to the new rows, never re-pivoted);
    settings and statistics are carried over unchanged.  A legacy input
    container comes out as v3, which is correct — this is a write, and every
    write emits v3.
    """
    core, settings, statistics, payloads = _parse_bundle(input_path, warn_legacy=False)

    # Re-stamp the format version at this single annotations-write chokepoint.
    # pyarrow table ops (rename_columns, concat) drop schema metadata, and
    # callers (transfer, prediction overlay) build the replacement table from
    # exactly such ops — so without this the stamp is silently lost and the
    # encoder would migrate an already-v2 table a second time, double-escaping
    # every reserved character. Callers must provide v2-safe cells; transfer
    # explicitly migrates legacy v1 categorical grammar before this boundary.
    annotations_table = stamp_format_version(annotations_table)

    if payloads is not None:
        parts = replace_annotations_v3(annotations_table, [*core, payloads])
    else:
        metadata, projections = (pq.read_table(io.BytesIO(p)) for p in core[1:])
        parts = encode_v3(annotations_table, metadata, projections)

    _write_parts(output_path, list(parts[:3]), settings, statistics, parts[3])

    logger.info(f"Wrote bundle with updated annotations to: {output_path}")


def convert_bundle(input_path: Path, output_path: Path) -> int:
    """Rewrite a v1/v2 bundle as v3 and return the input's format version.

    A v1 annotations table is migrated to the v2 cell grammar first, exactly as
    ``protspace transfer`` does, so it is not double-escaped and ``encode_v3``
    does not warn about it.  Settings and statistics are carried over as stored
    bytes.  A v3 input returns :data:`CONTAINER_VERSION` and nothing is written.
    ``output_path`` may be ``input_path``: the write is atomic.
    """
    core, settings, statistics, payloads = _parse_bundle(input_path, warn_legacy=False)
    if payloads is not None:
        return CONTAINER_VERSION

    annotations, projections_metadata, projections_data = _core_tables(core, None)
    version = read_format_version(annotations)
    part1, part2, part3, payloads = encode_v3(
        migrate_legacy_annotation_table(annotations),
        projections_metadata,
        projections_data,
    )
    _write_parts(output_path, [part1, part2, part3], settings, statistics, payloads)
    return version


def create_settings_parquet(settings_dict: dict) -> bytes:
    """Serialize a settings dict into parquet bytes.

    The parquet file contains a single column ``settings_json`` with one row
    holding the JSON-encoded settings string.
    """
    settings_json = json.dumps(settings_dict)
    return _table_to_parquet_bytes(pa.table({"settings_json": [settings_json]}))


def read_settings_from_bytes(data: bytes) -> dict:
    """Deserialize settings parquet bytes into a dict."""
    table = pq.read_table(io.BytesIO(data))
    settings_json = table.column("settings_json")[0].as_py()
    return json.loads(settings_json)


def read_settings_from_file(path: Path) -> dict:
    """Read a settings.parquet file and return the settings dict."""
    return read_settings_from_bytes(Path(path).read_bytes())
