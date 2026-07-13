"""Centralized parquetbundle I/O operations.

A .parquetbundle file concatenates multiple parquet files separated by a
delimiter.  The first three parts are the core data tables; an optional
fourth part carries settings (annotation colours, shapes, etc.); an optional
fifth part carries projection statistics.

Positional layout: ``core(3) + settings? + statistics?``.  When statistics are
present but settings are absent, the fourth part is written as **zero bytes** so
the statistics part is unambiguously the fifth — readers and writers branch on
the fourth part's emptiness, not on the raw part count.
"""

import io
import json
import logging
import tempfile
from pathlib import Path

import pyarrow as pa
import pyarrow.parquet as pq

logger = logging.getLogger(__name__)

PARQUET_BUNDLE_DELIMITER = b"---PARQUET_DELIMITER---"

CORE_FILENAMES = [
    "selected_annotations.parquet",
    "projections_metadata.parquet",
    "projections_data.parquet",
]

SETTINGS_FILENAME = "settings.parquet"
STATISTICS_FILENAME = "statistics.parquet"


def _parse_bundle(bundle_path: Path) -> tuple[list[bytes], bytes | None, bytes | None]:
    """Read a bundle → ``(core_parts, settings_bytes, statistics_bytes)``.

    The single place the on-disk layout is decoded: reads the file, validates the
    3-to-5 part count, and normalises the optional parts (the zero-byte settings
    sentinel and an absent/empty statistics part both become ``None``).
    """
    with open(bundle_path, "rb") as f:
        parts = f.read().split(PARQUET_BUNDLE_DELIMITER)

    if len(parts) < 3 or len(parts) > 5:
        raise ValueError(f"Expected 3 to 5 parts in parquetbundle, found {len(parts)}")

    settings = parts[3] if len(parts) >= 4 and parts[3] else None
    statistics = parts[4] if len(parts) == 5 and parts[4] else None
    return parts[:3], settings, statistics


def _table_to_parquet_bytes(table: pa.Table) -> bytes:
    """Serialize an Arrow table to in-memory parquet bytes."""
    buf = io.BytesIO()
    pq.write_table(table, buf)
    return buf.getvalue()


def extract_bundle_to_dir(bundle_path: Path, target_dir: Path | None = None) -> str:
    """Extract a .parquetbundle into separate parquet files on disk.

    Supports bundles with 3 parts (core data only), 4 parts (core + settings),
    or 5 parts (core + settings + statistics, where the settings part may be
    zero bytes).

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

    core, settings, statistics = _parse_bundle(bundle_path)

    for part_bytes, filename in zip(core, CORE_FILENAMES, strict=False):
        if part_bytes:
            (target_dir / filename).write_bytes(part_bytes)
    if settings:
        (target_dir / SETTINGS_FILENAME).write_bytes(settings)
    if statistics:
        (target_dir / STATISTICS_FILENAME).write_bytes(statistics)

    return str(target_dir)


def read_bundle(bundle_path: Path) -> tuple[list[bytes], dict | None]:
    """Read a bundle and return raw core part bytes plus parsed settings.

    The return shape is preserved (``(core_parts, settings)``) so existing
    callers keep working; use :func:`read_statistics_from_bundle` for the
    optional fifth part.

    Returns:
        (core_parts_bytes, settings_dict_or_None)
    """
    core, settings_bytes, _ = _parse_bundle(bundle_path)
    settings = read_settings_from_bytes(settings_bytes) if settings_bytes else None
    return core, settings


def read_statistics_from_bundle(bundle_path: Path) -> bytes | None:
    """Return the raw statistics parquet bytes (fifth part), or None if absent."""
    _, _, statistics = _parse_bundle(bundle_path)
    return statistics


def write_bundle(
    tables: list[pa.Table],
    bundle_path: Path,
    settings: dict | None = None,
    statistics: "pa.Table | None" = None,
) -> None:
    """Write Arrow tables (and optional settings/statistics) to a .parquetbundle.

    Args:
        tables: List of 3 Arrow tables (annotations, projections_metadata,
            projections_data).
        bundle_path: Output file path.
        settings: Optional settings dict to include as 4th part.
        statistics: Optional projection-statistics Arrow table to include as the
            5th part.  When given without ``settings``, a zero-byte settings slot
            is written so the statistics part stays at position five.
    """
    bundle_path.parent.mkdir(parents=True, exist_ok=True)

    with open(bundle_path, "wb") as f:
        for i, table in enumerate(tables):
            if i > 0:
                f.write(PARQUET_BUNDLE_DELIMITER)
            f.write(_table_to_parquet_bytes(table))

        # A settings slot must exist whenever statistics follow it.
        if settings is not None or statistics is not None:
            f.write(PARQUET_BUNDLE_DELIMITER)
            if settings is not None:
                f.write(create_settings_parquet(settings))
            # else: zero-byte settings slot

        if statistics is not None:
            f.write(PARQUET_BUNDLE_DELIMITER)
            f.write(_table_to_parquet_bytes(statistics))

    logger.info(f"Saved bundled output to: {bundle_path}")


def replace_settings_in_bundle(
    input_path: Path,
    output_path: Path,
    settings: dict,
) -> None:
    """Append or replace the settings (4th) part in a bundle.

    The three core parts are preserved byte-for-byte, and an existing statistics
    (5th) part is preserved so styling a statistics-bearing bundle is non-lossy.
    """
    core, _, statistics = _parse_bundle(input_path)

    # core(3) + new settings, preserving a trailing statistics part if present.
    new_parts = [*core, create_settings_parquet(settings)]
    if statistics is not None:
        new_parts.append(statistics)
    new_content = PARQUET_BUNDLE_DELIMITER.join(new_parts)

    output_path.parent.mkdir(parents=True, exist_ok=True)
    with open(output_path, "wb") as f:
        f.write(new_content)


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
