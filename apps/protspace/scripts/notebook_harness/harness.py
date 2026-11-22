"""Render the Preparation notebook's panel headlessly and check it, state by state.

    uv run --directory apps/protspace python scripts/notebook_harness/harness.py

Runs the notebook's own cells in Voila (google.colab and pip stubbed, a small
demo dataset loaded) for ipywidgets 7.7.1, which Colab ships, and 8, which CI
uses, and drives each page with headless Playwright (`sweep.mjs`). Exit status
1 when any check fails; `report.json` in the output directory lists every
failure. README.md describes the states and the checks.
"""

from __future__ import annotations

import argparse
import json
import os
import shutil
import socket
import subprocess
import sys
import tempfile
import time
import urllib.request
from pathlib import Path

HERE = Path(__file__).resolve().parent
PROTSPACE = HERE.parents[1]  # apps/protspace
NOTEBOOK = PROTSPACE / "notebooks" / "ProtSpace_Preparation.ipynb"

WIDGETS = {
    "8": ["voila", "ipykernel", "ipywidgets==8.1.8"],
    # ipywidgets 7 needs Voila 0.4's widget manager; 0.5 only registers 8's.
    "7": [
        "voila<0.5",
        "ipykernel",
        "ipywidgets==7.7.1",
        "jupyterlab_widgets<2",
        "widgetsnbextension<4",
    ],
}

STUB = r"""
import importlib.machinery, subprocess, sys, types
colab = types.ModuleType("google.colab")
colab.__spec__ = importlib.machinery.ModuleSpec("google.colab", None)
colab.files = types.SimpleNamespace(
    download=lambda path: print(f"[colab] download {path}"), upload=lambda **k: {}
)
colab.drive = colab.userdata = colab.output = types.SimpleNamespace()
try:
    import google
except ImportError:
    google = types.ModuleType("google")
    google.__path__ = []
    sys.modules["google"] = google
google.colab = colab
sys.modules["google.colab"] = colab
_real_run = subprocess.run
def _no_pip(cmd, *a, **k):
    if "pip" in cmd:  # the package under test is already installed
        return types.SimpleNamespace(returncode=0, stdout="", stderr="")
    return _real_run(cmd, *a, **k)
subprocess.run = _no_pip
"""

# A small dataset like the external user's: non-UniProt IDs, a custom CSV with
# one family for some proteins.
DEMO = r"""
import numpy as np, h5py
from pathlib import Path
rng = np.random.default_rng(0)
centres = rng.normal(size=(3, 16))
with h5py.File("demo_esm2_650m.h5", "w") as f:
    for i in range(90):
        f.create_dataset(f"TRINITY_DN{i:04d}", data=(centres[i % 3] + 0.3 * rng.normal(size=16)).astype("float32"))
Path("demo.csv").write_text("identifier,family\n" + "".join(
    f"TRINITY_DN{i:04d},{'three-finger toxin' if i % 3 == 0 and i < 60 else ''}\n" for i in range(90)))
tabs.selected_index = 1
h5_path_field.value = str(Path("demo_esm2_650m.h5").resolve())
csv_path_field.value = str(Path("demo.csv").resolve())
"""

# Each step slowed down, so the progress states stay on screen long enough to
# be captured; the download sleeps as a browser transfer would.
SLOW = r"""
import time as _slow_time
def _slowly(fn, seconds=2.0):
    def wrapped(*a, **k):
        _slow_time.sleep(seconds)
        return fn(*a, **k)
    return wrapped
load_h5 = _slowly(load_h5)
ReductionPipeline._fetch_annotations = _slowly(ReductionPipeline._fetch_annotations)
ReductionPipeline._run_reductions = _slowly(ReductionPipeline._run_reductions)
files.download = _slowly(files.download, 3.0)
for _m, _t in method_toggles.items():
    _t.value = _m in {"PCA", "UMAP"}
"""


def _cell(source: str, cell_id: str) -> dict:
    return {
        "id": cell_id, "cell_type": "code", "metadata": {},
        "execution_count": None, "outputs": [], "source": source,
    }  # fmt: skip


def build_page(
    work: Path, name: str, extra: list[str], notebook: Path = NOTEBOOK
) -> str:
    """A notebook running the Preparation notebook's own cells after the stub."""
    cells = [
        "".join(c["source"])
        for c in json.loads(notebook.read_text())["cells"]
        if c["cell_type"] == "code"
    ]
    (work / "cells.json").write_text(json.dumps(cells))
    body = [_cell(STUB, "stub")]
    body += [
        _cell(
            "import json as _j\n"
            f"exec(compile(_j.load(open('cells.json'))[{i}], 'cell{i}', 'exec'), globals())",
            f"c{i}",
        )
        for i in range(len(cells))
    ]
    body += [_cell(src, f"x{n}") for n, src in enumerate(extra)]
    notebook = {
        "cells": body,
        "metadata": {"kernelspec": {"name": "python3", "display_name": "Python 3", "language": "python"}},
        "nbformat": 4, "nbformat_minor": 5,
    }  # fmt: skip
    (work / f"{name}.ipynb").write_text(json.dumps(notebook))
    return f"{name}.ipynb"


