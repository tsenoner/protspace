#!/usr/bin/env python3
"""Plot saved benchmark results (thin wrapper around ``run.py``).

All paths, label loading, and plotting live in :mod:`protspace.benchmark.run`.
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent.parent / "src"))

from protspace.benchmark.run import plot_only_main

if __name__ == "__main__":
    plot_only_main()
