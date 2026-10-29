## Why

`esm2_3b` and `esmc_6b` are blocked on free Colab (`COLAB_OVERSIZED`, host RAM under 16 GB) because
the local backend built the whole model in host RAM and then copied it to the GPU. ESM-C 6B in half
precision is 12.7 GB, as much as the free runtime's RAM, and running out kills the kernel.

The local backend now loads straight onto a CUDA GPU (`device_map`), placing each weight as it is
read. Measured on free Colab (Tesla T4, 14.6 GB VRAM, 12.7 GB RAM), through `setup_model`:

| model            | load  | peak host RAM (anon) | peak GPU                |
| ---------------- | ----- | -------------------- | ----------------------- |
| `esmc_6b` (fp16) | 112 s | 0.62 GB              | 12.5 GB while embedding |
| `esm2_3b` (fp32) | 50 s  | 0.52 GB              | 11.0 GB while embedding |

Both embed sequences up to 2,000 aa with finite vectors, and ESM-C 6B takes 5.4 min per 1,000
proteins (mean 385 aa). The free T4 is the runtime most users have, and the smallest Colab GPU, so
the gate now blocks these models for nothing.

## What Changes

- On a CUDA GPU, `setup_model` loads every checkpoint with `device_map=<the GPU>` (needs
  `accelerate`, now in the `[local]` extra; without it loading falls back to host RAM).
- New public `local.stages_in_host_ram()`: True where a load still builds the whole model in host
  RAM (no CUDA GPU, or no `accelerate`). `COLAB_OVERSIZED` keeps its two models.
- The Preparation panel blocks `COLAB_OVERSIZED` only where loading stages the model in host RAM
  _and_ RAM is under 16 GB. A released package without `stages_in_host_ram` counts as staging, so
  4.18.0 and earlier stay blocked as before.
- `embed_sequences` warns about an oversized model only where it stages in host RAM.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `embedding-backend-selection`: oversized checkpoints are blocked only where they are staged in
  host memory; GPU loading places weights directly; ESM-C 6B runs on a free Colab GPU runtime.

## Impact

- `apps/protspace/src/protspace/data/embedding/local.py`, `apps/protspace/pyproject.toml` +
  `uv.lock` (`accelerate`).
- `notebooks/ProtSpace_Preparation.ipynb` (oversized gate).
- Tests: `test_local_embedder.py`, `test_notebooks.py`.
- Docs: `docs/guide/python-cli.md`, `apps/protspace/CLAUDE.md`.
- The ClickThrough Embeddings notebook (tsenoner/protspace#563) has its own loader and 16 GB gate;
  it gets the same change there.