def _free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def start_voila(work: Path, widgets: str, log: Path) -> tuple[subprocess.Popen, str]:
    port = _free_port()
    cmd = ["uv", "run", "--project", str(PROTSPACE)]
    for requirement in WIDGETS[widgets]:
        cmd += ["--with", requirement]
    cmd += [
        "voila",
        "--no-browser",
        f"--port={port}",
        "--Voila.ip=127.0.0.1",
        str(work),
    ]
    env = {k: v for k, v in os.environ.items() if k != "VIRTUAL_ENV"}
    server = subprocess.Popen(
        cmd, cwd=work, stdout=log.open("w"), stderr=subprocess.STDOUT, env=env
    )
    base = f"http://127.0.0.1:{port}"
    for _ in range(300):  # the first run resolves the overlay environment
        try:
            urllib.request.urlopen(base, timeout=1)
            return server, base
        except OSError:
            if server.poll() is not None:
                raise SystemExit(
                    f"Voila (ipywidgets {widgets}) exited; see {log}"
                ) from None
            time.sleep(1)
    server.terminate()
    raise SystemExit(f"Voila (ipywidgets {widgets}) did not start; see {log}")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--widgets", choices=["7", "8", "both"], default="both")
    parser.add_argument("--widths", default="1440,1280,1024,800")
    parser.add_argument(
        "--out", type=Path, default=None, help="default: a new temporary directory"
    )
    parser.add_argument(
        "--no-progress", action="store_true", help="skip the Generate/EAT run"
    )
    parser.add_argument(
        "--skip-sweep", action="store_true", help="only the Generate/EAT run"
    )
    parser.add_argument(
        "--notebook", type=Path, default=NOTEBOOK,
        help="another version of the notebook, e.g. `git show main:...` saved to a file",
    )  # fmt: skip
    args = parser.parse_args()

    if shutil.which("node") is None or shutil.which("uv") is None:
        raise SystemExit("needs node (with the repo's pnpm install) and uv on PATH")
    out = (args.out or Path(tempfile.mkdtemp(prefix="notebook-harness-"))).resolve()
    out.mkdir(parents=True, exist_ok=True)
    versions = ["7", "8"] if args.widgets == "both" else [args.widgets]
    failures = 0
    report = {}
    for widgets in versions:
        work = Path(tempfile.mkdtemp(prefix=f"notebook-harness-w{widgets}-"))
        panel = build_page(work, "panel", [DEMO], args.notebook)
        progress = build_page(work, "progress", [DEMO, SLOW], args.notebook)
        server, base = start_voila(work, widgets, out / f"voila-w{widgets}.log")
        try:
            result_file = out / f"w{widgets}.json"
            # A report left in a reused --out must not stand in for this run's.
            result_file.unlink(missing_ok=True)
            sweep = [
                "node", str(HERE / "sweep.mjs"),
                "--panel", f"{base}/voila/render/{panel}",
                "--out", str(out / f"w{widgets}"),
                "--widths", args.widths,
                "--report", str(result_file),
            ]  # fmt: skip
            if not args.no_progress:
                sweep += ["--progress", f"{base}/voila/render/{progress}"]
            if args.skip_sweep:
                sweep += ["--sweep", "0"]
            proc = subprocess.run(sweep, check=False)
            if result_file.exists():
                result = json.loads(result_file.read_text())
            else:
                result = {"error": f"no report (sweep exited {proc.returncode})"}
            if proc.returncode and "error" not in result:
                result["error"] = f"sweep exited {proc.returncode}"
        finally:
            server.terminate()
            server.wait(timeout=30)
            shutil.rmtree(work, ignore_errors=True)
        report[f"ipywidgets {widgets}"] = result
        failures += len(result.get("failures", [])) + ("error" in result)

    (out / "report.json").write_text(json.dumps(report, indent=1))
    for name, result in report.items():
        states = result.get("states", 0)
        print(f"{name}: {states} states, {len(result.get('failures', []))} failure(s)")
        if "error" in result:
            print("    error:", result["error"])
        for failure in result.get("failures", [])[:15]:
            print("   ", failure)
    print(f"Screenshots and report.json in {out}")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
