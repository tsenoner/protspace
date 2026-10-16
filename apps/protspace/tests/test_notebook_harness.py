"""The Preparation panel harness, from the test suite: opt-in, since it needs a
browser (Playwright from `pnpm install`), node, uv and two Voila servers.

    PROTSPACE_NOTEBOOK_HARNESS=1 uv run pytest tests/test_notebook_harness.py

See scripts/notebook_harness/README.md for what it checks.
"""

from __future__ import annotations

import os
import subprocess
import sys
from pathlib import Path

import pytest

HARNESS = (
    Path(__file__).resolve().parents[1] / "scripts" / "notebook_harness" / "harness.py"
)


@pytest.mark.slow
@pytest.mark.skipif(
    not os.environ.get("PROTSPACE_NOTEBOOK_HARNESS"),
    reason="renders the panel in a browser; set PROTSPACE_NOTEBOOK_HARNESS=1",
)
def test_the_panel_passes_its_sweep(tmp_path):
    result = subprocess.run(
        [sys.executable, str(HARNESS), "--out", str(tmp_path)],
        capture_output=True, text=True, timeout=1800,
    )  # fmt: skip
    assert result.returncode == 0, result.stdout[-4000:] + result.stderr[-2000:]
