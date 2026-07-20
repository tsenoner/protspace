"""The CLI must import without the optional `frontend` extra (plotly, dash)."""

import subprocess
import sys

# `sys.modules[name] = None` makes any `import name` raise ImportError, which
# simulates a bare `pip install protspace` without the frontend extra.
CODE = """
import sys
for mod in ("plotly", "dash"):
    sys.modules[mod] = None
import protspace.cli.app  # noqa: F401
"""


def test_cli_imports_without_plotly():
    proc = subprocess.run([sys.executable, "-c", CODE], capture_output=True, text=True)
    assert proc.returncode == 0, proc.stderr
