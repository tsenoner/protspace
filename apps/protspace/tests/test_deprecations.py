"""The deprecation registry and the warnings that read it.

The first test is the tripwire: it fails on every pull request once the package
version reaches a registered ``remove_in``, so a 5.0.0 bump stays red until the
features due in 5.0.0 are removed and their registry entries deleted. The release
gate (``scripts/check_deprecations.py``, tested in ``test_check_deprecations.py``)
stops the release itself.
"""

import ast
import logging
import re
import sys
import types
from pathlib import Path

import h5py
import numpy as np
import pyarrow.parquet as pq
import pytest
import typer
from typer.testing import CliRunner

import protspace
from protspace import deprecations
from protspace.cli.app import app
from protspace.cli.common_options import Opt_Methods
from protspace.data.io.bundle import LEGACY_REMOVAL_VERSION
from protspace.data.processors.pipeline import parse_methods_arg
from protspace.deprecations import (
    DEPRECATIONS,
    EXPLORE_URL,
    LEGACY_BUNDLE_READ,
    SERVE_COMMAND,
    THREE_D_PROJECTIONS,
    due,
    release_core,
)

REPO_ROOT = Path(__file__).resolve().parents[3]
PIPELINE_LOGGER = "protspace.data.processors.pipeline"


# --------------------------------------------------------------------------- #
# the tripwire
# --------------------------------------------------------------------------- #


def test_no_registered_removal_is_due_at_the_package_version():
    overdue = due(protspace.__version__)
    assert not overdue, (
        f"protspace {protspace.__version__} has reached the removal version of: "
        + "; ".join(f"{d.feature} (remove_in {d.remove_in})" for d in overdue)
        + ". Remove each feature (see its `removal` notes), then delete its entry "
        "in src/protspace/deprecations.py."
    )


def test_the_tripwire_fires_at_the_removal_version(monkeypatch):
    """What the first test sees after a bump to 5.0.0 with nothing removed."""
    monkeypatch.setattr(protspace, "__version__", "5.0.0")
    assert {d.key for d in due(protspace.__version__)} == set(DEPRECATIONS)


# --------------------------------------------------------------------------- #
# the registry
# --------------------------------------------------------------------------- #


def test_the_scheduled_removals():
    assert {key: d.remove_in for key, d in DEPRECATIONS.items()} == {
        THREE_D_PROJECTIONS: "5.0.0",
        SERVE_COMMAND: "5.0.0",
        LEGACY_BUNDLE_READ: "5.0.0",
    }


@pytest.mark.parametrize("entry", list(DEPRECATIONS.values()), ids=list(DEPRECATIONS))
def test_every_removal_note_names_a_file_that_exists(entry):
    """The notes are the inventory the release gate prints; a moved file would
    send whoever does the removal looking for something that is not there."""
    assert entry.removal
    for note in entry.removal:
        path = note.split(":", 1)[0]
        assert (REPO_ROOT / path).exists(), f"{entry.key}: {path} does not exist"


@pytest.mark.parametrize("entry", list(DEPRECATIONS.values()), ids=list(DEPRECATIONS))
def test_every_warning_names_its_removal_version(entry):
    fields = {"example": "umap2 instead of umap3", "methods": "umap3", "name": "x"}
    text = entry.text(**fields)
    assert "deprecated" in text
    assert f"protspace {entry.remove_in}" in text


@pytest.mark.parametrize(
    ("version", "core"),
    [
        ("4.16.5", (4, 16, 5)),
        ("v5.0.0", (5, 0, 0)),
        ("5.0.0-rc.1", (5, 0, 0)),
        ("10.2.30+build.7", (10, 2, 30)),
        (" 5.0.0\n", (5, 0, 0)),
    ],
)
def test_release_core(version, core):
    assert release_core(version) == core


@pytest.mark.parametrize("version", ["", "5", "5.0", "five", "5.0.0.0", "x5.0.0"])
def test_release_core_rejects_what_is_not_a_version(version):
    with pytest.raises(ValueError, match="not a MAJOR.MINOR.PATCH version"):
        release_core(version)


@pytest.mark.parametrize(
    ("version", "is_due"),
    [
        ("4.16.5", False),
        ("4.99.99", False),
        ("5.0.0-rc.1", True),  # a release candidate of 5.0.0 counts as 5.0.0
        ("5.0.0", True),
        ("5.1.0", True),
        ("6.0.0", True),
    ],
)
def test_due_compares_numerically(version, is_due):
    assert bool(due(version)) is is_due


def test_legacy_bundle_removal_version_comes_from_the_registry():
    assert LEGACY_REMOVAL_VERSION == DEPRECATIONS[LEGACY_BUNDLE_READ].remove_in


#: The browser's own copies of the v1/v2 removal version: the notice users see
#: on importing a legacy bundle, and the decoder's deprecation notes. TypeScript
#: cannot import the registry, so this pins them to it.
WEB_LEGACY_SOURCES = (
    "apps/web/src/explore/notifications.ts",
    "packages/core/src/components/data-loader/utils/bundle.ts",
    "packages/core/src/components/data-loader/data-loader.ts",
)
_WEB_REMOVAL_VERSION = re.compile(
    r"(?:protspace|ends in|until)\s+(\d+\.\d+\.\d+)", re.IGNORECASE
)


@pytest.mark.parametrize("source", WEB_LEGACY_SOURCES)
def test_web_legacy_notices_name_the_registered_removal_version(source):
    path = REPO_ROOT / source
    if not path.exists():
        pytest.skip(f"{source} is not part of this checkout")

    versions = _WEB_REMOVAL_VERSION.findall(path.read_text())
    assert versions, f"{source} no longer names the v1/v2 removal version"
    assert set(versions) == {DEPRECATIONS[LEGACY_BUNDLE_READ].remove_in}


