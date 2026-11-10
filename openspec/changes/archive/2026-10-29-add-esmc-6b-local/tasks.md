## 1. Backend

- [x] 1.1 Add `esmc_6b` → `("biohub/ESMC-6B", "esmc")` to `LOCAL_CHECKPOINTS` and to `COLAB_OVERSIZED`;
      make the oversized warning dtype-neutral
- [x] 1.2 Load `biohub/ESMC-6B` in bf16 on a CUDA device that supports it, fp16 on other CUDA
      devices, fp32 on CPU
- [x] 1.3 `biocentral.resolve_embedder` names `--backend local` for a local-only key

## 2. CLI

- [x] 2.1 `EMBEDDER_MODELS` gains `esmc_6b`; add `LOCAL_ONLY_EMBEDDERS` in `common_options.py`
- [x] 2.2 `prepare` and `embed` refuse a local-only shortcut on the Biocentral backend before any work
- [x] 2.3 Display name `ESMC-6B` in `embedding_set.py`

## 3. Notebook

- [x] 3.1 Preparation panel blocks `ALL_EMBEDDERS - ALL_SHORT_KEYS` on Biocentral (guarded import of
      `ALL_SHORT_KEYS`), generic Biocentral note
- [x] 3.2 `COLAB_OVERSIZED` fallback literal gains `esmc_6b`
- [x] 3.3 ClickThrough Embeddings notebook: check whether it lists ESM-C sizes (it uses the `esm`
      SDK, which has no 6B; leave it if so)

## 4. Tests

- [x] 4.1 `test_local_embedder.py`: 6B resolution, local registry ⊇ Biocentral, half-precision dtype
      choice with a fake `transformers`/`torch`
- [x] 4.2 `test_cli_no_similarity.py`: registry pins for `EMBEDDER_MODELS` and `LOCAL_ONLY_EMBEDDERS`
- [x] 4.3 `test_backend_switch.py`: `prepare`/`embed` refuse `esmc_6b` on Biocentral, `resolve_embedder`
      message
- [x] 4.4 Notebook test: `esmc_6b` disabled on the Biocentral backend

## 5. Precision check on real weights

- [x] 5.1 Embed a few proteins (including one near the 2000-residue cap) with fp32 on CPU and bf16 /
      fp16 (on Apple MPS, which has bf16); report cosine, relative L2 and finiteness against fp32
- [x] 5.2 Decide whether fp16 is acceptable on GPUs without bf16; record the numbers in the PR

## 6. Docs

- [x] 6.1 `apps/protspace/CLAUDE.md`: embedder table, local-only note, test table rows
- [x] 6.2 `docs/guide/python-cli.md`: shortcut list, licensing, local backend section
- [x] 6.3 `local.py` module docstring and the "same 12 shortcuts" comments

## 7. Checks

- [x] 7.1 `uv run pytest -m "not slow"`, `uv run --with ipywidgets==7.7.1 pytest tests/test_notebooks.py`
- [ ] 7.2 `openspec validate --strict`, `pnpm precommit`
