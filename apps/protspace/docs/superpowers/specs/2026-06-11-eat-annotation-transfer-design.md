# Design: Embedding Annotation Transfer (`protlabel` engine + `protspace transfer`)

**Status:** As-built (reflects PR #55 after review)
**Date:** 2026-06-11 (rewritten 2026-06-29 to match what shipped)
**Trigger:** Conference proximity-mining feedback + GitHub issue [#54 "EAT — Embedding Annotation Transfer"](https://github.com/tsenoner/protspace/issues/54).

> This document describes the design **as actually implemented**. An earlier draft
> speculated about features that were deliberately *not* built (a faiss/PQ storage
> tier, a ProtTucker "learned distance" mode, and a frontend rendering spec). Those
> sections were removed in review — the frontend belongs in `protspace_web`, and the
> ANN/learned-distance work is out of scope. What remains is the shipped backend.

---

## 1. Decision

`protlabel` is a small, dependency-light **Embedding Annotation Transfer (EAT)**
engine: nearest-neighbour label transfer in *true pLM embedding space* with the
goPredSim reliability index. `protspace transfer` is a thin CLI that reads a
`.parquetbundle` (+ the source HDF5 embeddings), classifies query vs reference
proteins, calls `protlabel`, and writes a small per-cell prediction overlay back
into the bundle. This is the canonical Rost-lab EAT method (Littmann et al. 2021;
Heinzinger et al. 2022) packaged so the conference users' proximity-mining workflow
becomes a thin layer rather than a parallel reimplementation.

The reference embedding matrix is **never** shipped in the bundle — it is rebuilt
on demand from the source HDF5 (or persisted as a small `.npz` sidecar). Only the
tiny per-protein result (predicted value + confidence) ships in the bundle.

## 2. Method (canonical EAT)

Verified against primary sources (goPredSim / Littmann et al. *Sci Rep* 2021;
EAT / Heinzinger et al. *NAR Genom Bioinform* 2022):

- **Space:** the original pLM embedding space (mean-pooled per-protein vectors),
  **not** the 2-D/3-D DR projection — non-linear DR is not isometric, so "nearest
  in UMAP" ≠ "nearest in embedding space."
- **Metric:** **cosine by default** (`--metric cosine`), euclidean opt-in
  (`--metric euclidean`). Cosine is the default because the resulting confidence is
  naturally bounded in `[0, 1]` and directly interpretable, and it matches the bulk
  of the retrieval/RAG literature. Euclidean remains available for goPredSim
  reproduction. *(This reverses the earlier draft's euclidean default, per review.)*
- **k = 1** default; `--k` exposed. For `k > 1` the goPredSim mean reliability
  applies (see below).
- **Reliability index (the confidence column).** goPredSim Eq. (5):

  ```
  RI(p) = (1/m) · Σ_{i : n_i carries label p}  s(d(q, n_i)),     m = min(k, n_refs)

  cosine:     s(d) = clamp(1 − d, 0, 1)        (cosine distance ∈ [0, 2])
  euclidean:  s(d) = 0.5 / (0.5 + d)           (1.0 at d=0, →0 as d→∞)
  ```

  `s(d)` always returns a value in `[0, 1]`; a negative distance is treated as 0 and
  a non-finite distance (NaN/inf) maps to 0, so an invalid neighbour never yields a
  spuriously high confidence. For `k = 1` this collapses to `RI = s(d)`.

- **Calibration caveat.** The euclidean `0.5` constant is the published goPredSim
  value, tuned on ProtT5. ProtSpace supports 12 embedders with different distance
  scales, so euclidean RI is **monotone** (good for ranking) but is **not a
  calibrated probability** across models; on spaces with large raw distances it
  collapses toward 0 even for near neighbours. Cosine avoids this. We do not claim
  dataset-specific accuracy numbers here; `data/eat_demo/` carries a small measured
  sanity-check instead.

## 3. Architecture

```
protspace/                              # repo root = uv workspace root + protspace package
├── pyproject.toml                      # depends on protlabel (workspace source); hatchling builds protspace
├── packages/
│   └── protlabel/                      # uv workspace member — separate distribution (PyPI: protlabel)
│       ├── pyproject.toml              # name=protlabel, deps=[numpy] only
│       └── src/protlabel/
│           ├── __init__.py             # public API: eat(), Lookup, Prediction
│           ├── reliability.py          # goPredSim distance→[0,1] transform
│           ├── backends.py             # exact brute-force (chunked GEMM) kNN
│           ├── transfer.py             # kNN + label transfer + reliability index
│           └── lookup.py               # build / save / load the .npz reference sidecar
└── src/protspace/
    ├── cli/transfer.py                 # thin Typer subcommand (glue; no distance math)
    ├── analysis/classification.py      # query/reference classifier (no hardcoded biology)
    └── data/io/predictions.py          # build the per-cell overlay columns
```

**Packaging (per review — uv workspace).** `protlabel` is a **uv workspace member**
with its own `pyproject.toml` and its own dependency set (numpy only today; an
optional ANN backend could be added without touching protspace's dependencies).
During development it resolves locally (`[tool.uv.sources] protlabel = { workspace =
true }`, editable); the published `protspace` wheel depends on `protlabel>=x` from
PyPI. protspace and protlabel are released in lock-step (one semantic-release version
bump updates both). A **no-`protspace`-imports boundary** (enforced by
`packages/protlabel/tests/test_protlabel_boundary.py`) keeps protlabel
independently testable and reusable.

## 4. Compute & storage

- **Exact brute-force kNN** (numpy BLAS GEMM + `argpartition`, in `backends.py`).
  Queries are processed **in batches** (a whole query block per GEMM), and the
  reference axis is adaptively chunked so the distance block stays within a memory
  budget regardless of `n_refs`. At Swiss-Prot scale (~570K references) this is
  laptop-feasible and the per-query cost is sub-ms in a batch — **no approximate
  index is needed for speed**, and faiss (heavy, patchy wheels) is deliberately not a
  dependency. If a future need arises for ANN on very large lookup sets, a compact
  HNSW library such as [usearch](https://github.com/unum-cloud/usearch) is the
  preferred option over faiss; brute-force has measured as competitive-or-faster on
  resource-constrained hardware, so this stays a future, opt-in concern.
- **Reference lookup** is the only large artifact; it is a rebuildable `.npz`
  sidecar (or regenerated from the HDF5), **never** embedded in the portable
  `.parquetbundle`.
- **Prediction overlay** is small and sparse. For each transferred column `COL`,
  `protspace transfer` appends `COL__pred_value` (string) and `COL__pred_confidence`
  (float32) to the bundle's annotations table, leaving the curated `COL` untouched.
  A protein is "predicted" when `COL` is empty but `COL__pred_value` is present.

## 5. CLI

```bash
protspace transfer \
  -b results.parquetbundle \
  -e embeddings.h5:prot_t5 \
  -t protein_category \
  -o results.parquetbundle \
  --query-id-prefix TRINITY_ \
  --reference-where 'protein_category~neurotoxin'
```

| Flag | Default | Purpose |
|---|---|---|
| `-b/--bundle`, `-e/--embeddings`, `-t/--transfer`, `-o/--output` | required | I/O |
| `--query-* / --reference-*` (`id-prefix`, `where col~substr`) | ≥1 query rule | classify query vs reference (no hardcoded biology) |
| `--k` | `1` | neighbours considered (Eq. 5) |
| `--metric` | `cosine` | `cosine` \| `euclidean` |

See `docs/cli.md` and `docs/annotations.md` for the full option and overlay-column
reference.

## 6. Non-goals

- No statistical FDR/hypothesis testing (RI is a heuristic ranking).
- No automatic UniProt fetch of references (references are whatever is in the bundle).
- **No faiss / product-quantization storage tier, no learned-distance (ProtTucker /
  CLEAN) mode** — out of scope; brute-force in raw embedding space is the published
  baseline and needs no training.
- **No frontend work here** — rendering the predicted-by-transfer overlay is a
  separate `protspace_web` change built on its column-level annotation API.

## 7. Testing

`protlabel` (engine, no protspace deps): `test_protlabel_backends.py`,
`test_protlabel_transfer.py`, `test_protlabel_reliability.py`,
`test_protlabel_lookup.py`, `test_protlabel_version.py`,
`test_protlabel_boundary.py` (the no-protspace-imports boundary).
`protspace`: `test_transfer_cli.py` (end-to-end bundle round-trip),
`test_classification.py`, `test_predictions_overlay.py`.

## 8. Citations

- Littmann, Heinzinger, Olenyi, Dallago, Rost. *Sci Rep* 2021. DOI
  10.1038/s41598-020-80786-0 — RI formula (Eq. 5).
- Heinzinger, Littmann, Sillitoe, Bordin, Orengo, Rost. *NAR Genom Bioinform* 2022.
  DOI 10.1093/nargab/lqac043 — generic EAT tool, CATH calibration, ProtTucker.
- goPredSim — https://github.com/Rostlab/goPredSim (reliability code, 2-column label
  format). EAT tool — https://github.com/Rostlab/EAT.
