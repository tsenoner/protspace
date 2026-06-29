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
`n_refs ∈ {1K,10K,100K} × dim ∈ {320,1024}` with a 128-query batch, **brute-force beat usearch
end-to-end at every point**, because usearch's HNSW build cost is amortised over too few queries.

**Reconsider an *optional* usearch backend only if a persisted, long-lived EAT service emerges** that
builds one index over a large fixed reference set and answers many thousands of online single-vector
lookups. Two things would drive that decision, and only at scale:
- **Per-query speed:** usearch was ~5–6× faster *per query* at 100K refs — but you need
  ~tens of thousands of queries against the same fixed index to repay the build.
- **Memory (the stronger argument for the 4-core/4 GB target):** a 570K × 1024 float32 reference
  matrix is ~2.3 GB — tight in 4 GB. usearch's `i8`/`f16` quantization (≈4×/2× smaller) is a real
  lever there; brute-force must hold the full f32 matrix (it already chunks the *distance block*, but
  not the reference matrix itself).

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
> (multithreaded), usearch 2.25.3. Single run per cell, no repeats/medians, thermals uncontrolled.
> Treat as order-of-magnitude, not publication figures. The shapes (scaling, crossover) are robust;
> the absolute milliseconds are not. Recall@1 here is measured on **random Gaussian vectors** — see
> the recall caveat below, it is *not* representative of real embeddings.

## Results (cosine, 128-query batch, k=1)

| n_refs | dim | method | build | per-query | recall@1 | peak RSS |
|---:|---:|---|---:|---:|---:|---:|
| 1 000 | 320 | brute-force | — | **0.004 ms** | 1.00 | 62 MB |
| 1 000 | 320 | usearch | 0.02 s | 0.016 ms | 0.96 | 63 MB |
| 1 000 | 1024 | brute-force | — | **0.010 ms** | 1.00 | 74 MB |
| 1 000 | 1024 | usearch | 0.05 s | 0.049 ms | 0.88 | 78 MB |
| 10 000 | 320 | brute-force | — | **0.031 ms** | 1.00 | 125 MB |
| 10 000 | 320 | usearch | 0.64 s | 0.034 ms | 0.55 | 140 MB |
| 10 000 | 1024 | brute-force | — | **0.117 ms** | 1.00 | 283 MB |
| 10 000 | 1024 | usearch | 2.41 s | 0.133 ms | 0.37 | 325 MB |
| 100 000 | 320 | brute-force | — | 0.471 ms | 1.00 | 796 MB |
| 100 000 | 320 | usearch | 14.0 s | **0.077 ms** (6×) | 0.08* | 924 MB |
| 100 000 | 1024 | brute-force | — | 1.167 ms | 1.00 | 2024 MB |
| 100 000 | 1024 | usearch | 43.6 s | **0.211 ms** (5.5×) | 0.06* | 2256 MB |

`*` random-data artifact at ef=64 — see below.

### Analysis

- **Crossover / break-even.** With 128 queries in one batch, exact brute-force wins outright
  everywhere: its total cost (0 build + query) beats usearch's (build + query). usearch's per-query
  latency only pulls ahead at ~100K refs, but the build dominates: at 100K × 1024, each query saves
  ~0.96 ms, so you'd need **~45 000 queries against the same fixed index** to repay the 43.6 s build.
  → usearch makes sense only for a **persisted index reused across many queries**, never a one-shot
  transfer.
- **Brute-force scaling.** Per-query time is linear in `n_refs · dim` (a dense GEMM): at dim=1024 it
  goes 0.010 → 0.117 → 1.167 ms/query across 1K → 10K → 100K. Extrapolating to Swiss-Prot
  (~570K × 1024) ≈ **6–7 ms/query** (~3.8 ms at dim 320) — fine for batch transfer, which is exactly
  the chunked-GEMM backend's design point.
- **Memory.** Brute-force peak RSS tracks the reference matrix (100K × 1024 f32 ≈ 0.39 GB of data,
  ~2.0 GB whole-process incl. interpreter + the float64-budgeted distance block). usearch peaks
  ~10–12 % higher (graph on top of the stored vectors). At full Swiss-Prot, f32 references are
  ~2.3 GB (dim 1024) to ~5.8 GB (dim 2560) — this is the binding constraint on a 4 GB box, and where
  usearch quantization could help.
- **Recall caveat (important).** The low recall@1 at ef=64 (0.06–0.96) is largely a **random-vector
  artifact**, not a usearch defect: i.i.d. Gaussian vectors are near-orthogonal in high dim, so the
  true top-1 is a near-tie among many almost-equidistant candidates (measured 1st–2nd-neighbour gap
  ≈ 0.012 in cosine distance). The benchmark confirmed an ef sweep recovers recall as expected
  (10K × 320: recall@1 0.59 → 0.86 → 0.99 as ef 64 → 256 → 1024), and that the returned top-1 is
  inside the exact top-5 ~94 % of the time at ef=64. **Real pLM embeddings have cluster structure
  (a clear nearest neighbour), so production recall would be far higher at the same ef.** Still, for
  *label transfer* where the nearest neighbour's label is copied, exactness is the safe default.

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
| 4 GB VM, full Swiss-Prot (570K), memory-bound | brute-force still works (~2.3 GB at dim 1024) but is tight → **only here** consider usearch with `i8`/`f16` quantization + a persisted, memory-mapped index |
| Always-on EAT service: one fixed index, ≫10K online single-vector lookups | **optional usearch backend** — its ~5–6× per-query speedup and on-disk index amortise the build |

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
