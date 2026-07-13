# Research: exact brute-force kNN vs usearch (HNSW) for `protlabel`

**Date:** 2026-06-29
**Question:** Should `protlabel`'s nearest-neighbour search stay exact brute-force, or add an
optional [usearch](https://github.com/unum-cloud/usearch) (HNSW) backend? How do the two scale?
**Trigger:** PR #55 review (the reviewer flagged faiss as the wrong accelerator, suggested usearch,
and noted brute-force measured faster on a constrained box). This study substantiates the
brute-force default decision with measurements.

## TL;DR / recommendation

**Keep exact brute-force as the only backend for now.** It is *exact* (recall = 1, which matters
for label-transfer correctness), needs no index build, adds no dependency, and is sub-millisecond to
low-millisecond per query in a batch through Swiss-Prot scale. In a benchmark over
`n_refs ∈ {1K,10K,100K} × dim ∈ {960,1024,1152,1280,2560}` (spanning ESMC-300M, ProtT5, ESMC-600M,
ESM2-650M, ESM2-3B) with a 128-query batch, **brute-force beat usearch end-to-end at every point**,
because usearch's HNSW build cost is amortised over too few queries.

**Reconsider an *optional* usearch backend only if a persisted, long-lived EAT service emerges** that
builds one index over a large fixed reference set and answers many thousands of online single-vector
lookups. Two things would drive that decision, and only at scale:
- **Per-query speed:** usearch was ~6–7× faster *per query* at 100K refs — but you need
  ~tens of thousands of queries against the same fixed index to repay the build.
- **Memory (the stronger argument for the 4-core/4 GB target):** full Swiss-Prot at dim 1024 now
  **fits** — measured ~3 GB peak in a 4 GB container, *after* a fix that stops the cosine path from
  holding the reference matrix twice (it was ~4.7 GB → OOM before). It only stops fitting at dim 2560
  (~5.8 GB f32), where usearch's `i8`/`f16` quantization (≈4×/2× smaller) becomes a real lever.

## Method

`packages/protlabel/benchmarks/bench_knn.py` (committed, reproducible). Compares
`protlabel.backends.nearest` (exact, chunked-GEMM, cosine) against
`usearch.index.Index(metric='cos', connectivity=16, expansion_add=128, expansion_search=64)` — the
library's standard settings. For each cell it records index build time, batch query time, per-query
latency, recall@1 (usearch top-1 vs the exact brute-force top-1), and peak process RSS.

Reproduce with:

```bash
uv run --with usearch --with psutil python packages/protlabel/benchmarks/bench_knn.py
```

> **Caveat — indicative numbers.** Apple M4 Pro, 14 cores, numpy 2.2.6 on Apple Accelerate BLAS
> (multithreaded), usearch 2.26.0. Single run per cell, no repeats/medians, thermals uncontrolled.
> Treat as order-of-magnitude, not publication figures. The shapes (scaling, crossover) are robust;
> the absolute milliseconds are not. Recall@1 here is measured on **random Gaussian vectors** — see
> the recall caveat below, it is *not* representative of real embeddings.

## Results (cosine, 128-query batch, k=1)

Dims: 960 = ESMC-300M, 1024 = ProtT5 (transfer default), 1152 = ESMC-600M, 1280 = ESM2-650M,
2560 = ESM2-3B.

