## Why

The Biocentral backend sends `Synthyra/ESMplusplus_small` / `_large` for `esmc_300m` / `esmc_600m`.
Biocentral used to accept those ids and return vectors orthogonal to ESM-C (its engine loaded the
checkpoint as ESM-2), which is why the Preparation notebook blocks ESM-C on Biocentral. The server
has changed on both counts. Biotrainer gained a real ESM-C embedder for `biohub/ESMC-300M` /
`-600M` (2026-07-20, in biotrainer 2.1), and the live server (v2.0.1) now refuses Synthyra ids with a
422: "Embedders from Synthyra are not supported due to custom code execution". So today
`esmc_*` on Biocentral fails outright, and the block guards against a bug that no longer exists.

Measured on the live server on 2026-10-27: `biohub/ESMC-300M` and `-600M` return vectors equal to
the local backend's (10 proteins each, two of them 624 and 1126 aa: cosine ≥ 0.9999998, relative L2
≤ 2.0e-6).

## What Changes

- The Biocentral backend sends `biohub/ESMC-300M` / `biohub/ESMC-600M` for `esmc_300m` /
  `esmc_600m`, the same checkpoints the local backend loads.
- `BIOCENTRAL_INVALID` becomes empty instead of being deleted. The notebook imports it from the
  released package, so releases that still send the Synthyra ids keep blocking ESM-C, and the
  block lifts with the release that switches them. The notebook's fallback literal follows.
- The daily live canary also embeds ubiquitin with `esmc_300m` and compares it with a committed
  reference vector computed locally from the official weights. A server that answers with the
  wrong model fails the canary instead of passing unnoticed, as it did before.
- An `.h5` a Biocentral ESM-C run wrote before is stamped with the Synthyra id, so a resume refuses
  it under the new id. That is intended: its vectors were the wrong model.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `embedding-backend-selection`: removes "ESM-C is blocked on the Biocentral backend" and adds a
  requirement that Biocentral serves ESM-C from the official checkpoints, checked against them.

## Impact

- `apps/protspace/src/protspace/data/embedding/biocentral.py` (`EXTRA_SHORT_KEYS`,
  `BIOCENTRAL_INVALID`).
- `apps/protspace/notebooks/ProtSpace_Preparation.ipynb` (fallback literal only).
- Tests: `test_biocentral_embedder.py`, `test_local_embedder.py`, `test_biocentral_live.py` plus a
  reference vector under `tests/data/`.
- Docs: `apps/protspace/CLAUDE.md`, `docs/guide/python-cli.md`.
