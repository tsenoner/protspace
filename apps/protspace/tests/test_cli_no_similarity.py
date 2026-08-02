"""Guards for the optional `similarity` extra (pymmseqs).

MMseqs2 moved out of the base install, so `-s/--similarity` is the one flag
that can fail on a plain `pip install protspace`. These pin the two things
that make that failure survivable: the CLI refuses before doing any work, and
the message names the extra that fixes it.
"""

import importlib.util
import subprocess
import sys

import pytest
import typer

from protspace.cli.common_options import (
    EMBEDDER_MODELS,
    require_similarity_extra,
)

INSTALL_HINT = 'pip install "protspace[similarity]"'


def test_guard_names_the_extra(monkeypatch):
    monkeypatch.setattr(importlib.util, "find_spec", lambda name: None)

    with pytest.raises(typer.BadParameter) as exc:
        require_similarity_extra()

    assert INSTALL_HINT in str(exc.value)


def test_guard_passes_when_pymmseqs_is_importable(monkeypatch):
    monkeypatch.setattr(importlib.util, "find_spec", lambda name: object())

    require_similarity_extra()


@pytest.mark.parametrize("command", ["prepare", "project"])
def test_cli_rejects_similarity_before_doing_work(command, tmp_path, monkeypatch):
    """Both commands must refuse while their inputs are still unreadable.

    `missing.h5` does not exist, so reaching the guard at all proves nothing
    was loaded or embedded first.
    """
    from typer.testing import CliRunner

    from protspace.cli import common_options
    from protspace.cli.app import app

    monkeypatch.setattr(common_options.importlib.util, "find_spec", lambda name: None)
    args = [command, "-i", str(tmp_path / "missing.h5"), "-s", "-o", str(tmp_path)]
    if command == "project":
        args += ["-f", str(tmp_path / "missing.fasta")]
    result = CliRunner().invoke(app, args)

    assert result.exit_code != 0
    # Rich wraps the panel, so collapse whitespace before matching.
    assert INSTALL_HINT in " ".join(result.output.split())


# The loader-level backstop still has to work for direct library callers, who
# never pass through the CLI guard above.
BACKSTOP_CODE = """
import sys
sys.modules["pymmseqs"] = None
sys.modules["pymmseqs.commands"] = None
from pathlib import Path
from protspace.data.loaders.similarity import compute_similarity
try:
    compute_similarity(Path("nonexistent.fasta"), ["a"])
except ImportError as exc:
    assert 'protspace[similarity]' in str(exc), str(exc)
else:
    raise AssertionError("expected ImportError")
"""


def test_loader_backstop_raises_importerror_naming_the_extra():
    proc = subprocess.run(
        [sys.executable, "-c", BACKSTOP_CODE], capture_output=True, text=True
    )
    assert proc.returncode == 0, proc.stderr


def test_embedder_help_list_matches_the_registry():
    """`common_options` copies the model list to keep biocentral off the
    import path; this is what makes that copy safe."""
    from protspace.data.embedding.biocentral import ALL_SHORT_KEYS

    assert set(EMBEDDER_MODELS) == set(ALL_SHORT_KEYS)
