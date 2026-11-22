## 1. Package

- [x] 1.1 Move `esmc_6b` → `biohub/ESMC-6B` into `EXTRA_SHORT_KEYS`; empty `LOCAL_ONLY_EMBEDDERS`
- [x] 1.2 CLI help names local-only shortcuts only when the set is non-empty
- [x] 1.3 Remove `BIOCENTRAL_INVALID` and its comment block (#559)

## 2. Notebook

- [x] 2.1 Preparation cell 3: drop the `BIOCENTRAL_INVALID` import and fallback; keep the guarded
      `LOCAL_ONLY_EMBEDDERS` read for 4.19.0 installs

## 3. Tests

- [x] 3.1 `test_backend_switch.py`: refusal tests use a patched-in local-only key; `esmc_6b` resolves
      for Biocentral
- [x] 3.2 `test_local_embedder.py` / `test_notebooks.py`: drop the `BIOCENTRAL_INVALID` cases
- [x] 3.3 Notebook test: the panel's Biocentral gating against a released package that still lists
      `esmc_6b`, and against one that lists nothing
- [x] 3.4 Canary: `esmc_6b` ubiquitin reference vector + live comparison

## 4. Docs

- [x] 4.1 `docs/guide/python-cli.md`, `apps/protspace/CLAUDE.md`
- [x] 4.2 Re-run the live suite with the change; `pytest`, ruff, `pnpm precommit`
