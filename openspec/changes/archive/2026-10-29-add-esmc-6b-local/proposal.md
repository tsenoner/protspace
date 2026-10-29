## Why

ESM-C 6B (`biohub/ESMC-6B`) is public, MIT-licensed, and loads through the same native
`transformers` path as the 300M and 600M models, but protspace cannot use it. Biocentral (v2.0.1)
accepts the id but fails the task ("Loading of embeddings failed before export!", twice, while
`esmc_300m` worked at the same moment), so for now only the local backend can serve it.

## What Changes

- New embedder shortcut `esmc_6b` → `biohub/ESMC-6B` (2560-d), served by `--backend local` only.
- On a CUDA device the local backend loads ESM-C 6B in half precision: bf16 where the GPU supports
  it (ESM-C was trained in bf16), fp16 otherwise. On CPU it stays fp32. Its fp32 weights are 25.4 GB.
- `esmc_6b` joins `COLAB_OVERSIZED`, so the Colab panel blocks it on runtimes under 16 GB of RAM.
- A local-only shortcut is refused on the Biocentral backend: `prepare` and `embed` stop with a usage
  error that names `--backend local` before any work is done, and the Colab panel disables it there.
- The "every shortcut is served by both backends" invariant becomes "every Biocentral shortcut is
  served locally; the local backend may serve more, listed as local-only". `BIOCENTRAL_INVALID` is
  not used for this, so its removal (#559) is unaffected.
- Display name, CLI help, docs and the embedder table list `esmc_6b`.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `embedding-backend-selection`: adds local-only embedders (refused on Biocentral by the CLI and the
  panel), the ESM-C 6B shortcut and its half-precision loading, and narrows "the CLI accepts
  `esmc_*` on either backend" to the shortcuts Biocentral serves.

## Impact

- `apps/protspace/src/protspace/data/embedding/local.py` (checkpoint, oversized set, dtype),
  `data/embedding/biocentral.py` (error for a local-only key), `cli/common_options.py`,
  `cli/prepare.py`, `cli/embed.py`, `data/loaders/embedding_set.py`.
- `notebooks/ProtSpace_Preparation.ipynb`: Biocentral gating also covers local-only shortcuts;
  `COLAB_OVERSIZED` fallback literal.
- Tests: `test_local_embedder.py`, `test_cli_no_similarity.py`, `test_backend_switch.py`,
  `test_notebooks.py`.
- Docs: `apps/protspace/CLAUDE.md`, `docs/guide/python-cli.md`.
- No dependency change: `transformers>=5.16` already loads ESM-C 6B.
