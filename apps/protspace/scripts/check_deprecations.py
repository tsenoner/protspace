#!/usr/bin/env python3
"""Release gate: refuse a version that still ships a feature past its removal.

Run by ``.github/workflows/protspace-release.yml`` before semantic-release cuts a
release, with the version it is about to cut::

    next=$(semantic-release version --print | tail -n 1)
    python3 scripts/check_deprecations.py --next-version "$next"

Exits 0 when no release is due (``--print`` echoes the current version then) or
when the next version precedes every ``remove_in`` in
``src/protspace/deprecations.py``; otherwise exits 1 and lists each feature that
must be removed first. A next version that is not a version exits 2.

Standard library only, and the registry is loaded from its file path, so the
gate runs on a bare runner without protspace or its dependencies installed.
"""

from __future__ import annotations

import argparse
import importlib.util
import os
import re
import sys
from pathlib import Path
from types import ModuleType

PACKAGE_ROOT = Path(__file__).resolve().parents[1]
REGISTRY_PATH = PACKAGE_ROOT / "src" / "protspace" / "deprecations.py"
VERSION_PATH = PACKAGE_ROOT / "src" / "protspace" / "__init__.py"


def load_registry(path: Path = REGISTRY_PATH) -> ModuleType:
    """Import ``deprecations.py`` from *path* without importing ``protspace``."""
    spec = importlib.util.spec_from_file_location("_protspace_deprecations", path)
    if spec is None or spec.loader is None:
        raise ImportError(f"cannot load {path}")
    module = importlib.util.module_from_spec(spec)
    # dataclasses resolves the class's module through sys.modules.
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


def current_version(path: Path = VERSION_PATH) -> str:
    """``__version__`` from ``src/protspace/__init__.py``, read as text."""
    match = re.search(
        r"^__version__\s*=\s*[\"']([^\"']+)[\"']", path.read_text(), re.MULTILINE
    )
    if match is None:
        raise ValueError(f"no __version__ in {path}")
    return match.group(1)


def check(next_version: str, current: str, registry: ModuleType) -> tuple[int, str]:
    """``(exit code, report)`` for releasing *next_version* from *current*."""
    next_core = registry.release_core(next_version)
    if next_core == registry.release_core(current):
        return 0, (
            f"No release due (next version {next_version} is the current version); "
            "deprecation gate passes."
        )

    overdue = registry.due(next_version)
    if not overdue:
        upcoming = ", ".join(
            f"{d.key} in {d.remove_in}" for d in registry.DEPRECATIONS.values()
        )
        return 0, (
            f"protspace {next_version} is before every scheduled removal"
            f"{f' ({upcoming})' if upcoming else ''}; deprecation gate passes."
        )

    lines = [
        f"protspace {next_version} must not ship with features scheduled for "
        f"removal at or before it. Remove each one, delete its entry in "
        f"src/protspace/deprecations.py, then release again:",
    ]
    for d in overdue:
        lines.append(f"- {d.feature} (remove_in {d.remove_in}, key {d.key})")
        lines.extend(f"    {note}" for note in d.removal)
    return 1, "\n".join(lines)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n", 1)[0])
    parser.add_argument(
        "--next-version",
        required=True,
        help="The version about to be released (semantic-release version --print).",
    )
    parser.add_argument(
        "--current-version",
        help="The version released last (default: __version__ in src/protspace).",
    )
    args = parser.parse_args(argv)

    registry = load_registry()
    try:
        code, report = check(
            args.next_version,
            args.current_version or current_version(),
            registry,
        )
    except ValueError as exc:
        print(f"check_deprecations: {exc}", file=sys.stderr)
        return 2

    if code and os.environ.get("GITHUB_ACTIONS") == "true":
        # One annotation on the run summary; %0A is a newline in a workflow command.
        print(f"::error title=Deprecation gate::{report.replace(chr(10), '%0A')}")
    print(report, file=sys.stderr if code else sys.stdout)
    return code


if __name__ == "__main__":
    sys.exit(main())
