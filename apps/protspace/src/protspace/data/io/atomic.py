"""Publishing a file so it appears complete, or not at all.

Every path here writes a sibling of the destination and renames it into place:
rename within one filesystem is atomic, so a crash, a Ctrl-C or a full disk
leaves the previous content rather than a half-written file. That matters wherever
the existence of a file is itself a signal — a retained cache entry the next run
will trust, or the bundle the user asked to overwrite in place.

The staging file is created with a plain ``open`` rather than ``mkstemp``, so the
published file carries the permissions the process umask gives any new file.
``mkstemp`` creates owner-only, and renaming that into place hands the user a
mode a direct write would never have produced.
"""

from __future__ import annotations

import os
import uuid
from collections.abc import Iterator
from contextlib import contextmanager
from pathlib import Path


@contextmanager
def staged_write(path: Path) -> Iterator[Path]:
    """Yield a staging path beside *path*, published on a clean exit.

    The caller writes to the yielded path with whatever writer it has (a plain
    ``open``, ``pyarrow.parquet.write_table``, ...). Leaving the block normally
    renames it onto *path*; leaving it by exception removes it.
    """
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    # Short random part: the staging name is the destination's plus this, and a
    # full uuid4 hex adds 38 characters to a name the user chose -- enough to
    # push a long bundle name past the filesystem's 255-byte limit on a write
    # that used to work.
    staged = path.with_name(f".{path.name}.{uuid.uuid4().hex[:8]}.tmp")
    try:
        yield staged
        os.replace(staged, path)
    except BaseException:
        staged.unlink(missing_ok=True)
        raise


def atomic_write_bytes(path: Path, data: bytes) -> None:
    """Write *data* to *path* atomically, flushed to disk before publication."""
    with staged_write(path) as staged:
        with open(staged, "wb") as f:
            f.write(data)
            f.flush()
            os.fsync(f.fileno())
