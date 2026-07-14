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
| PR3 | Empirical local-vs-Biocentral pooling parity cross-check + docs (resolves the deferred Ankh-pooling / `reduce=True` server black-box question) | ⬜ next |
| PR4 | Notebook: default to local-in-Colab via `resolve_default_backend()` | ⬜ |
| PR5 | Wire the dead `--stats` toggle into the Preparation notebook | ⬜ |
| PR6 | Append optional EAT to the Preparation notebook | ⬜ |

**#59 is functionally addressed once PR1 → PR2 → PR4 land** — the CLI can already embed fully
offline today. PR3, PR5, PR6 are hardening + notebook/UX surface.

## Decisions still owed by the maintainer (don't assume)

1. Confirm Synthyra-for-ESM-C.
2. Run + set a tolerance for the Biocentral-vs-local pooling cross-check (`reduce=True` is a
   server-side black box — the one unverified parity item).
3. `esm2_3b` free-tier policy (gate / warn / hide).
4. `ankh3_large` `[NLU]` vs `[S2S]` prefix.
5. Scope #59 to embeddings only, or also the `predicted_*` annotation server dep
   (`biocentral_retriever.py`).
6. Local backend micro-batch config (Biocentral's `batch_size=1000` is an API-request batch, not
   a GPU micro-batch) — addressed in PR2 via `LocalEmbedConfig` (default 8).

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
