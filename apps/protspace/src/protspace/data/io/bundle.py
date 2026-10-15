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

What a bundle *is* comes from part 1's footer: ``protspace_container_version``
= 3 marks a v3 container, and its absence a legacy one, whose annotation cell
grammar is then ``protspace_format_version`` (1 when absent).  The part count
has to agree with the container key in both directions.

v3 is a *container-boundary* encoding: :func:`write_bundle` takes the v2-shaped
tables the pipeline already builds and emits v3 parts, and every read here
(:func:`read_tables`, :func:`read_bundle_contents`, :func:`read_bundle`,
:func:`extract_bundle_to_dir`) hands back v2-shaped tables again, so nothing above this module has to know.  See
:mod:`protspace.data.io.bundle_v3`.

Reading a legacy container is deprecated: every public *read* of one logs a
single warning pointing at ``protspace convert`` (:func:`convert_bundle`), and
support is removed in protspace 5.0.0.  The writers here read their input
silently and always emit v3 (``replace_settings_in_bundle`` keeps a v3 input's
parts byte for byte and upgrades a legacy one), so a command that reads and
then rewrites a bundle warns once.
"""

import io
import json
import logging
import shutil
import tempfile
from collections.abc import Sequence
from dataclasses import dataclass
from pathlib import Path

import pandas as pd
import pyarrow as pa
import pyarrow.compute as pc
import pyarrow.parquet as pq

from protspace.core.constants import is_missing_value
from protspace.data.annotations.encoding import (
    ARROW_BOOLEAN_LABELS,
    migrate_legacy_annotation_table,
    read_format_version,
    to_display_value,
)
from protspace.data.io.atomic import atomic_write_bytes, staged_write
from protspace.data.io.bundle_v3 import (
    CONTAINER_VERSION,
    CONTAINER_VERSION_KEY,
    decode_v3,
    encode_v3,
    manifest_projections,
    read_container_version,
    read_part,
    replace_annotations_v3,
    write_part,
)
from protspace.data.io.ids import (
    LEGACY_ID_COLUMN,
    PROTEIN_ID_COLUMN,
    id_column_by_name,
    with_protein_id,
)
from protspace.deprecations import (
    DEPRECATIONS,
    LEGACY_BUNDLE_READ,
    THREE_D_PROJECTION_READ,
    warn,
)

logger = logging.getLogger(__name__)

PARQUET_BUNDLE_DELIMITER = b"---PARQUET_DELIMITER---"

ANNOTATIONS_FILENAME = "selected_annotations.parquet"
PROJECTIONS_METADATA_FILENAME = "projections_metadata.parquet"
PROJECTIONS_DATA_FILENAME = "projections_data.parquet"

#: The three core tables of an unbundled directory, in bundle part order.
CORE_FILENAMES = [
    ANNOTATIONS_FILENAME,
    PROJECTIONS_METADATA_FILENAME,
    PROJECTIONS_DATA_FILENAME,
]

SETTINGS_FILENAME = "settings.parquet"
STATISTICS_FILENAME = "statistics.parquet"
#: Styles an older ``protspace style`` wrote to a directory; it wins over
#: settings.parquet on read, so every directory write removes it.
VISUALIZATION_STATE_FILENAME = "visualization_state.json"

#: The release that drops reading v1/v2 containers (registered in
#: ``protspace.deprecations``, which the release gate checks).
LEGACY_REMOVAL_VERSION = DEPRECATIONS[LEGACY_BUNDLE_READ].remove_in


def _part_container_version(part: bytes) -> int | None:
    """The ``protspace_container_version`` in a part's parquet footer, or ``None``.

    Every read parses part 1's footer, including the settings-only
    :func:`read_settings_from_bundle`, so a corrupt part 1 has to fail as a
    bundle error and not as a raw pyarrow traceback out of
    ``protspace style --dump-settings``.  pyarrow raises ``ArrowInvalid`` for a
    part that is not parquet at all, but a plain ``OSError`` (thrift) for a
    footer that ends in ``PAR1`` and cannot be deserialized.
    """
    try:
        schema = pq.read_schema(io.BytesIO(part))
    except (pa.ArrowInvalid, OSError) as exc:
        raise ValueError(
            f"parquetbundle part 1 is not readable as parquet: {exc}"
        ) from exc
    return read_container_version(schema)


def _split(data: bytes) -> tuple[list[bytes], bytes | None, bytes | None, bytes | None]:
    """Split raw bundle bytes → ``(core_parts, settings, statistics, payloads)``.

    Six parts is v3 and the part-1 footer has to say so with its container key;
    three to five parts is a legacy container, which has no payloads and must
    not carry that key.  The optional parts are normalised
    (the zero-byte settings sentinel and an absent/empty statistics part both
    become ``None``), so callers never branch on the raw part count.
    """
    parts = data.split(PARQUET_BUNDLE_DELIMITER)

    if len(parts) < 3 or len(parts) > 6:
        raise ValueError(f"Expected 3 to 6 parts in parquetbundle, found {len(parts)}")

    payloads = None
    version = _part_container_version(parts[0])
    key = CONTAINER_VERSION_KEY.decode()
    if len(parts) == 6:
        if version is None:
            raise ValueError(
                f"6-part parquetbundle carries no {key} in part 1's footer; "
                f"a v3 container declares {key}={CONTAINER_VERSION}"
            )
        if version != CONTAINER_VERSION:
            raise ValueError(
                f"6-part parquetbundle declares container version {version}, "
                f"expected {CONTAINER_VERSION}"
            )
        payloads = parts[5]
    elif version is not None:
        raise ValueError(
            f"{len(parts)}-part parquetbundle declares {key}={version}; "
            "a v3 container has 6 parts, a legacy one carries no container version"
        )

    settings = parts[3] if len(parts) >= 4 and parts[3] else None
    statistics = parts[4] if len(parts) >= 5 and parts[4] else None
    return parts[:3], settings, statistics, payloads


def _parse_bundle(
    source: Path | str | bytes, *, warn_legacy: bool = True, warn_3d: bool = False
) -> tuple[list[bytes], bytes | None, bytes | None, bytes | None]:
    """:func:`_split` over a file or raw bytes: the single place a read is decoded.

    Logs the legacy-format deprecation warning, once per call, unless
    ``warn_legacy`` is false (the writers and :func:`convert_bundle`), and with
    ``warn_3d`` the 3-D reading one when the bundle holds 3-D projections: a read
    of the projections passes it, a settings- or statistics-only read does not.
    """
    data = source if isinstance(source, bytes) else Path(source).read_bytes()
    parsed = _split(data)
    if warn_legacy and parsed[3] is None:
        warn(LEGACY_BUNDLE_READ, logger, name=_source_name(source))
    if warn_3d:
        _warn_3d(source, parsed[0], parsed[3])
    return parsed


def _source_name(source: Path | str | bytes) -> str:
    return "This parquetbundle" if isinstance(source, bytes) else str(source)


def three_d_projection_names(projections: pa.Table) -> list[str]:
    """The projections of a v2-shaped projections table that are 3-D, in order.

    The data decides, as in the v3 encoder and the browser's legacy reader: a
    projection is 3-D when any of its rows has a finite ``z``.
    """
    if "z" not in projections.column_names or projections.num_rows == 0:
        return []
    z = projections.column("z")
    if pa.types.is_null(z.type):
        return []
    finite = pc.is_finite(pc.cast(z, pa.float64()))
    names = projections.column("projection_name").filter(pc.fill_null(finite, False))
    return list(dict.fromkeys(names.to_pylist()))


def _core_three_d_names(core: list[bytes], payloads: bytes | None) -> list[str]:
    """:func:`three_d_projection_names` straight from the parts: the manifest for
    v3 (a footer read), the ``projection_name``/``z`` columns of part 3 for v1/v2."""
    if payloads is not None:
        return [
            p["name"] for p in manifest_projections(core[0]) if int(p["dimension"]) == 3
        ]
    if not core[2]:
        return []
    schema = pq.read_schema(io.BytesIO(core[2]))
    if "z" not in schema.names or "projection_name" not in schema.names:
        return []
    return three_d_projection_names(read_part(core[2], ["projection_name", "z"]))


def _warn_3d(
    source: Path | str | bytes, core: list[bytes], payloads: bytes | None
) -> None:
    """Log the 3-D reading deprecation warning once for this read, if it applies."""
    names = _core_three_d_names(core, payloads)
    if names:
        warn(
            THREE_D_PROJECTION_READ,
            logger,
            name=_source_name(source),
            projections=", ".join(names),
        )


def _core_tables(
    core: list[bytes], payloads: bytes | None
) -> tuple[pa.Table, pa.Table, pa.Table]:
    """The three core tables in their v2 shape, from :func:`_split`'s output.

    A legacy container's tables are keyed on ``protein_id`` where they were keyed
    on ``identifier``, as a v3 decode keys them; nothing else is changed.
    """
    if payloads is not None:
        return decode_v3([*core, payloads])
    annotations, metadata, projections = (read_part(p) for p in core)
    return with_protein_id(annotations), metadata, with_protein_id(projections)


def _drop_internal_columns(annotations: pa.Table) -> pa.Table:
    """Remove the internal lookup columns from a bundle's annotations table.

    ``organism_id`` and ``sequence`` are fetched only to drive the taxonomy and
    sequence-based lookups; no bundle reader uses them, and in the web app they
    show up as meaningless near-unique categories. Schema metadata (the format
    stamp) is kept.
    """
    # Imported at call time: configuration imports every retriever, and the
    # annotation package imports data/io (manager), so a module-level import
    # would tie this module into that chain and break on the first retriever
    # that reads a bundle helper.
    from protspace.data.annotations.configuration import INTERNAL_ANNOTATIONS

    internal = [c for c in INTERNAL_ANNOTATIONS if c in annotations.column_names]
    if not internal:
        return annotations
    logger.debug(f"Dropping internal columns from the bundle: {internal}")
    return annotations.drop_columns(internal)


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
    *,
    payloads: bytes,
) -> None:
    """Assemble and atomically write one v3 container from its serialized parts.

    The single writer for every bundle this module produces; it only ever emits
    v3.  The container always has **six** slots: the browser reads the payloads
    from ``parts[5]`` positionally, so omitting an absent settings or statistics
    part would file the payloads under statistics and the reader would report no
    payloads part.  Every part, part 6 included, is checked for the delimiter — a
    label carrying those bytes would corrupt the split on read-back.
    """
    if len(core) != 3:
        raise ValueError(f"a parquetbundle needs exactly 3 core parts, got {len(core)}")

    parts = [*core, settings or b"", statistics or b"", payloads]

    for part in parts:
        _check_no_delimiter(part)

    atomic_write_bytes(path, PARQUET_BUNDLE_DELIMITER.join(parts))


def read_tables(
    path_or_bytes: Path | str | bytes,
    *,
    keyed: bool = False,
) -> tuple[pa.Table, pa.Table, pa.Table]:
    """Read a bundle's three core tables in their v2 shape.

    A v3 container is decoded (all-string annotation cells, long-format
    projections, stamped ``protspace_format_version=2``); a legacy
    container's parts are read as they are, so a v1 bundle stays v1-stamped and
    is never silently migrated.

    ``keyed=True`` is for a caller that rewrites the bundle: a legacy
    container's annotation rows are then keyed as the v2 browser keyed them, as
    ``convert`` and ``style`` key them (see
    :func:`_keyed_as_the_legacy_reader_keyed_it`), so the caller works on the
    dataset the browser showed and the v3 write accepts its ids.  The cells and
    the stamp are untouched.  A v3 container's ids are unique already.
    """
    core, _settings, _statistics, payloads = _parse_bundle(path_or_bytes, warn_3d=True)
    annotations, metadata, projections = _core_tables(core, payloads)
    if keyed and payloads is None:
        annotations = _keyed_as_the_legacy_reader_keyed_it(annotations)
    return annotations, metadata, projections


@dataclass(frozen=True)
class BundleContents:
    """Everything a bundle holds, as :func:`read_bundle_contents` reads it.

    The three core tables are v2-shaped whatever the container (see
    :func:`read_tables`); ``settings`` and ``statistics`` are ``None`` when the
    bundle has none. ``container_version`` is part 1's
    ``protspace_container_version`` (3), or ``None`` for a legacy container.
    """

    annotations: pa.Table
    metadata: pa.Table
    projections: pa.Table
    settings: dict | None = None
    statistics: pa.Table | None = None
    container_version: int | None = None


def read_bundle_contents(
    path_or_bytes: Path | str | bytes,
    *,
    warn_legacy: bool = True,
    warn_3d: bool = True,
) -> BundleContents:
    """Read every part of a bundle with one split and one decode.

    For a caller that needs more than the core tables (a verifier, a build that
    rewrites the settings), where :func:`read_tables`,
    :func:`read_settings_from_bundle` and :func:`read_statistics_from_bundle`
    would each split the file again. A legacy container is read as it is stored,
    never migrated. ``warn_legacy=False`` drops the deprecation warning, for a
    caller that reads legacy files on purpose (a pinned input); ``warn_3d=False``
    does the same for the 3-D projection warning.
    """
    core, settings, statistics, payloads = _parse_bundle(
        path_or_bytes, warn_legacy=warn_legacy, warn_3d=warn_3d
    )
    annotations, metadata, projections = _core_tables(core, payloads)
    return BundleContents(
        annotations=annotations,
        metadata=metadata,
        projections=projections,
        settings=read_settings_from_bytes(settings) if settings else None,
        statistics=read_part(statistics) if statistics else None,
        container_version=CONTAINER_VERSION if payloads is not None else None,
    )


def _table_cell(raw: str, decode: bool) -> str:
    """A text cell as the app's table export writes it: display values of its hits,
    joined with ``;``, leaving out each hit the app reads as missing (``N/A``,
    ``None``, blank, ...), so a missing cell is empty."""
    hits = (to_display_value(hit, decode=decode) for hit in raw.split(";"))
    return ";".join(hit for hit in hits if not is_missing_value(hit))


def read_bundle_table(
    path_or_bytes: Path | str | bytes, projections: Sequence[str] = ()
) -> pd.DataFrame:
    """A bundle as one table, one row per protein, as the app displays it.

    ``protein_id`` comes first, then ``<projection>_x`` / ``_y`` for each name
    in ``projections``, then every annotation column in bundle order.  Text cells are display values (score and
    evidence suffixes dropped, a v2 cell percent-decoded, hits joined with
    ``;``); numeric columns keep their numbers.  A protein a projection does not
    place gets missing coordinates.  The rows are those the web app shows for a
    legacy bundle too (see :func:`read_tables` ``keyed``).

    Raises ``ValueError`` for a projection name the bundle does not hold.
    """
    annotations, metadata, coordinates = read_tables(path_or_bytes, keyed=True)
    available = [str(name) for name in metadata.column("projection_name").to_pylist()]
    unknown = [name for name in projections if name not in available]
    if unknown:
        raise ValueError(
            f"no projection named {', '.join(map(repr, unknown))}; "
            f"the bundle holds {', '.join(map(repr, available)) or 'none'}"
        )

    decode = read_format_version(annotations) >= 2
    frame = annotations.to_pandas()
    ids = frame.pop(PROTEIN_ID_COLUMN).astype(str)
    false, true = ARROW_BOOLEAN_LABELS
    for field in annotations.schema:
        if field.name == PROTEIN_ID_COLUMN:
            continue
        if pa.types.is_string(field.type):
            # Map each distinct cell once: a large bundle repeats few labels.
            values = frame[field.name]
            shown = {v: _table_cell(v, decode) for v in values.dropna().unique()}
            frame[field.name] = values.map(shown)
        elif pa.types.is_boolean(field.type):
            # The labels the app shows a bool column under, not pandas' True/False.
            frame[field.name] = frame[field.name].map({False: false, True: true})
        elif pa.types.is_integer(field.type):
            # Whole numbers stay whole: pandas reads an integer column with a gap
            # as float64, which would write 1.0.
            frame[field.name] = frame[field.name].astype("Int64")

    table = pd.DataFrame({PROTEIN_ID_COLUMN: ids})
    if projections:
        # Only the projections asked for, and only the columns used, reach pandas.
        wanted = coordinates.filter(
            pc.is_in(
                coordinates.column("projection_name"),
                value_set=pa.array(list(projections), pa.string()),
            )
        ).select(["projection_name", PROTEIN_ID_COLUMN, "x", "y"])
        groups = dict(tuple(wanted.to_pandas().groupby("projection_name")))
        empty = wanted.slice(0, 0).to_pandas()
        for name in projections:  # in the order asked for
            placed = groups.get(name, empty).set_index(PROTEIN_ID_COLUMN)
            for axis in ("x", "y"):
                table[f"{name}_{axis}"] = ids.map(placed[axis]).to_numpy()
    return pd.concat([table, frame], axis=1)


def extract_bundle_to_dir(bundle_path: Path, target_dir: Path | None = None) -> str:
    """Extract a .parquetbundle into a directory (see :func:`write_directory`).

    A v3 core is decoded back to the v2 shape, so everything downstream reads
    the files it always did; a legacy bundle's parts are written with their
    stored values, keyed on ``protein_id`` where they were keyed on
    ``identifier`` (see :func:`~protspace.data.io.ids.with_protein_id`).

    Args:
        bundle_path: Path to the .parquetbundle file.
        target_dir: Directory to write into.  A temporary directory is created
            when *None*.

    Returns:
        Path (as string) to the directory containing the extracted files.
    """
    if target_dir is None:
        target_dir = Path(tempfile.mkdtemp(prefix="protspace_bundle_"))

    core, settings, statistics, payloads = _parse_bundle(bundle_path, warn_3d=True)
    if payloads is not None:
        parts = list(decode_v3([*core, payloads]))
    else:
        # Keyed on protein_id, as every directory is written: only a part whose
        # schema is keyed on `identifier` is decoded and rewritten, any other is
        # written as stored; an empty part writes no file.
        parts = [_keyed_part(part) for part in core]
    write_directory(
        parts,
        target_dir,
        settings=settings,
        statistics=statistics,
    )
    return str(target_dir)


def _keyed_part(part: bytes) -> pa.Table | bytes | None:
    """A legacy part as :func:`write_directory` takes it, keyed on ``protein_id``."""
    if not part:
        return None
    names = pq.read_schema(io.BytesIO(part)).names
    if id_column_by_name(names) != LEGACY_ID_COLUMN:
        return part
    return with_protein_id(read_part(part))


def write_directory(
    core_parts: list[pa.Table | bytes | None],
    target_dir: Path,
    *,
    settings: dict | bytes | None = None,
    statistics: pa.Table | bytes | None = None,
) -> None:
    """Write a bundle's parts as one parquet file each, atomically.

    Files are named per :data:`CORE_FILENAMES`, :data:`SETTINGS_FILENAME` and
    :data:`STATISTICS_FILENAME`.  A part is a table, or the parquet bytes to
    write as they are; a ``None`` part writes no file (``protspace project``
    has no annotations).  When settings are written, a
    :data:`VISUALIZATION_STATE_FILENAME` in *target_dir* is removed, since it
    would win over them on read.

    Args:
        core_parts: The three core parts, in bundle part order.
        target_dir: Directory to write into; created when missing.
        settings: A settings dict, or settings parquet bytes.
        statistics: The statistics table, or its parquet bytes.
    """
    if len(core_parts) != len(CORE_FILENAMES):
        raise ValueError(
            f"write_directory expects {len(CORE_FILENAMES)} core parts, "
            f"got {len(core_parts)}"
        )
    target_dir = Path(target_dir)
    target_dir.mkdir(parents=True, exist_ok=True)
    if isinstance(settings, dict):
        settings = create_settings_parquet(settings)
    names = [*CORE_FILENAMES, SETTINGS_FILENAME, STATISTICS_FILENAME]
    for part, name in zip([*core_parts, settings, statistics], names, strict=True):
        if part is not None:
            data = part if isinstance(part, bytes) else write_part(part)
            atomic_write_bytes(target_dir / name, data)
    if settings is not None:
        (target_dir / VISUALIZATION_STATE_FILENAME).unlink(missing_ok=True)


def replace_settings_in_directory(
    input_dir: Path, output_dir: Path, settings: dict
) -> None:
    """Write *settings* to a directory, keeping its other parts byte for byte.

    The directory counterpart of :func:`replace_settings_in_bundle`.  In place
    only the settings are written; into another directory the other parts are
    copied, and any the input lacks are removed, so the output holds one
    dataset.
    """
    input_dir, output_dir = Path(input_dir), Path(output_dir)
    if not (output_dir.exists() and output_dir.samefile(input_dir)):
        for name in [*CORE_FILENAMES, STATISTICS_FILENAME]:
            if (input_dir / name).exists():
                with staged_write(output_dir / name) as staged:
                    shutil.copyfile(input_dir / name, staged)
            else:
                (output_dir / name).unlink(missing_ok=True)
    write_directory([None] * len(CORE_FILENAMES), output_dir, settings=settings)


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
    core, settings_bytes, _statistics, payloads = _parse_bundle(
        bundle_path, warn_3d=True
    )
    if payloads is not None:
        core = [write_part(t) for t in decode_v3([*core, payloads])]
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

    **``tables[0]`` must be stamped as v2 cell grammar**; an unstamped or v1
    table raises ``ValueError``.  A caller holding v1 cells migrates them first
    (see :func:`~protspace.data.annotations.encoding.upgrade_cell_grammar`), so
    an already-v2 table that lost its stamp is never migrated a second time.

    Args:
        tables: List of 3 Arrow tables (annotations, projections_metadata,
            projections_data). The internal lookup columns (``organism_id``,
            ``sequence``) are dropped from the annotations table.
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
    annotations = _drop_internal_columns(annotations)
    part1, part2, part3, payloads = encode_v3(
        annotations, projections_metadata, projections_data
    )

    _write_parts(
        bundle_path,
        [part1, part2, part3],
        create_settings_parquet(settings) if settings is not None else None,
        write_part(statistics) if statistics is not None else None,
        payloads=payloads,
    )
    logger.info(f"Saved bundled output to: {bundle_path}")


def replace_settings_in_bundle(
    input_path: Path,
    output_path: Path,
    settings: dict,
) -> None:
    """Append or replace the settings (4th) part in a bundle.

    A v3 input keeps every other part byte for byte.  A legacy (v1/v2) input is
    upgraded to v3 on the way, exactly as :func:`convert_bundle` would write it,
    because every write emits v3; that is logged once.  An existing statistics
    part survives either way, so styling a statistics-bearing bundle is
    non-lossy.
    """
    core, _settings, statistics, payloads = _parse_bundle(input_path, warn_legacy=False)
    if payloads is None:
        core, payloads, version = _legacy_core_as_v3(core)
        logger.warning(
            "%s is a v%d parquetbundle; writing %s as v3, which protspace builds "
            "from before format v3 cannot open.",
            input_path,
            version,
            output_path,
        )
    _write_parts(
        output_path,
        core,
        create_settings_parquet(settings),
        statistics,
        payloads=payloads,
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

    ``annotations_table`` must be stamped as v2 cell grammar, as for
    :func:`write_bundle`: a caller whose operations dropped the stamp restores
    it from the version it read before
    (:func:`~protspace.data.annotations.encoding.upgrade_cell_grammar`).

    The internal lookup columns (``organism_id``, ``sequence``) are dropped from
    the new annotations, so a bundle that carried them loses them here.
    """
    core, settings, statistics, payloads = _parse_bundle(input_path, warn_legacy=False)

    annotations_table = _drop_internal_columns(annotations_table)

    if payloads is not None:
        parts = replace_annotations_v3(annotations_table, [*core, payloads])
    else:
        metadata, projections = (read_part(p) for p in core[1:])
        parts = encode_v3(annotations_table, metadata, projections)

    _write_parts(output_path, list(parts[:3]), settings, statistics, payloads=parts[3])

    logger.info(f"Wrote bundle with updated annotations to: {output_path}")


