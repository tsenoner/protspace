## 1. Backend

- [x] 1.1 Map `esmc_300m` / `esmc_600m` to `biohub/ESMC-300M` / `-600M` in `EXTRA_SHORT_KEYS`
- [x] 1.2 Empty `BIOCENTRAL_INVALID` (keep the name) and its notebook fallback literal
- [x] 1.3 Update `test_biocentral_embedder.py` and `test_local_embedder.py`

## 2. Canary

- [x] 2.1 Commit a ubiquitin `esmc_300m` reference vector computed locally from the official weights
- [x] 2.2 Add a live test comparing Biocentral's ESM-C vector with it

## 3. Docs

- [x] 3.1 `apps/protspace/CLAUDE.md`: embedder table, ESM-C note, parity note
- [x] 3.2 `docs/guide/python-cli.md`: drop "embed ESM-C with the local backend", note old caches

## 4. Checks

- [x] 4.1 Live: both sizes through `embed_sequences` on the new ids, and the new canary test
- [x] 4.2 `uv run pytest -m "not slow"`, `test_notebooks.py`, `pnpm precommit`
- [x] 4.3 `openspec validate --strict`, archive, update the spec Purpose, prettier
