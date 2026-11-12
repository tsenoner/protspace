"""protspace must install on Colab without replacing a package Colab has loaded.

Colab imports numpy, pandas and others before a notebook's first cell runs. When
an install replaces one on disk, the old copy stays in memory and the next import
mixes the two: an external user's Generate failed on numpy's `_blas_supports_fpe`.
The notebooks' install cells therefore hold every loaded distribution at its
loaded version with uv's `--override`, which only works while protspace's own
requirements accept those versions. Transitive pins are what the override is for:
biocentral-api 2.x requires tqdm>=4.68 and, through biotrainer-core, numpy>=2.4.1,
pandas>=2.3.3 and h5py>=3.15, while using only biotrainer-core's FASTA reader.

`tests/data/colab/README.md` says how to refresh the snapshot these tests read.
"""

from __future__ import annotations

import os
import re
import shutil
import subprocess
import tomllib
from pathlib import Path

import pytest
from packaging.requirements import Requirement
from packaging.utils import canonicalize_name

ROOT = Path(__file__).resolve().parents[1]
SNAPSHOT = ROOT / "tests" / "data" / "colab"

# What a Colab kernel may have loaded before a notebook's install cell runs: the
# kernel's own stack and what Colab's startup and the first cells import.
PRELOADED = (
    "numpy", "pandas", "tqdm", "ipython", "ipykernel", "ipywidgets",
    "matplotlib", "requests", "protobuf", "packaging", "pyyaml",
)  # fmt: skip


def _colab_versions() -> dict[str, str]:
    """{canonical name: version} from the snapshot, local build tags dropped."""
    versions = {}
    for line in (SNAPSHOT / "pip-freeze.txt").read_text().splitlines():
        if line.startswith("#") or not line.strip():
            continue
        if "==" in line:
            name, version = line.split("==", 1)
        elif " @ " in line:  # torch @ https://.../torch-2.11.0%2Bcpu-cp313-...whl
            name, url = line.split(" @ ", 1)
            match = re.search(r"-(\d[\w.]*?)(?:%2B[\w.]+)?-cp\d", url)
            if not match:
                continue
            version = match.group(1)
        else:
            continue
        versions[canonicalize_name(name.strip())] = version.strip()
    return versions


def _protspace_requirements(extras=("local",)) -> list[Requirement]:
    project = tomllib.loads((ROOT / "pyproject.toml").read_text())["project"]
    found = [Requirement(r) for r in project["dependencies"]]
    for extra in extras:
        found += [Requirement(r) for r in project["optional-dependencies"][extra]]
    return found


def test_the_snapshot_is_colabs_python():
    """The snapshot is read as Python 3.13 below; a refresh that changes it must say so."""
    info = (SNAPSHOT / "os-info.txt").read_text()
    assert "Python 3.13" in info, info


def test_protspace_accepts_colabs_versions():
    """protspace's own requirements must accept every version Colab ships: the
    install cells cannot override protspace's own floor without breaking it."""
    colab = _colab_versions()
    refused = [
        f"{req} (Colab has {colab[canonicalize_name(req.name)]})"
        for req in _protspace_requirements()
        if canonicalize_name(req.name) in colab
        and not req.specifier.contains(
            colab[canonicalize_name(req.name)], prereleases=True
        )
    ]
    assert not refused, (
        "protspace[local] would make Colab's install cells replace a package Colab "
        f"ships: {refused}. Lower the floor if the older version works, or the "
        "notebooks need a restart after their first install again."
    )


@pytest.mark.integration
@pytest.mark.skipif(
    not os.environ.get("PROTSPACE_COLAB_RESOLVE"),
    reason="resolves against PyPI; set PROTSPACE_COLAB_RESOLVE=1 (CI does)",
)
def test_protspace_resolves_with_colabs_loaded_packages_held(tmp_path):
    """What the install cells do, against the snapshot: hold the packages Colab
    may have loaded at Colab's versions and resolve protspace[local] for Colab's
    Python and platform. A failure means some dependency now needs a version the
    override cannot hold, and the notebooks would fall back to asking for a
    restart. --override pins each held package to Colab's version, so a
    successful resolve is the whole check."""
    uv = shutil.which("uv")
    if uv is None:
        pytest.skip("needs uv")
    colab = _colab_versions()
    held = tmp_path / "held.txt"
    held.write_text("".join(f"{n}=={colab[n]}\n" for n in PRELOADED if n in colab))
    requirements = tmp_path / "requirements.in"
    requirements.write_text(f"protspace[local] @ {ROOT.as_uri()}\n")
    result = subprocess.run(
        [uv, "pip", "compile", str(requirements), "--override", str(held),
         "--python-version", "3.13", "--python-platform", "x86_64-manylinux_2_28",
         "--no-header", "--quiet"],
        capture_output=True, text=True, env={**os.environ, "VIRTUAL_ENV": ""},
    )  # fmt: skip
    assert result.returncode == 0, result.stderr[-3000:]