#: Appended to a 3-D projection's name when ``convert --flatten-3d`` writes it as
#: 2-D, so the projection menu never shows it as a 2-D fit.
FLATTENED_SUFFIX = " (X/Y)"


@dataclass(frozen=True)
class Conversion:
    """What :func:`convert_bundle` found and did."""

    #: The input's version: :data:`CONTAINER_VERSION` for v3, else 1 or 2.
    version: int
    #: The input's 3-D projections, in order.
    three_d: tuple[str, ...] = ()
    #: Those written as 2-D (input names; each gained :data:`FLATTENED_SUFFIX`).
    flattened: tuple[str, ...] = ()

    @property
    def written(self) -> bool:
        """Whether anything was written: a legacy input always is, a v3 one only
        when it was flattened."""
        return self.version != CONTAINER_VERSION or bool(self.flattened)


def convert_bundle(
    input_path: Path, output_path: Path, *, flatten_3d: bool = False
) -> Conversion:
    """Rewrite a v1/v2 bundle as v3, optionally flattening its 3-D projections.

    The legacy annotations part is read with its stamp intact, so its grammar is
    known: a v1 table is migrated to the v2 cell grammar here, explicitly, and a
    v2 one passes through.  Settings and statistics are carried over as stored
    bytes.  ``output_path`` may be ``input_path``: the write is atomic.

    With ``flatten_3d`` every 3-D projection is written as 2-D (see
    :func:`flatten_3d_projections`), from a v3 input too.  A v3 input is otherwise
    left untouched and nothing is written.  This is the upgrade path that
    outlives protspace 5.0.0: the general readers drop v1/v2 and 3-D there, and
    this function keeps reading both (it is not a deprecation-registry entry).
    """
    core, settings, statistics, payloads = _parse_bundle(input_path, warn_legacy=False)
    three_d = tuple(_core_three_d_names(core, payloads))
    flatten = flatten_3d and bool(three_d)

    if payloads is not None:
        if not flatten:
            return Conversion(CONTAINER_VERSION, three_d)
        annotations, metadata, projections = decode_v3([*core, payloads])
        metadata, projections, statistics = flatten_3d_projections(
            metadata, projections, statistics, three_d
        )
        part1, part2, part3, payloads = encode_v3(annotations, metadata, projections)
        core, version = [part1, part2, part3], CONTAINER_VERSION
    else:
        if flatten:
            metadata, projections, statistics = flatten_3d_projections(
                read_part(core[1]), read_part(core[2]), statistics, three_d
            )
            core = [core[0], write_part(metadata), write_part(projections)]
        core, payloads, version = _legacy_core_as_v3(core)

    _write_parts(output_path, core, settings, statistics, payloads=payloads)
    return Conversion(version, three_d, three_d if flatten else ())