| n_refs | dim | method | build | per-query | recall@1 | peak RSS |
|---:|---:|---|---:|---:|---:|---:|
| 1 000 | 960 | brute-force | — | **0.042 ms** | 1.00 | 113 MB |
| 1 000 | 960 | usearch | 0.05 s | 0.041 ms | 0.91 | 117 MB |
| 1 000 | 1024 | brute-force | — | **0.046 ms** | 1.00 | 148 MB |
| 1 000 | 1024 | usearch | 0.05 s | 0.042 ms | 0.91 | 152 MB |
| 1 000 | 1152 | brute-force | — | **0.054 ms** | 1.00 | 186 MB |
| 1 000 | 1152 | usearch | 0.05 s | 0.049 ms | 0.88 | 191 MB |
| 1 000 | 1280 | brute-force | — | **0.061 ms** | 1.00 | 229 MB |
| 1 000 | 1280 | usearch | 0.06 s | 0.056 ms | 0.91 | 234 MB |
| 1 000 | 2560 | brute-force | — | **0.116 ms** | 1.00 | 314 MB |
| 1 000 | 2560 | usearch | 0.11 s | 0.103 ms | 0.93 | 324 MB |
| 10 000 | 960 | brute-force | — | **0.110 ms** | 1.00 | 393 MB |
| 10 000 | 960 | usearch | 2.15 s | 0.107 ms | 0.33 | 432 MB |
| 10 000 | 1024 | brute-force | — | **0.117 ms** | 1.00 | 472 MB |
| 10 000 | 1024 | usearch | 2.27 s | 0.118 ms | 0.31 | 513 MB |
| 10 000 | 1152 | brute-force | — | **0.121 ms** | 1.00 | 560 MB |
| 10 000 | 1152 | usearch | 2.69 s | 0.110 ms | 0.35 | 606 MB |
| 10 000 | 1280 | brute-force | — | **0.135 ms** | 1.00 | 657 MB |
| 10 000 | 1280 | usearch | 2.90 s | 0.130 ms | 0.25 | 708 MB |
| 10 000 | 2560 | brute-force | — | **0.202 ms** | 1.00 | 853 MB |
| 10 000 | 2560 | usearch | 5.75 s | 0.240 ms | 0.23 | 953 MB |
| 100 000 | 960 | brute-force | — | 0.921 ms | 1.00 | 1952 MB |
| 100 000 | 960 | usearch | 35.7 s | **0.139 ms** (6.6×) | 0.07* | 2108 MB |
| 100 000 | 1024 | brute-force | — | 1.093 ms | 1.00 | 1913 MB |
| 100 000 | 1024 | usearch | 37.5 s | **0.154 ms** (7.1×) | 0.07* | 2159 MB |
| 100 000 | 1152 | brute-force | — | 1.118 ms | 1.00 | 2066 MB |
| 100 000 | 1152 | usearch | 42.3 s | **0.157 ms** (7.1×) | 0.04* | 2360 MB |
| 100 000 | 1280 | brute-force | — | 1.150 ms | 1.00 | 2304 MB |
| 100 000 | 1280 | usearch | 45.9 s | **0.169 ms** (6.8×) | 0.06* | 2627 MB |
| 100 000 | 2560 | brute-force | — | 1.720 ms | 1.00 | 3794 MB |
| 100 000 | 2560 | usearch | 91.1 s | **0.300 ms** (5.7×) | 0.02* | 4219 MB |

`*` random-data artifact at ef=64 — see below.

### Analysis

- **Crossover / break-even.** With 128 queries in one batch, exact brute-force wins outright
  everywhere: its total cost (0 build + query) beats usearch's (build + query). usearch's per-query
  latency only pulls ahead at ~100K refs, but the build dominates: at 100K × 1024, each query saves
  ~0.94 ms, so you'd need **~40 000 queries against the same fixed index** to repay the 37.5 s build.
  → usearch makes sense only for a **persisted index reused across many queries**, never a one-shot
  transfer.
- **Brute-force scaling.** Per-query time is linear in `n_refs · dim` (a dense GEMM): at dim=1024 it
  goes 0.046 → 0.117 → 1.093 ms/query across 1K → 10K → 100K (and 0.116 → 0.202 → 1.720 at dim 2560);
  the intermediate ESM dims (960/1152/1280) interpolate as expected. Extrapolating to Swiss-Prot ≈
  **~6 ms/query** at 570K × 1024 (~10 ms at dim 2560) — fine for batch transfer, which is exactly the
  chunked-GEMM backend's design point.
- **Memory.** *(The `peak RSS` column in the table above is unreliable — that run measured several
  configs in one long-lived process, and process RSS is a monotonic high-water mark, so later rows
  are inflated by earlier ones. Use the clean per-process measurement under "Deployment envelope"
  below instead.)* The reference matrix is the binding constraint: f32 references are ~2.3 GB
  (dim 1024) to ~5.8 GB (dim 2560) at full Swiss-Prot.
- **Recall caveat (important).** The low recall@1 at ef=64 (0.02–0.93) is largely a **random-vector
  artifact**, not a usearch defect: i.i.d. Gaussian vectors are near-orthogonal in high dim, so the
  true top-1 is a near-tie among many almost-equidistant candidates (measured 1st–2nd-neighbour gap
  ≈ 0.008 in cosine distance at dim 1024). The benchmark confirmed an ef sweep recovers recall as
  expected (10K × 1024: recall@1 0.33 → 0.69 → 0.98 as ef 64 → 256 → 1024), and that the returned
  top-1 is inside the exact top-5 ~83 % of the time at ef=64. **Real pLM embeddings have cluster structure
  (a clear nearest neighbour), so production recall would be far higher at the same ef.** Still, for
  *label transfer* where the nearest neighbour's label is copied, exactness is the safe default.

### Deployment envelope (4-core / 4 GB), measured

Re-measured in a Docker container limited to `--cpus=4 --memory=4g` (the deploy profile), with
**one fresh process per config** (so peak RSS reflects that config alone) and vectors generated
directly as float32. arm64 (Apple M4) throttled to 4 cores — per-core speed is faster than the
target Intel VM, so **treat the timings as a lower bound; the memory figures are
architecture-independent.** Reproduce with `packages/protlabel/benchmarks/bench_memory.py`.

| metric | n_refs | refs f32 | per-query (4 cores) | peak RSS |
|---|---:|---:|---:|---:|
| euclidean | 100K | 0.41 GB | 2.2 ms | 676 MB |
| euclidean | 300K | 1.23 GB | 5.3 ms | 1875 MB |
| euclidean | 570K (Swiss-Prot) | 2.33 GB | 9.7 ms | **3151 MB** |
| cosine | 100K | 0.41 GB | 1.1 ms | 630 MB |
| cosine | 300K | 1.23 GB | 3.7 ms | 1749 MB |
| cosine | 570K (Swiss-Prot) | 2.33 GB | 7.4 ms | **3037 MB** |

