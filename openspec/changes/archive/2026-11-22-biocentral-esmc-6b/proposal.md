## Why

Biocentral v2.1.0 (deployed 2026-11-22) fixes biocentral/biocentral#108: the server now computes
`biohub/ESMC-6B` at its default precision. Checked live on 2026-11-22, it embedded 1 of 1 and 60 of
60 sequences (2560-d, all finite), and four of those vectors (ubiquitin and three Pla2g2 proteins
from the batch of 60) match a local fp32 run at cosine ≥ 0.9999995, each closer to its own protein
than to any other (≤ 0.845). So `esmc_6b` no longer needs to be local-only (#561).

The same release-lag reason that kept `BIOCENTRAL_INVALID` has run out too (#559): every protspace
release since 4.18.0 sends the official ESM-C ids, so the set is empty in every release the
notebook can install, and the daily canary already catches a server that answers with another
model.

## What Changes

- `esmc_6b` → `biohub/ESMC-6B` becomes a Biocentral shortcut (`EXTRA_SHORT_KEYS`). Every CLI
  shortcut is now served by both backends.
- **Removed:** `LOCAL_ONLY_EMBEDDERS`, the CLI's refusal of a local-only shortcut on Biocentral
  (`refuse_local_only_on_biocentral`), `resolve_embedder`'s local-only message, the help suffix
  and the Preparation panel's Biocentral gate. None has anything left to refuse.
- The daily canary also compares Biocentral's ubiquitin `esmc_6b` vector with a committed reference
  from the local backend (official weights, fp32).
- **Removed:** `BIOCENTRAL_INVALID` and the Preparation notebook's import of it (#559).
- Tests no longer name Synthyra's ESM++ reimplementation, which no code path loads.
- No precision change in the client: the server's default works, so `use_half_precision` is not
  sent.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `embedding-backend-selection`: Biocentral serves all three ESM-C sizes from the official
  checkpoints and the live check covers each; the local-only refusal is replaced by "both backends
  serve every shortcut"; the CLI-compatibility requirement drops its local-only clause.

## Impact

- `apps/protspace/src/protspace/data/embedding/biocentral.py`, `local.py`, `cli/common_options.py`,
  `cli/embed.py`, `cli/prepare.py`.
- `notebooks/ProtSpace_Preparation.ipynb` (cell 3: the `BIOCENTRAL_INVALID` import and fallback,
  the `LOCAL_ONLY_EMBEDDERS` read and the Biocentral entry of `_INCOMPATIBLE`).
- Tests: `test_backend_switch.py`, `test_local_embedder.py`, `test_notebooks.py`,
  `test_cli_no_similarity.py`, `esmc_reference.py` + `tests/data/esmc_6b_ubiquitin.npy`.
- Docs: `docs/guide/python-cli.md`, `apps/protspace/CLAUDE.md`.
- No dependency change: `biocentral-api` 2.0.0 (locked) and 2.1.0 both pass the live suite.
