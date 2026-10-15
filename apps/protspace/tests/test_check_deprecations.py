"""``scripts/check_deprecations.py``, the release gate, and where the workflow runs it."""

import importlib.util
import os
import subprocess
import sys
from pathlib import Path

import pytest

import protspace
from protspace.deprecations import DEPRECATIONS

PACKAGE_ROOT = Path(__file__).resolve().parents[1]
SCRIPT_PATH = PACKAGE_ROOT / "scripts" / "check_deprecations.py"
RELEASE_WORKFLOW = (
    PACKAGE_ROOT.parents[1] / ".github" / "workflows" / "protspace-release.yml"
)

spec = importlib.util.spec_from_file_location("check_deprecations", SCRIPT_PATH)
gate = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = gate
spec.loader.exec_module(gate)


def _run(*args: str) -> subprocess.CompletedProcess:
    """The script as the workflow runs it: a bare interpreter, no protspace on the
    path, isolated mode so nothing from the working directory is imported."""
    env = {k: v for k, v in os.environ.items() if k != "GITHUB_ACTIONS"}
    return subprocess.run(
        [sys.executable, "-I", str(SCRIPT_PATH), *args],
        capture_output=True,
        text=True,
        cwd=PACKAGE_ROOT,
        env=env,
    )


def test_reads_the_package_version():
    assert gate.current_version() == protspace.__version__


def test_loads_the_same_registry_the_package_uses():
    registry = gate.load_registry()
    assert {k: d.remove_in for k, d in registry.DEPRECATIONS.items()} == {
        k: d.remove_in for k, d in DEPRECATIONS.items()
    }


def test_no_release_due_passes():
    """`semantic-release version --print` echoes the current version when there is
    nothing to release, e.g. on the run its own version-bump commit triggers."""
    result = _run("--next-version", protspace.__version__)
    assert result.returncode == 0, result.stderr
    assert "No release due" in result.stdout


def test_a_release_before_every_removal_passes():
    result = _run("--next-version", "4.99.0", "--current-version", "4.16.5")
    assert result.returncode == 0, result.stderr
    assert "deprecation gate passes" in result.stdout


@pytest.mark.parametrize("next_version", ["5.0.0", "v5.0.0", "5.1.0"])
def test_a_release_at_a_removal_version_fails_listing_what_to_remove(next_version):
    result = _run("--next-version", next_version, "--current-version", "4.16.5")

    assert result.returncode == 1
    assert f"protspace {next_version} must not ship" in result.stderr
    for d in DEPRECATIONS.values():
        assert d.feature in result.stderr
        for note in d.removal:
            assert note in result.stderr


def test_the_gate_compares_against_the_current_version_not_just_equality():
    """5.0.0 → 5.0.0 is not a release; 4.16.5 → 5.0.0 is."""
    registry = gate.load_registry()
    assert gate.check("5.0.0", "5.0.0", registry)[0] == 0
    assert gate.check("5.0.0", "4.16.5", registry)[0] == 1


def test_annotates_the_failure_on_github_actions():
    env = {**os.environ, "GITHUB_ACTIONS": "true"}
    result = subprocess.run(
        [sys.executable, "-I", str(SCRIPT_PATH), "--next-version", "5.0.0"],
        capture_output=True,
        text=True,
        env=env,
    )
    assert result.returncode == 1
    [annotation] = [
        line for line in result.stdout.splitlines() if line.startswith("::error")
    ]
    assert annotation.startswith("::error title=Deprecation gate::protspace 5.0.0")


@pytest.mark.parametrize("bad", ["", "No release will be made", "5.0"])
def test_a_next_version_that_is_not_a_version_fails(bad):
    """A changed `--print` output must fail the release, never pass it."""
    result = _run("--next-version", bad)
    assert result.returncode == 2
    assert "not a MAJOR.MINOR.PATCH version" in result.stderr


def test_the_release_workflow_runs_the_gate_before_releasing():
    if not RELEASE_WORKFLOW.exists():
        pytest.skip("the release workflow is not part of this checkout")
    workflow = RELEASE_WORKFLOW.read_text()

    gate_at = workflow.index("scripts/check_deprecations.py --next-version")
    print_at = workflow.index("semantic-release version --print")
    release_at = workflow.index("semantic-release version --commit")
    assert print_at < gate_at < release_at
