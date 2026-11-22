## Why

The `examples` release, which both Colab notebooks download from, holds a ready-made bundle beside
each example's ProtT5 embeddings. Those five bundles were mirrored byte for byte from the
pre-monorepo release: legacy v1 files, whose reading ends in protspace 5.0.0, with annotations from
an older parser. The Transfer notebook runs EAT on one of them. The Preparation notebook's Example
tab ignores them and fetches the same annotations again on every Generate. For the Snake Toxin
example (5,015 proteins), that fetch took about 20 minutes on Colab before
tsenoner/protspace#557.

## What Changes

- New release assets `<name>_v3.parquetbundle` for the five examples: v3 bundles with each old
  bundle's projections and annotations fetched again for the same proteins with the current
  package, built by `scripts/generate_examples/refresh_colab_examples.py`. The v1 files stay in the
  release untouched.
- The Preparation notebook's Example tab takes every requested annotation column the example's
  `_v3` bundle holds from it, and fetches only the rest (and a custom CSV). "Fetch annotations
  again", or a bundle that cannot be read, fetches everything as before.
- The Transfer notebook runs on `snake_toxin_v3.parquetbundle`, and its counts are those of the new
  bundle: the 682 entries UniProt has deleted since the example was built now have no annotations.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `notebook-input-handling`: an Example-tab run reuses the example bundle's annotations.
- `notebook-annotation-transfer`: the Transfer notebook's example is the v3 Snake Toxin bundle.

## Impact

- `apps/protspace/notebooks/ProtSpace_Preparation.ipynb`, `ProtSpace_Transfer.ipynb`.
- `apps/protspace/scripts/generate_examples/refresh_colab_examples.py` (new), its README entry.
- `apps/protspace/tests/test_notebooks.py`.
- Release `examples`: five new assets.