def flatten_3d_projections(
    metadata: pa.Table,
    projections: pa.Table,
    statistics: bytes | None,
    names: tuple[str, ...] | list[str],
) -> tuple[pa.Table, pa.Table, bytes | None]:
    """Write each of the 3-D projections *names* as a 2-D one, on v2-shaped tables.

    It keeps the X and Y coordinates -- the view every reader shows today, so the
    picture does not change -- drops ``z``, renames the projection with
    :data:`FLATTENED_SUFFIX` and marks its ``info_json`` ``flattened_from_3d``.
    Quality figures computed on the 3-D layout are dropped: its faithfulness
    (``info_json.quality``) and its rows in the statistics part.  Returns the new
    ``(metadata, projections, statistics)``; statistics are returned as given when
    no row is dropped.
    """
    renamed = {name: f"{name}{FLATTENED_SUFFIX}" for name in names}
    if not renamed:
        return metadata, projections, statistics

    existing = set(pc.unique(projections.column("projection_name")).to_pylist())
    if "projection_name" in metadata.column_names:
        existing |= set(metadata.column("projection_name").to_pylist())
    clashes = sorted(new for new in renamed.values() if new in existing)
    if clashes:
        raise ValueError(
            f"cannot flatten 3-D projections: {', '.join(clashes)} already exist"
        )

    flat = pa.array(list(renamed), type=pa.string())
    names_column = projections.column("projection_name")
    is_flat = pc.is_in(names_column, value_set=flat)
    # One lookup per row: the flattened name of a renamed projection, else its own.
    position = pc.index_in(names_column, value_set=flat)
    new_names = pc.coalesce(
        pc.take(pa.array(list(renamed.values()), pa.string()), position),
        names_column,
    )
    projections = _replace_column(projections, "projection_name", new_names)
    z = projections.column("z")
    projections = _replace_column(
        projections, "z", pc.if_else(is_flat, pa.scalar(None, z.type), z)
    )

    if "projection_name" in metadata.column_names:
        rows = metadata.to_pylist()
        for row in rows:
            old = row["projection_name"]
            if old not in renamed:
                continue
            row["projection_name"] = renamed[old]
            if "dimensions" in row:
                row["dimensions"] = 2
            if "info_json" in row:
                row["info_json"] = _flattened_info(row["info_json"])
        metadata = pa.Table.from_pylist(rows, schema=metadata.schema)

    if statistics:
        table = read_part(statistics)
        if {"space_kind", "space_name"} <= set(table.column_names):
            drop = pc.and_(
                pc.equal(table.column("space_kind"), "projection"),
                pc.is_in(table.column("space_name"), value_set=flat),
            )
            drop = pc.fill_null(drop, False)
            if pc.any(drop).as_py():
                statistics = write_part(table.filter(pc.invert(drop)))

    return metadata, projections, statistics


