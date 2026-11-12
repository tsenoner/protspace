## Why

The Embeddings notebook stopped ESM C 6B on free Colab (12.7 GB of RAM) because transformers built
the whole model in host RAM before moving it to the GPU. Loading with `device_map=<the GPU>` places
each weight as it is read instead. Measured on a free T4 (14.6 GB VRAM) through the package's local
backend, which loads the same weights the same way: ESM C 6B peaked at 0.62 GB of RAM while loading
and at 12.5 GB of GPU memory while embedding, sequences up to 2,000 aa included, at 5.4 min per
1,000 proteins. The free T4 is what most users have, so the notebook should run 6B there.

## What Changes

- On a GPU every model loads with `device_map=<the GPU>` when `accelerate` is importable (Colab
  ships it, so the notebook still installs nothing).
- The RAM stop applies only where the load goes through host RAM: no GPU (32 GB for 6B in fp32), or
  a GPU without `accelerate` (16 GB, with `pip install accelerate` as the fix).
- The "little room for long sequences" warning applies below a 16 GB card instead of 24 GB: a T4
  holds 6B with 2,000-residue sequences.
- Form text and docs say the free T4 runs ESM C 6B.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `notebook-embedding-generation`: ESM C 6B runs on a free Colab T4.

## Impact

- `notebooks/ClickThrough_GenerateEmbeddings.ipynb`, `tests/test_notebooks.py`.
- Docs: `docs/guide/data-preparation.md`, `docs/guide/python-cli.md`, `apps/protspace/CLAUDE.md`.
- The package's local backend gets the same loading rule in tsenoner/protspace#564.
