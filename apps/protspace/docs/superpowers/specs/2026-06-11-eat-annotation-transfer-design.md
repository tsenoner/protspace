# Design: Embedding Annotation Transfer (`protlabel` engine + `protspace transfer` subcommand)

**Status:** Draft for review
**Date:** 2026-06-11
**Supersedes:** an earlier "neighbors-subcommand" draft (since removed) — this expanded its scope, reconciled it with GitHub issue #54 and frontend PR #272, and corrected two defaults (cosine→Euclidean, and the reliability aggregation).
**Trigger:** Conference feedback (`Conference_feedback/ProtSpaceExtractor_v1.7.4_mod 1.py`) + GitHub issue [#54 "EAT — Embedding Annotation Transfer (protlabel lookup table)"](https://github.com/tsenoner/protspace/issues/54) + frontend PR [protspace_web #272 "mark predictions and surface per-annotation docs"](https://github.com/tsenoner/protspace_web/pull/272).
**Research backing:** Literature + codebase fan-out (8 agents) with adversarial verification of the storage/compute math and the EAT algorithm against primary sources. Citations in §15.

> **Shipped vs deferred (read this first).** This document is a design draft, not as-built documentation. Only a subset of what is described below shipped in PR #55; several flags and the long-format table are deferred follow-ups. Treat anything not in the "Shipped" list as future work that is **not yet implemented**.
>
> **Shipped in PR #55** (`protspace transfer`, see `src/protspace/cli/transfer.py`):
> - Flags: `-b/--bundle`, `-e/--embeddings`, `-t/--transfer`, `-o/--output`, `--query-id-prefix`, `--query-where`, `--reference-id-prefix`, `--reference-where`, `--k`, `--metric` (`euclidean` | `cosine`).
> - Wide overlay columns appended to the bundle annotations table (`src/protspace/data/io/predictions.py`): `<col>__pred_value`, `<col>__pred_confidence`, `<col>__pred_source`.
> - Brute-force nearest-neighbour search and the goPredSim reliability index.
>
> **Deferred / not yet implemented (future work):**
> - The opt-in flags described in §3, §5, and §11: `--cutoff`, `--mine`/`--top-n`, `--lookup`, `--report`, `--plots`, `--full-tables`, `--excel`, distance-threshold transfer mode.
> - The long-format `predicted_annotations` parquet table (§7.2); shipped output is the wide `<col>__pred_*` overlay columns instead.
> - The faiss accelerator and the `protspace[ann]` extra — **the `ann` extra is not declared in `pyproject.toml`**, so `pip install protspace[ann]` does not work today.

---

## 1. One-paragraph decision

Build **`protlabel`** as a small standalone uv workspace member — the **Embedding Annotation Transfer (EAT) engine**: nearest-neighbour label transfer in *true pLM embedding space* with a calibrated reliability index. **`protspace`** consumes it through a thin **`protspace transfer`** subcommand that reads a `.parquetbundle` (+ the source HDF5 embeddings), classifies query vs reference proteins, calls `protlabel`, and writes a small **prediction overlay** back into the bundle. The big artifact (the reference embedding matrix / lookup index) is **never** shipped in the bundle — it is a rebuildable **sidecar/cache file**. The tiny artifact (per-protein predicted value + confidence + source neighbour) ships in the bundle and the **frontend renders it as a new "predicted-by-transfer" visual layer** (hollow markers, confidence-driven opacity, provenance tooltip) that is *orthogonal to* PR #272's existing column-level "predicted-by-model" badge. Everything beyond the one default output table is opt-in, so ProtSpace does not get overblown.

This is the canonical Rost-lab EAT method (Littmann et al. 2021; Heinzinger et al. 2022) — exactly what issue #54 describes — packaged so the conference users' proximity-mining workflow becomes a thin, optional layer on top rather than a parallel reimplementation.

---

## 2. How the three inputs relate

| Input | What it is | Role in this design |
|---|---|---|
| **Issue #54 (EAT / `protlabel`)** | "Given references with known annotations + embeddings, transfer labels to unknowns by nearest neighbour in *embedding space*, backed by a lookup table." | **The engine.** Defines `protlabel`. This is canonical EAT. |
| **Conference `ProtSpaceExtractor` v1.7.4** | A 1.5K-LOC script doing proximity mining in *DR/projection space* (UMAP/t-SNE coords) with cross-method consensus, an EDD elbow, Venn/agreement sets, neighborhood mining, and a 25-file + HTML report. | **A screening/exploration layer.** Its genuinely-novel parts (neighborhood mining, report) become opt-in extras on `protspace transfer`; its DR-space machinery is mostly subsumed by transferring in true embedding space (see §6 keep/adapt/drop). |
| **PR #272 (frontend)** | Marks whole annotation **columns** as model-predicted (⚡ badge, source grouping, info popovers), deliberately **frontend-only, no data-format change**. | **The base the EAT frontend extends.** EAT introduces *cell-level* predictions (a value-level axis #272 explicitly deferred). The two compose; neither replaces the other. |

The key realization tying them together: **DR-space proximity (the conference approach) is a lossy proxy for embedding-space proximity (EAT).** Non-linear DR is not isometric, so "nearest in UMAP_3" ≠ "nearest in embedding space." Issue #54 gets this right; the conference script worked around it with consensus/normalization scaffolding that becomes unnecessary once we transfer in the true space.

---

## 3. The canonical method we adopt (EAT), with corrections

Verified against primary sources (goPredSim / Littmann et al. *Sci Rep* 2021; EAT tool / Heinzinger et al. *NAR Genom Bioinform* 2022):

- **Space:** original pLM embedding space (mean-pooled per-protein vectors). **Not** DR coordinates.
- **Metric:** **Euclidean (L2)**, default. *Nuance (verifier correction):* the strong "Euclidean beats cosine for pLM embeddings" statement is from the **2022** paper (citing prior work); the **2021** paper only found cosine "changed little." Euclidean is still the right default because it is the canonical tool default and the documented 2022 finding — but the basis is "tool convention + 2022 claim," not "both papers." Cosine stays an opt-in `--metric`.
- **No L2-normalization by default** — canonical EAT uses raw Euclidean; magnitude carries information cosine discards. (Normalization/whitening to fight hubness are research extras, off by default.)
- **k = 1** default (the value eat.py defaults to and the 2021 paper chose after grid search). `k` is exposed; a distance-threshold mode (transfer from all references within distance d) is also supported, per goPredSim.
- **Reliability index (the confidence column).** Adopt goPredSim Eq.(5) **verbatim** — do **not** invent a separate `reliability × vote` product (a verifier flagged that as non-canonical; neighbour agreement is *already* encoded in the formula):

  ```
  RI(p) = (1/k) · Σ_{i : n_i carries label p}  s(d(q, n_i))

  where  s(d) = 0.5 / (0.5 + d)        for Euclidean   (RI = 1.0 at d=0, 0.5 at d=0.5, →0 as d→∞)
         s(d) = 1 − d                  for cosine (clamp to [0,1]; cosine distance ∈ [0,2])
  ```

  For the default k=1 this collapses to `RI = 0.5/(0.5 + d)`. The `(1/k)·Σ_{neighbours carrying p}` term *is* the multi-neighbour agreement weighting; report `RI` directly as the `[0,1]` confidence.
- **Distance→accuracy calibration (reference point, ProtT5/CATH):** at Euclidean distance ≤ 1.1, ~75% coverage with ~90% accuracy at CATH H-level; ProtTucker (contrastive) reaches ~76% H-level vs raw ProtT5 EAT ~64% and HMMER ~77%. **Caveat (critical):** the `0.5` constant in `s(d)` and the `1.1` threshold are **ProtT5-specific**. ProtSpace supports 12 embedders (320–2560 dim) with different distance scales — RI stays *monotone* (good for ranking) but is **not a calibrated probability** for other models without re-validation. Document this loudly.

**Output contract (mirror eat.py for interoperability):** per query → `query_id`, transferred `label`, `source_id` (nearest reference), `source_label`, `distance`, `reliability`. Accept goPredSim's 2-column `id → comma-separated labels` lookup-label file so existing EAT/goPredSim lookups drop in.

**Optional upgrade path (documented, not built first):** ProtTucker-style contrastive projection or CLEAN-style EC centroids as a future "learned distance" mode. Ship raw-embedding Euclidean EAT first — it needs no training and is the published baseline.

---

## 4. Architecture

```
protspace/                             # the protspace repo (also the build root)
├── pyproject.toml                     # hatchling builds BOTH packages; scipy added as a dep
└── src/
    ├── protlabel/                     # NEW second top-level package — the EAT engine (issue #54)
    │   ├── __init__.py                # public API: eat(), Lookup, Prediction
    │   ├── reliability.py             # goPredSim distance→[0,1] reliability transform
    │   ├── backends.py                # brute-force (default) | faiss (optional, later) NN search
    │   ├── transfer.py                # kNN + label transfer + reliability index (RI)
    │   └── lookup.py                  # build / save / load the reference lookup sidecar (.npz)
    └── protspace/
        ├── cli/transfer.py            # NEW thin Typer subcommand (glue only, ~150 LOC)
        ├── analysis/                  # NEW — classifier now; optional gating/mining later
        │   └── classification.py     # query/reference classifier (no hardcoded biology)
        ├── data/io/bundle.py          # EXTEND: replace_annotations_in_bundle() (in-place part-1 rewrite)
        └── data/io/predictions.py     # NEW: build the per-cell overlay columns
```

**Packaging decision (refines the spec):** the suite root is *not* a uv workspace, and `protspace`
publishes to PyPI — so a separate `protlabel` distribution would force its own PyPI release + CI
changes. For the MVP, `protlabel` ships as a **second top-level package inside the protspace repo**
(`src/protlabel/`), bundled into the protspace wheel via
`[tool.hatch.build.targets.wheel] packages = ["src/protspace", "src/protlabel"]`. A strict
**no-`protspace`-imports boundary** keeps it independently testable and reusable, and makes a future
promotion to a standalone PyPI package / uv workspace member a clean, mechanical split. The optional
gating/mining/report and faiss backend are deferred to follow-up work (kept out so ProtSpace stays lean).

**The boundary (why a submodule, not just a subcommand):**

- **`protlabel` is pure and ProtSpace-agnostic.** In: reference embeddings (`ndarray` + ids + labels) and query embeddings (`ndarray` + ids). Out: per-query nearest neighbour(s), distance, reliability, transferred label(s). It owns the **lookup table** (issue #54's core artifact): building it, serializing it to a sidecar, and querying it. Usable as a standalone `eat`-style tool and reusable by other projects (`protspace_uniprot`, notebooks).
- **`protspace transfer` is glue.** It knows about `.parquetbundle`, HDF5 loading (`load_h5`), query/reference classification, and writing the overlay back. It contains **no distance math** — that lives in `protlabel`.
- **`protspace/analysis/`** holds the *optional* conference-derived screening (gating, neighborhood mining). Default runs skip it entirely.

This keeps `protspace` from getting overblown: the heavy/clever code is isolated in a focused library; the subcommand stays small; the extras are opt-in modules that don't load unless requested.

---

## 5. Algorithm — "best of both worlds" pipeline

Minimal viable command produces a useful, calibrated transfer table from **embedding-space 1-NN + reliability index alone**. Everything else is a flag.

1. **Load embeddings** from the source HDF5 (`load_h5`: float16→float32 upcast, dim validation, reject per-residue). Mean-pool already done upstream (per-protein vectors).
2. **Classify** queries vs references by ID-prefix and/or metadata-substring rules (CLI flags or YAML). **No hardcoded biology** (drop the v1.7.4 `TRINITY_`/`mscr` fallback). Error clearly if no query rule matches anything.
3. **kNN in true embedding space** (`protlabel.transfer`). Default metric **Euclidean**; `--metric {euclidean,cosine}`. Brute-force chunked search (default); faiss backend if installed. Take the `k` nearest *references* per query (default k=1).
4. **Transfer label + reliability** via Eq.(5) above → the primary `[0,1]` confidence. This *replaces* consensus/EDD as the headline number.
5. *(opt-in)* **Confidence gate** for batch triage: `--cutoff {fixed,reliability,percentile,edd}`. Default-if-requested = fixed distance/reliability tied to measured accuracy (EAT-style). If `edd`, compute `max(Kneedle distance-to-chord, median-jump)` **on the embedding-space distance curve**, clearly labeled a heuristic soft gate — never as calibrated confidence.
6. *(opt-in)* **High-precision subset** = `reliability ≥ threshold AND k-NN vote unanimous` (the embedding-space replacement for v1.7.4 "Overlapped").
7. *(opt-in)* **Neighborhood mining** (`--mine`/`--top-n`): top-N nearest items around each reference/confident query, with recurrence counts and a non-redundant pooled panel. Pure exploration, decoupled from confidence.
8. **Output** one tidy `predictions.parquet` by default (§7.2). Extras opt-in: `--report` (Jinja2 HTML), `--plots`, `--full-tables` (reproduce the v1.7.4 25-file layout for the conference users).

### Keep / adapt / drop the conference ideas (verified)

| v1.7.4 idea | Verdict | Why |
|---|---|---|
| Rank-percentile normalization | **DROP** as core / keep as optional descriptor | Exists only to make incomparable DR scales (PCA vs UMAP vs t-SNE) summable. One embedding-space metric + RI makes it unnecessary. |
| Cross-DR-method consensus (0–6) | **DROP** | The 6 projections are deterministic lossy shadows of the *same* embedding; their agreement measures DR stability, not biological confidence — zero independent evidence once you transfer in the source space. (At most an opt-in "projection agreement" QC diagnostic, never labeled "confidence".) |
| EDD elbow (Kneedle ∨ median-jump) | **DEMOTE** to optional soft gate | Adaptive and parameter-free, but statistically uncalibrated (curve-shape dependent, Kneedle is noise-sensitive) — unlike EAT's accuracy-tied 1.1. Recompute in embedding space; offer as one `--cutoff` option, not the default. |
| N-way "Overlapped" agreement set | **ADAPT** | Redefine from "UMAP_3 ∩ TSNE_3 survivors" to "reliability ≥ t AND vote unanimous" — same high-precision-subset value, calibrated terms. |
| Top-N neighborhood mining | **KEEP** (opt-in) | The strongest survivor: metric-agnostic, genuinely useful for cluster expansion / focused re-runs. Gate behind `--mine`. |
| 25-file output + Venns/coverage maps/graphs | **DROP** as default / keep behind `--plots`/`--full-tables` | Venns specifically lose meaning once consensus is dropped. |
| One-page HTML report | **KEEP** (opt-in `--report`) | Useful sharing artifact; Jinja2 template, not `__doc__`-string injection. |

> **Framing for the conference users:** present embedding-space transfer as a strict upgrade that *subsumes* their goals (a single calibrated confidence instead of a 6-way consensus proxy), and keep their exact workflow reproducible via `--full-tables`. Their contribution is acknowledged and preserved, not discarded.

---

## 6. Storage & data representation — the user's "is it too large?" question

Two artifacts with **very different** sizes. Treat them differently.

### 6.1 The reference lookup (BIG) → sidecar / cache, never in the bundle

Reference embedding matrix size (N proteins × D dims; binary units, ≈5% smaller than SI):

| N | D=1024 (ProtT5) fp32 / fp16 | D=2560 (ESM2-3B) fp32 / fp16 |
|---|---|---|
| 1,000 | 3.9 MiB / 2.0 MiB | 9.8 MiB / 4.9 MiB |
| 10,000 | 39 MiB / 20 MiB | 98 MiB / 49 MiB |
| 100,000 | 391 MiB / 196 MiB | 977 MiB / 489 MiB |
| **573,000 (Swiss-Prot)** | **2.19 GiB / 1.09 GiB** | **5.47 GiB / 2.73 GiB** |

The `.parquetbundle` is a ~45 MB portable viz payload. **Embedding a 1–5.5 GiB matrix into it is the wrong call** — it would bloat every download for a feature most viz users never touch, and it is rebuildable from the source HDF5 anyway. **Decision:**

- **`protlabel` writes the lookup as a sidecar file** next to the bundle (or in `~/.cache/protspace/`): raw fp16 `.npy`/`.h5` for small sets, a serialized faiss index for large sets.
- **Rebuildable on demand:** if the sidecar is absent/stale, regenerate from the embeddings HDF5 (brute force needs nothing; a faiss build for 573K is seconds-to-low-minutes on CPU).
- **Optional compression** (faiss IVF-PQ) shrinks the *whole* of Swiss-Prot dramatically: `m=64 → ~35 MiB` (64× at D=1024, 160× at D=2560), `m=32 → ~17 MiB`, `m=16 → ~9 MiB`. Add an exact-distance **rerank** of top candidates to recover the recall bare 8-bit PQ loses (~70% → ~90–95%). So a "store it small" option exists if a user *does* want it portable — but it is opt-in, validated, and still a sidecar.

The user's instinct — *"have it as an optional file in tmp"* — is exactly right and is the recommended default.

### 6.2 The prediction overlay (TINY) → ships in the bundle

The per-protein result is small and **sparse** (only proteins that got a transferred value). Store as a **new optional parquet table `predicted_annotations`** appended after the existing parts (the bundle is delimiter-separated and length-extensible; old readers that read parts 1–4 ignore it → backward compatible). Long format, one row per (protein, predicted column):

| column | type | notes |
|---|---|---|
| `identifier` | string | protein id |
| `annotation_column` | string | which annotation was transferred (e.g. `protein_category`) |
| `predicted_value` | string | the transferred label |
| `reliability` | float32 | the `[0,1]` confidence (RI) |
| `distance` | float32 | embedding distance to the source |
| `source_id` | string | nearest reference protein |
| `k`, `method`, `model` | small | provenance (e.g. `k=1`, `euclidean`, `prot_t5`) |

Even for tens of thousands of predicted cells this is well under a megabyte. **Do not** store full neighbour lists per cell for 570K × many columns — keep top-1 `source_id` + `k` + `method`; fetch fuller neighbour lists lazily only if a richer hover is ever needed.

**Representation model (chosen): per-cell overlay on the original column.** EAT *fills missing values inside an existing annotation column* and marks those cells predicted, so the scatter shows curated (filled) + transferred (hollow) points together in one colour scheme — far more useful than a separate `predicted_<col>` column. (A separate-column model, like Biocentral, is the simpler fallback if the overlay proves too invasive.)

> **Note on PR #272's contract:** #272 was deliberately *no-data-format-change*. EAT is precisely the feature that introduces **value-level** predicted metadata into the bundle — the axis #272 deferred. That is expected and intended; §10 keeps the two axes cleanly separated.

---

## 7. Compute & feasibility verdict

**Brute-force kNN is laptop-feasible across the entire range, including full Swiss-Prot.** Measured (Apple Silicon, chunked numpy GEMM + argpartition; reproduced by an independent verifier within ~10–25%):

| Query batch × references × dim | wall time |
|---|---|
| 1,000 × 100K × 1024 | ~0.8–0.9 s |
| 1,000 × 573K × 1024 | ~4–4.6 s (~4 ms/query) |
| 1,000 × 573K × 2560 | ~6 s (~6 ms/query) |
| single query × 573K | ~4–6 ms |

**The binding constraint is RAM (to hold the reference matrix), not compute.** Mitigation: load the reference as fp16 and upcast per chunk, chunk the N axis so the Q×N distance block never materializes at full size. This stays within a 16 GB laptop at D=1024 and is borderline-but-workable at D=2560. Older Intel/CI machines run ~2–5× slower but stay sub-minute for a few queries at Swiss-Prot scale.

**Conclusion:** the entire feature is feasible and *not* compute-intensive at realistic scales. **No ANN index is needed for speed** — exact search is already ~ms/query. ANN's only justification here is *shrinking the stored reference* (PQ), which is opt-in.

**Default:** exact brute force (numpy/scipy/sklearn — already deps) up to ~100–200K references, and still usable to full Swiss-Prot. **Optional accelerator:** `protspace[ann]` extra → **faiss-cpu** (best wheel coverage: macOS arm64+x86_64, manylinux x86_64+aarch64, Windows; pacmap 0.9.x already adopts faiss). Reject hnswlib (sdist-only, needs a compiler) and ScaNN (no macOS wheels) as cross-platform CLI deps. *(scipy is not currently an explicit `protspace` dep — sklearn pulls it transitively; add it explicitly if using `scipy.spatial.distance.cdist`, or use `sklearn.neighbors.NearestNeighbors(algorithm='brute')`.)*

---

## 8. CLI design

```bash
# Minimal: transfer one annotation, default Euclidean 1-NN, one output table
protspace transfer \
  --bundle results.parquetbundle \
  --embeddings emb.h5:prot_t5 \
  --transfer protein_category \
  --query-id-prefix TRINITY_ \
  --reference-where 'protein_category~neurotoxin' \
  --out results.parquetbundle          # writes the overlay back into the bundle (or a sidecar)

# Tuning + optional screening
protspace transfer ... --metric euclidean --k 3 \
  --cutoff reliability --min-reliability 0.6 \
  --mine --top-n 5 \
  --report --plots
```

| Flag | Default | Purpose |
|---|---|---|
| `--bundle` | required | the `.parquetbundle` to annotate |
| `--embeddings h5[:model]` | required | source embeddings for true-space distance |
| `--transfer COL` | required | annotation column to transfer (repeatable) |
| `--query-* / --reference-*` | required (≥1 query rule) | classification (prefix / `col~substr`); or `--rules rules.yaml` |
| `--metric {euclidean,cosine}` | `euclidean` | **reconciled from the old cosine default** |
| `--k` | `1` | neighbours considered (Eq.5) |
| `--cutoff {none,fixed,reliability,percentile,edd}` | `none` | opt-in confidence gate |
| `--mine`, `--top-n` | off | opt-in neighborhood mining |
| `--lookup PATH` | auto sidecar | reuse/persist the reference lookup |
| `--report`, `--plots`, `--full-tables`, `--excel` | off | opt-in artifacts |

Subcommand name is an **open question** (§13): `transfer` (clear verb), `eat` (matches #54 / Rost-lab convention), or `neighbors` (old draft).

---

## 9. Frontend representation (extends PR #272, does not duplicate it)

**Two orthogonal axes — codify this mental model:**

- **Axis A (existing, #272): column-level provenance** — "this whole column is a model output" (Biocentral / Phobius / TED). Keep `AnnotationMeta.isPredicted`, the ⚡ dropdown/legend badge, and the info-popover **unchanged**.
- **Axis B (new, EAT): cell-level provenance** — "this specific protein's value was *transferred from a neighbour*, confidence X, source Y." New visual language below. Never overload the ⚡ badge to mean both.

### 9.1 Scatter plot — the primary cue is *shape*, not colour

- **Observed/curated cells → filled markers** (current behaviour). **EAT-imputed cells → hollow (outline-only) markers in the same category hue**, so cluster identity is preserved while provenance reads at a glance. This is an established convention (filled = observed, open = imputed) and satisfies "never colour-only" (accessibility; ~4% CVD).
  - Implementable in the existing WebGL renderer: add a per-point `a_predicted` float attribute (mirror the existing `a_shape` plumbing) and a ring-only branch reusing the current edge-distance/outline math (`strokeWidth = 0.15`, `webgl-renderer.ts`). No shader rewrite.
- **Confidence → redundant opacity (and optional size) ramp on imputed points only.** `alpha = lerp(0.25, 0.9, confidence)`; observed points stay at `baseOpacity 0.9`. Optionally scale size by `sqrt(confidence)`. For very low confidence (<0.3), desaturate toward grey (lightweight VSUP). Hooks: `getOpacity`/`getBaseOpacity`/`getPointSize` in `style-getters.ts`.

### 9.2 Tooltip — per-point provenance line

Extend `AnnotationBlock` + `renderAnnotationBlock` (`protein-tooltip.ts`) with an EAT row, distinct from observed values:

> ⚡ **Predicted:** Neurotoxin (82%) — transferred from **P12345** via ProtT5, k=1

with an inline confidence bar and the source id as a **click target** that selects/centres that reference in the scatter. Observed values render exactly as today (no chip).

### 9.3 Legend — a separate "Predicted (transferred)" sub-section

When the active annotation has any imputed cells, render a small group with two swatches — **filled = "Observed"**, **hollow = "Predicted by EAT"** — and a note "Faint = low confidence", plus live counts ("1,204 shown / 380 below threshold"). Add as a new optional block in `legend-renderer.ts` (alongside `renderHeader`). **Do not** merge into the ⚡ header badge (that is Axis A).

### 9.4 Global control — one "Predicted annotations" group near the dropdown/legend

- **Toggle "Show predicted annotations"** (off → imputed cells render neutral/N-A; only the curated layer shows).
- **Confidence-threshold slider** 0–100% with conventional bands (High >80 / Med 50–80 / Low <50); below-threshold imputed points **fade** (`fadedOpacity 0.15`) rather than vanish, preserving layout context.
- Feed `showPredicted` + `minConfidence` into `StyleConfig`; persist in `LegendPersistedSettings` so the choice survives reload/export. Keyboard-operable with `aria-valuetext`.

### 9.5 Data-model extension (frontend)

Mirror the existing parallel-array pattern (`annotation_scores`, `annotation_evidence` in `types.ts`):

```ts
// VisualizationData (optional, populated only when the bundle carries the overlay)
annotation_predicted?:        Record<string, (PredictedCell | null)[]>;
// PredictedCell = { confidence: number; sourceId: string; k?: number; method?: string }
```

Loader (`data-loader/utils/bundle.ts`) pivots the sparse `predicted_annotations` table into these arrays at parse time. Backward compatible: old bundles lack the table → no overlay; the parser already tolerates unknown columns/parts.

### 9.6 Frontend gotchas to respect

- Multi-label cells: treat a cell as imputed **only if all its values were transferred**; otherwise show observed with a tooltip note.
- Selection opacity must override confidence dimming (a clicked low-confidence point stays visible).
- Grayscale/PNG export: hollow-vs-filled must be the load-bearing cue (opacity alone is ambiguous in print). The export path renders the same shader, so hollow survives export — verify at 570K points.
- This is a **separate frontend PR** (depends on the backend emitting the overlay) and warrants its own OpenSpec change in `protspace_web`, building on #272's `annotation-metadata`/`annotation-presentation` capabilities.

---

## 10. Dependencies & packaging

- **`protlabel`** uses only `numpy`, `scipy`, `h5py` (all already in the ProtSpace stack). It is a **second top-level package in the protspace repo** (`src/protlabel/`), built into the protspace wheel via `[tool.hatch.build.targets.wheel] packages = ["src/protspace", "src/protlabel"]` — *not* a suite-level uv workspace member (the suite root is not a uv workspace, and a separate distribution would need its own PyPI release/CI). It imports nothing from `protspace` (a guarded boundary), so a future standalone split is mechanical.
- Add **`scipy`** to `protspace` via `uv add 'scipy>=1.10'` (currently only transitive via sklearn; `cdist` needs it explicit).
- **faiss-cpu** is a *future* optional accelerator (`protspace[ann]`), out of MVP scope. Rejected for cross-platform CLI: hnswlib (sdist-only) and ScaNN (no macOS wheels).

---

## 11. Testing

`protlabel` (engine, fast, no ProtSpace deps):
- `test_transfer.py` — synthetic ref/query sets with known nearest neighbours (Euclidean + cosine); RI values at known distances (`d=0→1.0`, `d=0.5→0.5`); k=1 vs k>1 agreement weighting.
- `test_lookup.py` — build/serialize/load round-trip; sidecar rebuild-on-demand; brute-force vs faiss parity (when faiss installed).

`protspace`:
- `test_transfer_cli.py` — end-to-end on `data/sizes/phosphatase.h5` after `protspace prepare`; overlay table round-trips through the bundle; old (4-part) bundles still read.
- `test_classification.py` — prefix/substring/case rules, empty-query error (no hardcoded biology).
- `test_gating.py` — fixed/reliability/percentile/EDD on known-elbow curves (incl. degenerate `n<15` fallback).

`protspace_web` (in its own PR): unit tests for the overlay parser + `style-getters` predicted branch; browser checks for hollow markers, legend sub-section, threshold slider, grayscale export.

---

## 12. Docs & notebook

- `protspace/docs/cli.md`: new `### protspace transfer` section; cite EAT papers.
- `protspace/docs/annotations.md`: document the predicted-overlay columns so `protspace_web`'s registry stays aligned (the #272 contract note already points here).
- New `notebooks/ProtSpace_Transfer.ipynb` — a lean annotation-transfer story on a public dataset (not the full v1.7.4 reproduction).
- Update top-level `CLAUDE.md` CLI table; pre-commit checklist (ruff + docs + notebook).
- `protspace_web/docs/guide/annotations.md` generator: extend for the predicted-by-transfer legend/UX.

---

## 13. Open questions / decisions for the user

1. **Subcommand name:** `transfer` (clear verb, recommended), `eat` (matches #54 / Rost-lab brand), or `neighbors` (old draft)?
2. **Overlay vs new column:** per-cell overlay on the original column (recommended, richer viz) or a separate `predicted_<col>` column (simpler, mirrors Biocentral)?
3. **`protlabel` scope:** EAT engine only (recommended first), or also bundle the ProtTucker/CLEAN "learned distance" mode now?
4. **Default cutoff:** ship with `--cutoff none` (transfer everything, let the user filter on reliability — recommended) or a default reliability floor?
5. **Frontend timing:** build the backend + overlay first and the frontend PR second (recommended), or design both in lockstep?
6. **Reconcile or supersede #54:** post this design as the plan on issue #54 and keep #54 as the engine tracking issue?

## 14. Non-goals

- No statistical FDR/hypothesis testing (RI is a heuristic ranking, ProtT5-calibrated only).
- No automatic UniProt fetch of references — references are whatever is already in the bundle.
- No legacy `output.json` support (point users to `protspace bundle`).
- No shipping ProtTucker weights initially (raw-embedding EAT needs no training).
- The frontend work is a *separate* PR; this spec only specifies the representation.

## 15. Citations

- Littmann, Heinzinger, Olenyi, Dallago, Rost. "Embeddings from protein language models predict conservation and ... / Embedding-based annotation transfer." *Sci Rep* 2021. DOI 10.1038/s41598-020-80786-0 — **RI formula (Eq. 5), GO results.**
- Heinzinger, Littmann, Sillitoe, Bordin, Orengo, Rost. "Contrastive learning on protein embeddings enlightens midnight zone." *NAR Genom Bioinform* 2022. DOI 10.1093/nargab/lqac043 — **generic EAT tool, Euclidean>cosine, CATH 1.1-threshold calibration, ProtTucker.**
- goPredSim — https://github.com/Rostlab/goPredSim (reliability code, 2-column label format). EAT tool — https://github.com/Rostlab/EAT (`eat.py` interface).
- CLEAN (EC, contrastive + centroids), *Science* 2023, DOI 10.1126/science.adf2465 — documented learned-distance upgrade path.
- VSUP (Correll, Moritz, Heer, CHI 2018); ScatterUQ (arXiv 2308.04588); imputed-vs-observed marker convention (mclust) — frontend uncertainty UX.

---

*Verification note: an adversarial pass confirmed the RI formula, Euclidean default, k=1, the eat.py contract, and the 1.1/≈90% calibration against primary sources; it corrected the historical framing (Euclidean>cosine is the 2022 paper's claim, not the 2021 one), the CATH comparison numbers (raw ProtT5 EAT H-level ≈64, HMMER ≈77, MMseqs2 ≈35), and the confidence aggregation (use Eq.5 directly, not a `reliability×vote` product). The storage/compute math reproduced exactly (binary units; the SI labels were ~5% low) and the "sidecar not bundle / brute-force default" recommendations were judged sound.*
