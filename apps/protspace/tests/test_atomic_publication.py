"""Files this package publishes appear complete, and readable as usual.

Staging into a private temp file and renaming it is what makes an interrupted
write harmless, but `mkstemp` creates that file owner-only — so publishing by
rename quietly handed the user a mode a direct write would never have produced.
"""

import os
import stat

import pyarrow as pa
import pytest

from protspace.data.io.atomic import atomic_write_bytes, staged_write


@pytest.fixture
def permissive_umask():
    previous = os.umask(0o022)
    yield
    os.umask(previous)


def _mode(path):
    return stat.S_IMODE(path.stat().st_mode)


def test_staged_write_publishes_with_the_process_umask(tmp_path, permissive_umask):
    target = tmp_path / "published.txt"

    with staged_write(target) as staged:
        staged.write_text("content")

    assert target.read_text() == "content"
    assert _mode(target) == 0o644


def test_staged_write_leaves_the_previous_content_on_failure(tmp_path):
    target = tmp_path / "published.txt"
    target.write_text("original")

    with pytest.raises(RuntimeError, match="interrupted"):
        with staged_write(target) as staged:
            staged.write_text("half")
            raise RuntimeError("interrupted")

    assert target.read_text() == "original"
    assert list(tmp_path.iterdir()) == [target]


def test_atomic_write_bytes_publishes_with_the_process_umask(
    tmp_path, permissive_umask
):
    target = tmp_path / "data.bin"

    atomic_write_bytes(target, b"payload")

    assert target.read_bytes() == b"payload"
    assert _mode(target) == 0o644


def test_a_bundle_is_not_owner_only(tmp_path, permissive_umask):
    from protspace.data.io.bundle import write_bundle

    bundle_path = tmp_path / "data.parquetbundle"
    tables = [
        pa.table({"identifier": ["P1"]}),
        pa.table({"projection_name": ["PCA 2"]}),
        pa.table({"identifier": ["P1"], "x": [1.0]}),
    ]

    write_bundle(tables, bundle_path)

    assert _mode(bundle_path) == 0o644


def test_a_rewritten_statistics_table_is_not_owner_only(tmp_path, permissive_umask):
    from protspace.cli.stats import _atomic_write_table

    target = tmp_path / "statistics.parquet"

    _atomic_write_table(pa.table({"metric": ["silhouette"], "value": [0.5]}), target)

    assert _mode(target) == 0o644
