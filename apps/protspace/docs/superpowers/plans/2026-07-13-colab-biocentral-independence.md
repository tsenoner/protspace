# Colab / Biocentral independence (issue #59)

**Issue:** [tsenoner/protspace#59](https://github.com/tsenoner/protspace/issues/59) — "The Google
Colab notebook should be independent of Biocentral."

**Goal:** the Colab notebooks (and the CLI) must be able to generate embeddings even when the
remote Biocentral API is down — by embedding on the local Colab GPU — while still allowing
Biocentral as an explicit choice. Secondary: surface the newer EAT (`protspace transfer`) and
statistics (`prepare --stats`) features in the notebooks.

Investigation done 2026-07-13 (multi-agent research workflow). This plan was ported into the
`protspace_web` monorepo (`apps/protspace`) on 2026-07-14 when the Python backend and web
frontend were merged into a single repo; PR1 + PR2 below were originally opened against the
standalone `tsenoner/protspace` repo (#73, #74) and re-landed here as one consolidated PR.

## Key findings

- `notebooks/ClickThrough_GenerateEmbeddings.ipynb` **already** embeds locally on the Colab GPU
  (12 models, HF transformers + native ESM) — the #59 capability exists but was siloed in a
  notebook and H5-only. This is a consolidation problem, not a greenfield one.
- `notebooks/ProtSpace_Preparation.ipynb` FASTA + UniProt-query tabs are the **only** Biocentral
  chokepoint, via `embed_fasta()` → `biocentral.embed_sequences()`.
- **Statistics is documented-but-dead** in the Preparation notebook: the `_on_gen` handler never
  calls `pipeline._compute_statistics` (which exists and is used by `run()`). `save_output`
  already accepts `statistics=` / `settings=`. Wiring it is a ~3-edit fix, no signature changes.
- EAT lives in a standalone `ProtSpace_Transfer.ipynb`.

## Recommended approach (Option B — chosen)

New `src/protspace/data/embedding/local.py` with the **same signature** as
`biocentral.embed_sequences`; thread `backend={local,biocentral}` through the single seam
`embed_fasta()` + add `protspace embed --backend local`; ship as an optional extra
`protspace[local]` (lazy torch/transformers imports, mirroring the `[frontend]` extra). Default
backend = local when running on Colab **and** CUDA is available, else biocentral.

Rejected alternatives:
- Notebook-only inlining — silos the logic, untestable.
- Running `biocentral-api` locally — it is a strict REST client; would need a self-hosted
  `biocentral_server` with GPU + docker.

Additional decisions baked in:
- **Pin Synthyra ESM++ for `esmc_*`** (not native EvolutionaryScale) — ungated, plain
  transformers, MSE ≈ 7.7e-10 vs native.
- Per-family special-token strip + mean-pool. **Ankh must NOT be space-joined**: its vocab has a
  bare `M`=19 but `▁M`=`<unk>`, so raw-string tokenization is correct; `is_split_into_words` /
  space-joining injects `<unk>` before every residue.
- All 12 models fit the free T4 **except** `esm2_3b` (marginal → L4/A100). None of the
  recommended checkpoints are HF-gated.

## PR roadmap

| PR | Scope | Status |
|----|-------|--------|
| PR1 | `local.py` + `[local]` extra + `test_local_embedder.py` | ✅ done (was #73) |
| PR2 | `-b/--backend {biocentral,local}` switch on `embed` + `prepare`, `embed_fasta(backend=)` dispatch, `resolve_default_backend()`, backend-aware `--batch-size`, `test_backend_switch.py` | ✅ done (was #74) |
| PR3 | Empirical local-vs-Biocentral pooling parity cross-check + docs (resolves the deferred Ankh-pooling / `reduce=True` server black-box question) | ✅ done (2026-07-16) — see PR3 results below |
| PR4 | Notebook: default to local-in-Colab via `resolve_default_backend()` | ✅ done (2026-07-17) — see PR4 results below |
| PR5 | Wire the dead `--stats` toggle into the Preparation notebook | ✅ done (2026-07-17) — see PR5 results below |
| PR6 | Append optional EAT to the Preparation notebook | ⬜ |

**#59 is functionally addressed once PR1 → PR2 → PR4 land** — the CLI can already embed fully
offline today. PR3, PR5, PR6 are hardening + notebook/UX surface.

## PR3 results — local ↔ Biocentral parity (measured 2026-07-16)

Method: 25 deterministic sequences from `data/Pla2g2/Pla2g2.fasta` (sorted by id, first 25);
embed each via the local backend and via Biocentral (`reduce=True`); align by id; per-protein
cosine + relative L2 (`‖local−bio‖/‖bio‖`). Bar: **min cosine ≥ 0.99** for every family. Throwaway
script run in an isolated worktree venv; not committed.

| Family (checkpoint) | code path | mean cos | min cos | mean relL2 | verdict |
|---|---|---|---|---|---|
| `prot_t5` | T5, space-join, trailing-EOS strip | 1.00000 | 1.00000 | 0.00000 | ✅ PASS |
| `prost_t5` | T5, `<AA2fold>` prefix | 1.00000 | 1.00000 | 0.00061 | ✅ PASS |
| `esm2_650m` | ESM, CLS+EOS strip *(stands in for all esm2_\*)* | 1.00000 | 1.00000 | 0.00000 | ✅ PASS |
| `ankh_base` | Ankh, raw-string tok, trailing-EOS strip | 0.99992 | 0.99991 | 0.01274 | ✅ PASS |
| `ankh3_large` | Ankh, **no prefix** | 0.99991 | 0.99987 | 0.01363 | ✅ PASS |
| `esmc_300m` | Synthyra ESM++ | 0.02162 | 0.00637 | 0.99976 | ❌ FAIL (Biocentral anomaly — see below) |

**5 / 6 families pass with huge margin** (worst min cosine 0.99987). The 0.0006–0.014 relative-L2 on
the passing families is just half-vs-full precision drift (local uses `*_half`/`*_fp16` variants).

**ESM-C is the lone failure, and the local backend is _not_ at fault.** Native EvolutionaryScale
ESM-C (`esm` pkg, `esmc_300m`) produces a **bit-identical** pooled vector to Synthyra ESM++
(both norm 0.77, both cosine 0.007 vs Biocentral) — so Synthyra == native == the standard ESM-C
embedding. Biocentral's ESM-C vector (norm ~29) is **orthogonal to the standard embedding at every
one of the 31 hidden layers** (best layer match cosine 0.08). Every *other* family matches Biocentral
at ≈1.0, so our pooling convention is correct; the anomaly is isolated to **Biocentral's ESM-C
handling**. **Root cause found in `biotrainer`** (its embedding engine): ESM-C has no dedicated
embedder, so `Synthyra/ESMplusplus_small` hits the generic loader, whose
`_determine_tokenizer_and_model()` picks the architecture by **substring** — `"esm" in
"esmplusplus"` is True → it loads the ESM-C checkpoint as a vanilla **ESM-2** model
(`EsmModel`/`EsmTokenizer`, no `trust_remote_code`, wrong tokenizer). transformers even warns
"*using a model of type `ESMplusplus` to instantiate a model of type `esm` … not supported*". So
Biocentral never runs the real ESM-C model — the embeddings are meaningless. Reported to the
Biocentral maintainer (`biocentral-esmc-issue.md`, with the fix: add a dedicated ESM-C embedder /
stop matching on the loose `"esm"` substring). Switching local ESM-C to native would **not** help
(native == Synthyra) and would add a gated/heavier dep for no benefit, so **local ESM-C stays
Synthyra**.

Availability note: Biocentral was mid-outage during this work; `esm2_8m/35m/150m` and (transiently)
all six failed server-side at times — `esm2_650m` was used as the ESM-family reference since the
smaller ESM2 checkpoints were not loaded server-side.

## PR4 results — Preparation notebook backend switch (2026-07-17)

`notebooks/ProtSpace_Preparation.ipynb` now embeds via the local backend by default on Colab,
closing the functional half of #59 (PR1 → PR2 → PR4). Changes, all confined to the notebook:

- **Install cell** pulls `protspace[local]` (was bare `protspace`) so torch/transformers are
  present; torch is preinstalled on Colab, so the extra only adds transformers/sentencepiece/
  protobuf/einops.
- **Input cell** grows a **Backend** dropdown next to the embedder multi-select (shown on the
  FASTA + UniProt-query tabs): `Auto` (default) → `resolve_default_backend()` (local on a Colab
  GPU, else Biocentral), plus explicit `Local` / `Biocentral`. FASTA-tab copy updated to describe
  both backends.
- **ESM-C gating:** whenever the *effective* backend is Biocentral, `esmc_300m` / `esmc_600m`
  checkboxes are unchecked + disabled with an inline warning (Biocentral's ESM-C output is invalid
  per the PR3 root-cause), re-enabled under Local. A defensive `_drop_incompatible()` also filters
  them in the generate handler.
- **Generate handler** resolves `(backend, embed_config)` once via `_resolve_backend_and_config()`
  (`LocalEmbedConfig` vs `EmbedConfig`) and threads `backend=` into both `embed_fasta()` call
  sites; the H5/query tabs are unchanged.

Verified: notebook is valid `nbformat`, all code cells parse, both `embed_fasta` calls pass
`backend=`, no hardcoded `EmbedConfig()` remains; helper logic (auto-resolution, config-type-per-
backend, ESM-C drop) unit-checked against the real backend symbols; `test_backend_switch.py` +
`test_local_embedder.py` (fast) green. The notebook can only run end-to-end inside Colab (needs
`google.colab`), so runtime embedding is exercised there, not in CI.

## PR5 results — Preparation notebook statistics toggle (2026-07-17)

The Preparation notebook's `--stats` capability was documented-but-dead: the generate handler
built the bundle without ever calling `_compute_statistics`, so `save_output`'s `statistics=` /
`settings=` slots were always empty. PR5 wires it up (notebook-only, generate cell):

- A **"Compute quality statistics"** checkbox (off by default) in the form, under a new "Quality
  statistics" heading.
- `PipelineConfig(..., stats=compute_stats_cb.value)`.
- After `_run_reductions`, and **before** `create_output`, call
  `pipeline._compute_statistics(embedding_sets, all_reductions, all_headers, metadata)` — it
  mutates `metadata` (per-protein `cluster_elbow_*` columns) and each reduction's
  `info["quality"]` (faithfulness) **in place**, so ordering matters — then thread
  `statistics=` / `settings=stats_settings or None` into `save_output`. This mirrors
  `ReductionPipeline.run()` exactly.

Verified end-to-end **offline** (stats needs no Colab/GPU): drove the exact wiring against
`data/Pla2g2/Pla2g2_prot_t5.h5` (448 proteins, PCA2+UMAP2, a synthetic 3-category annotation).
Result: 5-part bundle (all parts non-empty), statistics table = 15 rows, `metadata` gained two
`cluster_elbow_*` columns, cluster-legend `settings` built, and both projections'
`info["quality"]` carry `knn_overlap / trustworthiness / continuity / random_triplet /
spearman_distance`. `test_stats_bundle` + `test_stats_carriage` + `test_stats_cli` green. Only
PR6 (append EAT) remains.

## Decisions still owed by the maintainer (don't assume)

1. ~~Confirm Synthyra-for-ESM-C.~~ **RESOLVED (PR3):** Synthyra == native EvolutionaryScale ESM-C
   (bit-identical pooled output). Keep Synthyra (ungated). It does **not** match Biocentral, but that
   is a Biocentral-side ESM-C anomaly, not a local defect.
2. ~~Run + set a tolerance for the Biocentral-vs-local cross-check.~~ **RESOLVED (PR3):** all
   non-ESM-C families ≥ 0.99987 cosine; ≥ 0.99 is met with wide margin. ESM-C excluded with a
   documented reason (Biocentral anomaly).
3. `esm2_3b` free-tier policy (gate / warn / hide). *(still open)*
4. ~~`ankh3_large` `[NLU]` vs `[S2S]` prefix.~~ **RESOLVED (PR3):** **no prefix** — the current
   raw-string, no-prefix implementation matches Biocentral at cosine 0.9999.
5. Scope #59 to embeddings only, or also the `predicted_*` annotation server dep
   (`biocentral_retriever.py`). *(still open)*
6. Local backend micro-batch config — addressed in PR2 via `LocalEmbedConfig` (default 8).

## Follow-up owed to Biocentral

The ESM-C (`esmc_300m`, `Synthyra/ESMplusplus_small`) embeddings returned by the Biocentral API are
orthogonal to the model's own standard output. A hand-off note for the Biocentral maintainer was
drafted (see the session's `biocentral-esmc-issue.md`).

## Adversarial-review fixes already applied (PR1/PR2)

- Empty-`.h5` guard: `embed_sequences` raises if all sequences were skipped, instead of returning
  a path to an absent/empty file that later crashes `load_h5`.
- VRAM release: inline `del model, tokenizer; gc.collect(); torch.cuda.empty_cache()` in the
  caller frame (a `_cleanup(model)` helper did not drop the caller's reference, so
  `empty_cache()` freed nothing).
- Non-positive `--batch-size` hang: `min=1` on the shared option + `LocalEmbedConfig.__post_init__`
  validation (a `0`/negative micro-batch would spin forever after loading the model).
- **Ankh space-join finding REFUTED** — see the per-family note above; do not "fix" Ankh to
  space-join.
