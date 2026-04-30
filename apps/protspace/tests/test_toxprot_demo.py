"""Unit tests for scripts/generate_toxprot_demo.py."""

from __future__ import annotations

import importlib.util
import sys
from pathlib import Path

# Load the script as a module so tests can import its helpers.
SCRIPT_PATH = Path(__file__).parent.parent / "scripts" / "generate_toxprot_demo.py"
spec = importlib.util.spec_from_file_location("generate_toxprot_demo", SCRIPT_PATH)
toxprot_demo = importlib.util.module_from_spec(spec)
sys.modules["generate_toxprot_demo"] = toxprot_demo
spec.loader.exec_module(toxprot_demo)
