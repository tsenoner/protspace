## Why

ESM3-open was the only model in the Embeddings notebook that still needed the EvolutionaryScale
`esm` package. That package pins `transformers<5`: installing it replaced Colab's transformers 5
and huggingface_hub 1 with older versions, which then imported TensorFlow, JAX and torchao. The
notebook carried an install helper, framework switches and a separate embedding loop just for it.
The user decided to drop ESM3.

## What Changes

- **BREAKING (notebook only)**: `biohub/esm3-sm-open-v1` is no longer offered. ESM C (300M, 600M,
  6B) loads only through transformers' own `esmc` model.
- The notebook installs nothing. Its copy of the install helper, the TensorFlow/JAX/torchao
  switches and the one-sequence-at-a-time ESM3 loop go. The Preparation and Transfer notebooks
  keep the helper.
- When transformers predates 5.16 (no `esmc` model), the load failure names the upgrade instead of
  "see the error below".
- `esm3_open` stays a known model key in the package (`MODEL_DISPLAY_NAMES`), so `.h5` files the
  notebook wrote with ESM3 are still named on load.

## Capabilities

### Modified Capabilities

- `notebook-embedding-generation`

## Impact

`ClickThrough_GenerateEmbeddings.ipynb`, `tests/test_notebooks.py` (install-helper tests limited
to the notebooks that install), one comment in `embedding_set.py` and one file-name case in
`tests/test_h5_embedding_name.py`, the READMEs, `docs/guide/data-preparation.md`,
`docs/guide/python-cli.md`, `apps/protspace/CLAUDE.md`, and the helper's marker comment in the
other two notebooks.
