## Why

The local embedding backend (`--backend local`, and through it `embed`, `prepare` and the
Preparation notebook's local path) serves `esmc_300m` / `esmc_600m` from Synthyra's ESM++
reimplementation, loaded with `trust_remote_code=True`. That was a workaround: `transformers` had no
`esmc` model type, and the official `biohub/ESMC-*` repos ship no remote code. The port
(huggingface/transformers#46419) merged on 2026-08-20 and first shipped in transformers 5.16.0, so
the official MIT weights now load through plain `AutoModel` / `AutoTokenizer`, the way the Colab
Embeddings notebook already loads them. Running third-party modeling code is no longer needed.

## What Changes

- `esmc_300m` / `esmc_600m` on the local backend load `biohub/ESMC-300M` / `biohub/ESMC-600M`
  through transformers' native `esmc` model, with no `trust_remote_code`.
- The ESM-C special case in tokenization (Synthyra's tokenizer only takes the basic call) is
  removed; ESM-C now goes through the same tokenizer call as every other family, including
  truncation to `max_length`. The `gc.collect()` before `empty_cache` stays: the native model is
  still held by reference cycles after `del` (measured), so only its comment changes.
- The `[local]` extra's `transformers` floor rises from 5.13.1 to 5.16.0, the first release with
  `esmc`.
- The per-protein vectors are unchanged (verified on real weights), so `.h5` files written by
  earlier local runs keep their producer stamp (`backend=local`, `model=esmc_*`) and resume as
  before.
- The Biocentral backend is unchanged: it still sends the Synthyra ids, and `esmc_*` stays blocked
  there in the notebook (Biocentral loads ESM++ as ESM-2, a separate server-side bug).

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `embedding-backend-selection`: adds a requirement that the local backend serves ESM-C from the
  official checkpoints through transformers' native model, producing the same vectors as the
  earlier reimplementation so existing caches stay valid.

## Impact

- `apps/protspace/src/protspace/data/embedding/local.py` (`LOCAL_CHECKPOINTS`, `setup_model`,
  `_embed_batch`, the cleanup in `embed_sequences`).
- `apps/protspace/pyproject.toml` and the root `uv.lock` (`transformers>=5.16.0` in `[local]`).
- `apps/protspace/tests/test_local_embedder.py`.
- Docs: `apps/protspace/CLAUDE.md` (embedder table and licensing note), `docs/guide/python-cli.md`.
- No CLI, bundle, cache-format or Biocentral change. Users on `transformers<5.16` who install
  `protspace[local]` get transformers upgraded.