**Full Swiss-Prot fits in 4 GB** for both metrics at dim 1024 (~3 GB peak, no OOM), at ~7–10 ms/query
on 4 arm64 cores (expect ~2–3× on a slower Intel VM — still fine for batch transfer).

> **Memory fix shipped.** The cosine path used to hold the reference matrix **twice** (the raw matrix
> plus a normalized copy), so cosine at Swiss-Prot / dim 1024 needed ~4.7 GB and would OOM-kill a 4 GB
> box. `backends.py` now folds the per-reference norm into the dot product (`cos = q·r / (‖q‖‖r‖)`)
> instead of storing a second matrix, so cosine holds **1× references like euclidean** — which is what
> makes the ~3 GB peak above (and the 4 GB target) achievable. At **dim 2560** (ESM2-3B) references
> alone are ~5.8 GB → still exceed 4 GB; use a smaller model, fp16 references, or (future) usearch
> quantization on that box.

## Literature / background

- **What usearch is.** Unum's single-file vector-search engine built on the same **HNSW** graph
  algorithm as faiss's HNSW index, but designed to be compact and broadly portable with few
  dependencies. Key params match what the benchmark used: `connectivity` (HNSW *M*, graph degree),
  `expansion_add` (ef_construction, indexing recall), `expansion_search` (ef_search, query
  recall/speed). ([repo](https://github.com/unum-cloud/usearch),
  [docs](https://unum-cloud.github.io/USearch/), [PyPI](https://pypi.org/project/usearch/))
- **Quantization.** usearch stores vectors as `f32` by default and can downcast to `f16` or `i8`
  (and `b1`) for ~2×/4× memory savings, using high-precision arithmetic over the downcasted vectors —
  **no trained quantizer** (unlike faiss IVF-PQ). This is the most relevant usearch feature for the
  memory-bound 4 GB target.
- **vs faiss.** Same core algorithm (HNSW); usearch trades faiss's breadth of index types / GPU for a
  much smaller, dependency-light, broadly-wheeled package and user-defined metrics — which is exactly
  why it's the better *future* option than faiss for a cross-platform CLI, if an ANN backend is ever
  needed. faiss was rejected in PR #55 review for being heavy with patchy wheels.
- **Scaling theory.** Exact brute-force is `O(n_refs · dim)` per query, BLAS/GEMM-bound and fully
  parallel across a query batch, with no build step and recall = 1; memory is `O(n_refs · dim)` for
  the reference matrix. HNSW is ~`O(log n)` per query but carries an `O(n log n)` build and extra
  graph memory (~`connectivity · n` links), and is approximate (recall < 1, tunable via ef). With
  optimised BLAS and small/medium `n` and modest `dim`, exact GEMM frequently wins on wall-clock —
  the sublinear query only pays off once a *fixed* index is reused across enough queries to amortise
  the build, which is precisely what the measurements show.

## Decision for protspace / protlabel

| Scenario | Backend |
|---|---|
| `protspace transfer` (one-shot, batch of queries, rebuilt per run) | **exact brute-force** (current) — faster end-to-end and exact |
| 64 GB Colab, any realistic dataset | **exact brute-force** — memory is a non-issue |
| 4-core/4 GB deployed VM, references ≤ ~100–200K | **exact brute-force** — sub-ms/low-ms per query, fits memory |
| 4 GB VM, full Swiss-Prot (570K), dim ≤ 1024 | **exact brute-force** — measured ~3 GB peak (after the cosine 1×-memory fix), fits; ~7–10 ms/query on 4 cores |
| 4 GB VM, Swiss-Prot at dim 2560 (ESM2-3B) | references alone are ~5.8 GB → won't fit f32 → use a smaller model, fp16 references, or (future) usearch `i8`/`f16` quantization |
| Always-on EAT service: one fixed index, ≫10K online single-vector lookups | **optional usearch backend** — its ~6–7× per-query speedup and on-disk index amortise the build |

**Conclusion:** the brute-force default the reviewer favoured is the right call, and the measurements
back it. An optional usearch backend is a *future* item justified by either (a) a persisted
high-query-volume service, or (b) memory pressure at full Swiss-Prot on a small box (where
quantization, not speed, is the win) — not by `protspace transfer`'s current one-shot usage.
The engine's `backends.py` is already isolated behind a small interface, so adding a usearch backend
later is a localised change.

Sources: [usearch repo](https://github.com/unum-cloud/usearch) ·
[usearch docs](https://unum-cloud.github.io/USearch/) ·
[usearch on PyPI](https://pypi.org/project/usearch/) ·
[usearch BENCHMARKS.md](https://github.com/unum-cloud/usearch/blob/main/BENCHMARKS.md)