def _replace_column(table: pa.Table, name: str, values) -> pa.Table:
    index = table.schema.get_field_index(name)
    return table.set_column(index, table.schema.field(index), values)


def parse_info_json(raw: str | None) -> dict:
    """A projection's ``info_json`` cell as a dict; empty or malformed is ``{}``."""
    try:
        info = json.loads(raw) if raw else {}
    except (TypeError, ValueError):
        return {}
    return info if isinstance(info, dict) else {}


def _flattened_info(info_json: str | None) -> str:
    """A flattened projection's ``info_json``: marked, without its 3-D quality."""
    info = parse_info_json(info_json)
    info.pop("quality", None)
    info["flattened_from_3d"] = True
    return json.dumps(info)


def _legacy_core_as_v3(core: list[bytes]) -> tuple[list[bytes], bytes, int]:
    """Encode a legacy container's three core parts as v3.

    Returns ``(core_parts, payloads, cell_grammar_version)``.  The annotations
    part is read with its stamp intact, so a v1 table is migrated to the v2 cell
    grammar here, explicitly, and a v2 one passes through.  The rows are keyed
    first, so the id column is ``protein_id`` by the time the migration runs,
    which leaves it alone: an id is a key, and escaping one (``sp|P1|A_HUMAN``
    to ``sp%7CP1|A_HUMAN``) would detach it from its projection rows.

    The internal lookup columns (``organism_id``, ``sequence``) a bundle written
    before they were dropped still carries are dropped here too, as by every
    other write of an annotations part.  That happens after the keying, which
    may have taken ``organism_id`` as the id column and renamed it.
    """
    annotations, projections_metadata, projections_data = _core_tables(core, None)
    version = read_format_version(annotations)
    part1, part2, part3, payloads = encode_v3(
        migrate_legacy_annotation_table(
            _drop_internal_columns(_keyed_as_the_legacy_reader_keyed_it(annotations))
        ),
        projections_metadata,
        projections_data,
    )
    return [part1, part2, part3], payloads, version


