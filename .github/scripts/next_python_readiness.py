"""Report which direct dependencies have wheels for a not-yet-supported CPython.

Used by `.github/workflows/protspace-future-python.yml` when the fresh resolve on
the next Python fails. `uv` reports only the *first* distribution it cannot
install, which says nothing about how far off the rest of the stack is. This
walks every direct dependency and asks PyPI the same question, so the run's job
summary answers "how close are we?" instead of naming one package.

Informational only: it always exits 0. Whether a failed run is the ecosystem's
fault or protspace's is decided by the workflow, from uv's error text.

Stdlib only — it runs before (and instead of) a working project environment.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
import tomllib
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from pathlib import Path

PYPI_JSON = "https://pypi.org/pypi/{name}/json"
TIMEOUT_S = 20

# Wheel filenames record the distribution name with `-` normalised to `_`, so the
# three tag fields are always the last three `-`-separated parts.
REQUIREMENT_NAME = re.compile(r"^\s*([A-Za-z0-9._-]+)")
CPYTHON_TAG = re.compile(r"^cp(\d)(\d+)t?$")


@dataclass
class Readiness:
    name: str
    version: str = ""
    has_wheel: bool = False
    has_sdist: bool = False
    error: str = ""

    @property
    def status(self) -> str:
        if self.error:
            return f"unknown — {self.error}"
        if self.has_wheel:
            return "wheel"
        if self.has_sdist:
            return "sdist only (source build)"
        return "nothing installable"


def direct_dependencies(pyproject: Path, groups: list[str]) -> list[str]:
    """Every distribution `uv sync --group <groups>` installs on purpose.

    Optional extras are excluded: the canary does not pass `--extra`, so they are
    not part of what it installs, and reporting them would overstate the blockers.
    """
    data = tomllib.loads(pyproject.read_text())
    requirements = list(data.get("project", {}).get("dependencies", []))
    dependency_groups = data.get("dependency-groups", {})
    for group in groups:
        requirements += dependency_groups.get(group, [])

    names: dict[str, None] = {}  # dict, not set: preserves declaration order
    for requirement in requirements:
        if not isinstance(requirement, str):
            continue  # `{include-group = ...}` and other non-requirement entries
        match = REQUIREMENT_NAME.match(requirement)
        if match:
            names.setdefault(canonicalize(match.group(1)), None)
    return list(names)


def canonicalize(name: str) -> str:
    """PEP 503 normalisation — what the PyPI JSON API expects."""
    return re.sub(r"[-_.]+", "-", name).lower()


def _cpython_at_most(tag: str, target: tuple[int, int]) -> bool:
    match = CPYTHON_TAG.match(tag)
    return bool(match) and (int(match.group(1)), int(match.group(2))) <= target


def _abi_supports(
    py_tags: list[str], abi_tags: list[str], target: tuple[int, int]
) -> bool:
    if f"cp{target[0]}{target[1]}" in abi_tags:
        return True
    if "abi3" in abi_tags:
        # A stable-ABI wheel built for cp312 also loads on 3.15.
        return any(_cpython_at_most(tag, target) for tag in py_tags)
    if "none" in abi_tags:
        return "py3" in py_tags or any(_cpython_at_most(tag, target) for tag in py_tags)
    return False


def _platform_supports(plat_tags: list[str], platform: str) -> bool:
    return any(tag == "any" or platform in tag for tag in plat_tags)


def wheel_is_compatible(filename: str, target: tuple[int, int], platform: str) -> bool:
    parts = filename.removesuffix(".whl").split("-")
    if len(parts) < 5:  # name-version[-build]-python-abi-platform
        return False
    py_tags, abi_tags, plat_tags = (part.split(".") for part in parts[-3:])
    return _abi_supports(py_tags, abi_tags, target) and _platform_supports(
        plat_tags, platform
    )


def check(name: str, target: tuple[int, int], platform: str) -> Readiness:
    try:
        with urllib.request.urlopen(
            PYPI_JSON.format(name=name), timeout=TIMEOUT_S
        ) as response:
            payload = json.load(response)
    except urllib.error.HTTPError as exc:
        if exc.code == 404:
            # Workspace members (protlabel) resolve locally and have no PyPI page
            # under the version being resolved; that is not a blocker.
            return Readiness(name, error="not on PyPI (workspace member?)")
        return Readiness(name, error=f"HTTP {exc.code}")
    except Exception as exc:  # noqa: BLE001 — a probe must never fail the run
        return Readiness(name, error=type(exc).__name__)

    version = payload["info"]["version"]
    files = [
        file for file in payload["releases"].get(version, []) if not file.get("yanked")
    ]
    return Readiness(
        name=name,
        version=version,
        has_wheel=any(
            file["packagetype"] == "bdist_wheel"
            and wheel_is_compatible(file["filename"], target, platform)
            for file in files
        ),
        has_sdist=any(file["packagetype"] == "sdist" for file in files),
    )


def render(results: list[Readiness], python_version: str, platform: str) -> str:
    ready = [r for r in results if r.has_wheel]
    blocked = [r for r in results if not r.has_wheel and not r.error]
    unknown = [r for r in results if r.error]

    lines = [
        f"## Python {python_version} wheel readiness",
        "",
        f"**{len(ready)} of {len(results)} direct dependencies** publish a wheel for "
        f"CPython {python_version} on `{platform}`.",
        "",
    ]
    if blocked:
        lines += [
            "### Still missing a wheel",
            "",
            "| Package | Latest on PyPI | Status |",
            "| --- | --- | --- |",
            *(f"| `{r.name}` | {r.version} | {r.status} |" for r in blocked),
            "",
            "A `sdist only` entry may still install if it builds from source; "
            "`nothing installable` cannot.",
            "",
        ]
    else:
        lines += [
            f"Every direct dependency is ready. Python {python_version} can be "
            "promoted into `protspace-ci.yml`'s matrix once the tests pass.",
            "",
        ]
    if unknown:
        lines += [
            "### Not checked",
            "",
            *(f"- `{r.name}` — {r.error}" for r in unknown),
            "",
        ]
    if ready:
        lines += [f"<details><summary>Ready ({len(ready)})</summary>", ""]
        lines += [f"- `{r.name}` {r.version}" for r in ready]
        lines += ["", "</details>", ""]
    lines += [
        "> Direct dependencies only. A package listed as ready can still be blocked by a "
        "compiled *transitive* dependency — `umap-learn` is pure Python but needs "
        "`numba`/`llvmlite`. uv's error in the step above names the one that actually bit.",
        "",
    ]
    return "\n".join(lines)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--pyproject", type=Path, required=True)
    parser.add_argument("--python-version", required=True, help="e.g. 3.15")
    parser.add_argument("--group", action="append", default=[], dest="groups")
    parser.add_argument(
        "--platform",
        default="x86_64",
        help="substring matched against wheel platform tags",
    )
    args = parser.parse_args()

    major, _, minor = args.python_version.partition(".")
    target = (int(major), int(minor))

    names = direct_dependencies(args.pyproject, args.groups or ["dev"])
    with ThreadPoolExecutor(max_workers=8) as pool:
        results = list(pool.map(lambda name: check(name, target, args.platform), names))
    results.sort(key=lambda r: (r.has_wheel, bool(r.error), r.name))

    report = render(results, args.python_version, args.platform)
    print(report)
    summary = os.environ.get("GITHUB_STEP_SUMMARY")
    if summary:
        with open(summary, "a", encoding="utf-8") as handle:
            handle.write(report + "\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())
