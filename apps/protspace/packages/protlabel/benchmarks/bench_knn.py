"""Micro-benchmark: exact brute-force chunked-GEMM kNN (protlabel.backends.nearest)
vs approximate HNSW kNN (usearch) on this machine.

Run (usearch + psutil are not project dependencies — pull them just for the run):
  cd <repo> && uv run --with usearch --with psutil python packages/protlabel/benchmarks/bench_knn.py

Grid: n_refs in {1000, 10000, 100000}; dim in {960, 1024, 1152, 1280, 2560};
n_queries=128; cosine; k=1. Dims span the pLMs ProtSpace embeds with:
960 = ESMC-300M, 1024 = ProtT5 (the transfer default), 1152 = ESMC-600M,
1280 = ESM2-650M, 2560 = ESM2-3B (the large-model / memory-ceiling case).
Timings use time.perf_counter. BLAS is warmed up once before timing.
peak_mb is whole-process peak RSS sampled during each method's build+query window
(best-effort; includes interpreter + shared ref/query arrays baseline).

See docs/superpowers/research/2026-06-29-usearch-vs-bruteforce.md for results + analysis.
"""

from __future__ import annotations

import gc
import json
import platform
import threading
import time

import numpy as np
import psutil

from protlabel.backends import nearest

try:
    from usearch.index import Index, MetricKind

    HAVE_USEARCH = True
    USEARCH_ERR = None
except Exception as exc:  # pragma: no cover - environment guard
    HAVE_USEARCH = False
    USEARCH_ERR = repr(exc)


# usearch HNSW hyperparameters (library standard settings)
M = 16
EF_CONSTRUCTION = 128
EF_SEARCH = 64

N_QUERIES = 128
K = 1
SEED = 0

GRID = [(n, d) for n in (1_000, 10_000, 100_000) for d in (960, 1024, 1152, 1280, 2560)]


class PeakRSS:
    """Sample whole-process RSS in a background thread; report the peak (MB)."""

    def __init__(self, interval_s: float = 0.002):
        self._proc = psutil.Process()
        self._interval = interval_s
        self._peak = 0
        self._stop = threading.Event()
        self._thread: threading.Thread | None = None

    def _run(self):
        while not self._stop.is_set():
            try:
                rss = self._proc.memory_info().rss
            except Exception:
                rss = 0
            if rss > self._peak:
                self._peak = rss
            self._stop.wait(self._interval)

    def __enter__(self):
        # Seed with the current RSS so a fast method still records something.
        self._peak = self._proc.memory_info().rss
        self._thread = threading.Thread(target=self._run, daemon=True)
        self._thread.start()
        return self

    def __exit__(self, *exc):
        self._stop.set()
        if self._thread is not None:
            self._thread.join()
        # Final reading in case the peak happened right before exit.
        try:
            rss = self._proc.memory_info().rss
            self._peak = max(self._peak, rss)
        except Exception:
            pass
        return False

    @property
    def peak_mb(self) -> float:
        return self._peak / (1024 * 1024)


def warmup():
    """Warm up numpy/BLAS and the nearest() code path once (not timed)."""
    rng = np.random.default_rng(123)
    a = rng.standard_normal((128, 512), dtype=np.float32)
    b = rng.standard_normal((2000, 512), dtype=np.float32)
    _ = a @ b.T
    _ = nearest(a, b, k=1, metric="cosine")
    if HAVE_USEARCH:
        idx = Index(
            ndim=512,
            metric=MetricKind.Cos,
            connectivity=M,
            expansion_add=EF_CONSTRUCTION,
            expansion_search=EF_SEARCH,
        )
        idx.add(np.arange(2000), b)
        _ = idx.search(a, count=1)
        del idx
    gc.collect()


def bench_one(n_refs: int, dim: int) -> list[dict]:
    rng = np.random.default_rng(SEED)
    refs = rng.standard_normal((n_refs, dim)).astype(np.float32)
    queries = rng.standard_normal((N_QUERIES, dim)).astype(np.float32)
    rows: list[dict] = []

    # --- 1) brute-force exact (ground truth) ---
    gc.collect()
    with PeakRSS() as mon:
        t0 = time.perf_counter()
        bf_idx, _bf_dist = nearest(queries, refs, k=K, metric="cosine")
        q_s = time.perf_counter() - t0
    bf_top1 = bf_idx[:, 0]
    rows.append(
        {
            "n_refs": n_refs,
            "dim": dim,
            "n_queries": N_QUERIES,
            "method": "brute_force",
            "build_s": 0.0,
            "query_total_s": q_s,
            "per_query_ms": q_s / N_QUERIES * 1000.0,
            "recall_at_1": 1.0,
            "peak_mb": mon.peak_mb,
        }
    )

    # --- 2) usearch HNSW (approximate) ---
    if HAVE_USEARCH:
        keys = np.arange(n_refs, dtype=np.int64)
        gc.collect()
        with PeakRSS() as mon:
            idx = Index(
                ndim=dim,
                metric=MetricKind.Cos,
                connectivity=M,
                expansion_add=EF_CONSTRUCTION,
                expansion_search=EF_SEARCH,
                dtype="f32",
            )
            t0 = time.perf_counter()
            idx.add(keys, refs)
            build_s = time.perf_counter() - t0

            t1 = time.perf_counter()
            matches = idx.search(queries, count=K)
            q_s = time.perf_counter() - t1
        us_keys = np.asarray(matches.keys).reshape(N_QUERIES, -1)
        us_top1 = us_keys[:, 0]
        recall = float(np.mean(us_top1 == bf_top1))
        rows.append(
            {
                "n_refs": n_refs,
                "dim": dim,
                "n_queries": N_QUERIES,
                "method": f"usearch(M={M},ef={EF_SEARCH})",
                "build_s": build_s,
                "query_total_s": q_s,
                "per_query_ms": q_s / N_QUERIES * 1000.0,
                "recall_at_1": recall,
                "peak_mb": mon.peak_mb,
            }
        )
        del idx, keys

    del refs, queries
    gc.collect()
    return rows


def main():
    print(f"usearch available: {HAVE_USEARCH}  ({USEARCH_ERR or 'ok'})")
    print(
        f"python={platform.python_version()} numpy={np.__version__} "
        f"psutil={psutil.__version__} platform={platform.platform()}"
    )
    warmup()

    all_rows: list[dict] = []
    wall0 = time.perf_counter()
    for n_refs, dim in GRID:
        all_rows.extend(bench_one(n_refs, dim))
    wall = time.perf_counter() - wall0

    # Pretty table
    hdr = (
        f"{'n_refs':>8} {'dim':>5} {'nq':>4} {'method':>22} "
        f"{'build_s':>9} {'query_s':>9} {'per_q_ms':>9} {'recall@1':>9} {'peak_mb':>9}"
    )
    print("\n" + hdr)
    print("-" * len(hdr))
    for r in all_rows:
        print(
            f"{r['n_refs']:>8} {r['dim']:>5} {r['n_queries']:>4} {r['method']:>22} "
            f"{r['build_s']:>9.4f} {r['query_total_s']:>9.4f} {r['per_query_ms']:>9.4f} "
            f"{r['recall_at_1']:>9.3f} {r['peak_mb']:>9.1f}"
        )
    print(f"\nTotal wall time for grid: {wall:.2f}s")
    print("\n===JSON===")
    print(json.dumps(all_rows))


if __name__ == "__main__":
    main()