#: The id-column candidates of the v2 browser reader (``bundle.ts``,
#: ``extractRowsFromParts``), each matched as a case-insensitive substring.
_LEGACY_ID_CANDIDATES = ("protein_id", "identifier", "id", "uniprot", "entry")


def _keyed_as_the_legacy_reader_keyed_it(annotations: pa.Table) -> pa.Table:
    """A legacy annotations table with the one id per protein the v2 browser saw.

    The encoder takes its ids from a unique, non-null ``protein_id`` column
    (:func:`_core_tables` has renamed an ``identifier`` one), and v3 refuses
    anything else.  The v2 browser reader
    was looser, and a bundle it rendered has to convert (and ``style``) to the
    same dataset: it took the first column whose name contains ``protein_id``,
    ``identifier``, ``id``, ``uniprot`` or ``entry``, in that order, else the
    first column; it skipped a row with a null id; and a later row with the same
    id replaced an earlier one.  A column the encoder would not recognise is
    renamed ``protein_id``, which it then is, and the rows the browser never
    showed are dropped, each time with a warning.
    """
    names = annotations.column_names
    if not names:
        return annotations
    metadata = annotations.schema.metadata
    if PROTEIN_ID_COLUMN not in names:
        id_column = next(
            (
                name
                for candidate in _LEGACY_ID_CANDIDATES
                for name in names
                if candidate in name.lower()
            ),
            names[0],
        )
        logger.warning(
            "legacy annotations have no 'protein_id' or 'identifier' column; "
            "reading '%s' as the protein id, as the v2 browser did",
            id_column,
        )
        annotations = annotations.rename_columns(
            [PROTEIN_ID_COLUMN if name == id_column else name for name in names]
        )

    ids = annotations.column(PROTEIN_ID_COLUMN).to_pylist()
    last = {str(value): row for row, value in enumerate(ids) if value is not None}
    if len(last) != len(ids):
        logger.warning(
            "legacy annotations hold %d row(s) with a null or repeated '%s'; keeping "
            "the last row per id, as the v2 browser did",
            len(ids) - len(last),
            PROTEIN_ID_COLUMN,
        )
        annotations = annotations.take(pa.array(sorted(last.values()), pa.int64()))
    return annotations.replace_schema_metadata(metadata)


def create_settings_parquet(settings_dict: dict) -> bytes:
    """Serialize a settings dict into parquet bytes.

    The parquet file contains a single column ``settings_json`` with one row
    holding the JSON-encoded settings string.
    """
    settings_json = json.dumps(settings_dict)
    return write_part(pa.table({"settings_json": [settings_json]}))


def read_settings_from_bytes(data: bytes) -> dict:
    """Deserialize settings parquet bytes into a dict."""
    table = read_part(data)
    settings_json = table.column("settings_json")[0].as_py()
    return json.loads(settings_json)


def read_settings_from_file(path: Path) -> dict:
    """Read a settings.parquet file and return the settings dict."""
    return read_settings_from_bytes(Path(path).read_bytes())
