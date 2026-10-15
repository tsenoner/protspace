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
from protspace.data.loaders.similarity import MMSEQS_INSTALL_HINT
from tests.cli_output import plain


def _stub_pymmseqs(monkeypatch, spec):
    """Answer the `pymmseqs` lookup with *spec*; leave every other one real.

    `find_spec` is a shared stdlib hook, so a blanket `lambda name: None` would
    report *any* module missing for as long as the patch is installed.
    """
    real = importlib.util.find_spec
    monkeypatch.setattr(
        importlib.util,
        "find_spec",
        lambda name, *a, **kw: spec if name == "pymmseqs" else real(name, *a, **kw),
    )


def test_guard_names_the_extra(monkeypatch):
    _stub_pymmseqs(monkeypatch, None)

    with pytest.raises(typer.BadParameter) as exc:
        require_similarity_extra()

    assert MMSEQS_INSTALL_HINT in str(exc.value)


def test_guard_passes_when_pymmseqs_is_importable(monkeypatch):
    _stub_pymmseqs(monkeypatch, object())

    require_similarity_extra()


@pytest.mark.parametrize("command", ["prepare", "project"])
def test_cli_rejects_similarity_before_doing_work(command, tmp_path, monkeypatch):
    """Both commands must refuse while their inputs are still unreadable.

    `missing.h5` does not exist, so reaching the guard at all proves nothing
    was loaded or embedded first.
    """
    from typer.testing import CliRunner

    from protspace.cli.app import app

    _stub_pymmseqs(monkeypatch, None)
    # -f satisfies the sibling precondition (-s on HDF5 input needs a FASTA), so
    # the extra guard is what this asserts on. It has to be a real file -- -f is
    # validated as an existing path -- but nothing reads it, and `missing.h5`
    # still does not exist.
    fasta = tmp_path / "seqs.fasta"
    fasta.write_text(">P1\nAAAA\n")
    args = [
        command,
        "-i",
        str(tmp_path / "missing.h5"),
        "-s",
        "-f",
        str(fasta),
        "-o",
        str(tmp_path),
    ]
    result = CliRunner().invoke(app, args)

    assert result.exit_code != 0
    assert MMSEQS_INSTALL_HINT in plain(result.output)


def test_prepare_rejects_similarity_without_fasta_before_loading(tmp_path, monkeypatch):
    """`-s` on HDF5 input needs `-f`, and must say so before reading the HDF5."""
    from typer.testing import CliRunner

    from protspace.cli.app import app
    from protspace.data import loaders

    loads: list = []
    monkeypatch.setattr(loaders, "load_h5", lambda *a, **kw: loads.append(a))

    h5 = tmp_path / "in.h5"
    h5.write_bytes(b"")
    result = CliRunner().invoke(
        app, ["prepare", "-i", str(h5), "-s", "-m", "pca2", "-o", str(tmp_path)]
    )

    assert result.exit_code != 0
    assert "-s requires FASTA" in plain(result.output)
    assert loads == [], "the HDF5 was read before the argument check"


# The loader-level backstop still has to work for direct library callers, who
# never pass through the CLI guard above.
BACKSTOP_CODE = """
import sys
sys.modules["pymmseqs"] = None
sys.modules["pymmseqs.commands"] = None
from pathlib import Path
from protspace.data.loaders.similarity import MMSEQS_INSTALL_HINT, compute_similarity
try:
    compute_similarity(Path("nonexistent.fasta"), ["a"])
except ImportError as exc:
    assert str(exc) == MMSEQS_INSTALL_HINT, str(exc)
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