def test_the_web_notice_users_see_names_the_removal_version():
    path = REPO_ROOT / WEB_LEGACY_SOURCES[0]
    if not path.exists():
        pytest.skip("the web app is not part of this checkout")
    remove_in = DEPRECATIONS[LEGACY_BUNDLE_READ].remove_in
    assert f"stop opening in ProtSpace {remove_in}" in path.read_text()


def test_registry_is_stdlib_only():
    """The release gate loads the module by path with nothing installed."""
    tree = ast.parse(Path(deprecations.__file__).read_text())
    imported = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            imported |= {alias.name.split(".")[0] for alias in node.names}
        elif isinstance(node, ast.ImportFrom):
            imported.add((node.module or "").split(".")[0])
    assert imported <= sys.stdlib_module_names | {"__future__"}


# --------------------------------------------------------------------------- #
# 3-D projections
# --------------------------------------------------------------------------- #


def _deprecation_records(caplog):
    return [
        r
        for r in caplog.records
        if r.name == PIPELINE_LOGGER and "deprecated" in r.getMessage()
    ]


def test_a_3d_method_warns_once_naming_the_2d_variant(caplog):
    with caplog.at_level(logging.WARNING, logger=PIPELINE_LOGGER):
        specs = parse_methods_arg(["pca2,umap3"])

    assert [str(s) for s in specs] == ["pca2", "umap3"]  # still parsed and run
    [record] = _deprecation_records(caplog)
    message = record.getMessage()
    assert message.startswith("3-D projections are deprecated")
    assert "protspace 5.0.0" in message
    assert "umap2 instead of umap3" in message
    assert message.endswith("Requested 3-D methods: umap3.")


def test_several_3d_methods_share_one_warning(caplog):
    with caplog.at_level(logging.WARNING, logger=PIPELINE_LOGGER):
        parse_methods_arg(["umap3:n_neighbors=5", "umap3:n_neighbors=50", "pca3"])

    [record] = _deprecation_records(caplog)
    assert record.getMessage().endswith("Requested 3-D methods: umap3, pca3.")


def test_2d_methods_do_not_warn(caplog):
    with caplog.at_level(logging.WARNING, logger=PIPELINE_LOGGER):
        parse_methods_arg(["pca2,umap2", "tsne2:perplexity=10"])

    assert _deprecation_records(caplog) == []


def test_methods_help_marks_3d_deprecated():
    """`prepare` and `project` share this option, so both show it."""
    [option] = [
        m for m in Opt_Methods.__metadata__ if isinstance(m, typer.models.OptionInfo)
    ]
    assert "3-D methods (pca3, umap3, …) are deprecated" in option.help
    assert f"protspace {DEPRECATIONS[THREE_D_PROJECTIONS].remove_in}" in option.help


def test_project_with_a_3d_method_warns_and_still_writes_it(tmp_path):
    h5_path = tmp_path / "emb.h5"
    rng = np.random.default_rng(0)
    with h5py.File(h5_path, "w") as f:
        for i in range(12):
            f.create_dataset(f"P{i:05d}", data=rng.normal(size=8).astype(np.float32))

    out = tmp_path / "out"
    result = CliRunner().invoke(
        app, ["project", "-i", f"{h5_path}:prot_t5", "-m", "pca2,pca3", "-o", str(out)]
    )

    assert result.exit_code == 0, result.output
    assert result.output.count("3-D projections are deprecated") == 1
    metadata = pq.read_table(out / "projections_metadata.parquet")
    assert metadata.column("dimensions").to_pylist() == [2, 3]


# --------------------------------------------------------------------------- #
# protspace serve
# --------------------------------------------------------------------------- #


def test_serve_is_marked_deprecated_in_help():
    command = typer.main.get_command(app).commands["serve"]
    assert command.deprecated is True
    assert f"removed in protspace {DEPRECATIONS[SERVE_COMMAND].remove_in}" in (
        command.help
    )
    assert "(deprecated)" in CliRunner().invoke(app, ["--help"]).output


def test_root_help_no_longer_suggests_serve():
    from protspace.cli.app import _HELP

    assert "protspace serve" not in _HELP


def test_serve_warns_then_starts_the_viewer(tmp_path, monkeypatch):
    calls = []
    fake_main = types.ModuleType("protspace.main")
    fake_main.main = lambda **kwargs: calls.append(kwargs)
    monkeypatch.setitem(sys.modules, "protspace.main", fake_main)
    bundle = tmp_path / "data.parquetbundle"
    bundle.write_bytes(b"")

    result = CliRunner().invoke(app, ["serve", str(bundle), "--port", "8123"])

    assert result.exit_code == 0, result.output
    assert "`protspace serve` (the local Dash viewer) is deprecated" in result.output
    assert "protspace 5.0.0" in result.output
    assert EXPLORE_URL in result.output
    assert calls == [{"data": str(bundle), "port": 8123, "pdb_zip": None}]


def test_cli_guide_names_the_registered_removal_versions():
    """`docs/guide/python-cli.md` restates both removal versions in prose."""
    guide = REPO_ROOT / "docs" / "guide" / "python-cli.md"
    if not guide.exists():
        pytest.skip("published docs are not part of this checkout")
    text = " ".join(guide.read_text().split())

    three_d = DEPRECATIONS[THREE_D_PROJECTIONS].remove_in
    serve = DEPRECATIONS[SERVE_COMMAND].remove_in
    assert (
        f"(any `*3` method) are deprecated and will be removed in protspace {three_d}"
        in text
    )
    assert (
        f"are deprecated and will be removed in protspace {serve}. Running it" in text
    )
