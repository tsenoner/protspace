## Why

The package added `esmc_6b` (`biohub/ESMC-6B`, 2560-d) as a local-only shortcut in 4.18.0, loaded
in half precision on a GPU. The Embeddings notebook offers ESM C 300M and 600M through
transformers' own `esmc` model but not 6B, so a Colab user who wants the largest ESM C has to
switch to the CLI.

## What Changes

- The Embeddings notebook offers `biohub/ESMC-6B` under the short key `esmc_6b`, loaded with the
  same model class and pooling as 300M and 600M (no `esm` package, no login).
- On a GPU it loads in bf16 where the GPU has native bf16 (Ampere and newer), else fp16; on a CPU
  in fp32. This matches the package's local backend.
- Before downloading 6B, the notebook stops on a runtime with less than 16 GB of host RAM (32 GB on a
  CPU) and names the fix. On free Colab, transformers fills its 12.7 GB of host RAM while building
  the model, and the kernel dies without an error. A GPU with less than 24 GB gets a warning
  instead, because short sequences still fit.

## Capabilities

### Modified Capabilities

- `notebook-embedding-generation`

## Impact

`ClickThrough_GenerateEmbeddings.ipynb`, its tests in `tests/test_notebooks.py`, the notebook's
rows in `apps/protspace/CLAUDE.md`, and one sentence each in `docs/guide/data-preparation.md` and
`docs/guide/python-cli.md`. No package code changes.
