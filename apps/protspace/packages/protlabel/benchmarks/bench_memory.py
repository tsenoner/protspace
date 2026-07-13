"""Single-config memory + timing probe for protlabel.backends.nearest.

Runs ONE (metric, n_refs, dim) config and exits — run it once per config in a
*fresh* process so peak RSS reflects that config alone (process RSS is a
monotonic high-water mark, so measuring several configs in one process is
misleading). Vectors are generated directly as float32 (no float64 temporary).

Usage:
  python bench_memory.py <metric> <n_refs> <dim> [n_queries]

Loop over a grid inside a resource-limited container (the deployment envelope):
  for m in euclidean cosine; do for n in 100000 300000 570000; do
    python packages/protlabel/benchmarks/bench_memory.py $m $n 1024
  done; done

See docs/superpowers/research/2026-06-29-usearch-vs-bruteforce.md.
"""

from __future__ import annotations

import json
import os
import platform
import sys
import threading
import time

import numpy as np
import psutil

from protlabel.backends import nearest


class PeakRSS:
    def __init__(self, interval_s: float = 0.005):
        self._proc = psutil.Process()
        self._interval = interval_s
        self._peak = 0
        self._stop = threading.Event()
        self._t: threading.Thread | None = None

    def _run(self):
        while not self._stop.is_set():
            self._peak = max(self._peak, self._proc.memory_info().rss)
            self._stop.wait(self._interval)

    def __enter__(self):
        self._peak = self._proc.memory_info().rss
        self._t = threading.Thread(target=self._run, daemon=True)
        self._t.start()
        return self

    def __exit__(self, *exc):
        self._stop.set()
        if self._t is not None:
            self._t.join()
        self._peak = max(self._peak, self._proc.memory_info().rss)
        return False

    @property
    def peak_mb(self) -> float:
        return self._peak / (1024 * 1024)


def main() -> None:
    metric = sys.argv[1] if len(sys.argv) > 1 else "cosine"
    n_refs = int(sys.argv[2]) if len(sys.argv) > 2 else 100_000
    dim = int(sys.argv[3]) if len(sys.argv) > 3 else 1024
    n_queries = int(sys.argv[4]) if len(sys.argv) > 4 else 128

    rng = np.random.default_rng(0)
    # Generate float32 directly — no float64 temporary inflating peak RSS.
    refs = rng.standard_normal((n_refs, dim), dtype=np.float32)
    queries = rng.standard_normal((n_queries, dim), dtype=np.float32)

    # Warm up BLAS once (not timed).
    nearest(queries[:8], refs[:1000], k=1, metric=metric)

    with PeakRSS() as mon:
        t0 = time.perf_counter()
        nearest(queries, refs, k=1, metric=metric)
        q_s = time.perf_counter() - t0

    print(
        json.dumps(
            {
                "metric": metric,
                "n_refs": n_refs,
                "dim": dim,
                "n_queries": n_queries,
                "refs_gb_f32": round(refs.nbytes / 1e9, 2),
                "per_query_ms": round(q_s / n_queries * 1000, 4),
                "peak_mb": round(mon.peak_mb, 1),
                "cpus": os.cpu_count(),
                "platform": platform.platform(),
            }
        )
    )


if __name__ == "__main__":
    main()
