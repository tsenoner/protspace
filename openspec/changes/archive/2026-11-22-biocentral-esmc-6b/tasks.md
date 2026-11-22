## 1. Package

- [x] 1.1 Move `esmc_6b` → `biohub/ESMC-6B` into `EXTRA_SHORT_KEYS`
- [x] 1.2 Remove `LOCAL_ONLY_EMBEDDERS`, `refuse_local_only_on_biocentral` and its calls, the help
      suffix and `resolve_embedder`'s local-only message
- [x] 1.3 Remove `BIOCENTRAL_INVALID` and its comment block (#559)

## 2. Notebook

- [x] 2.1 Preparation cell 3: drop the `BIOCENTRAL_INVALID` import and fallback, the
      `LOCAL_ONLY_EMBEDDERS` read and the Biocentral entry of `_INCOMPATIBLE`

## 3. Tests

- [x] 3.1 `test_backend_switch.py`: drop the local-only refusal tests; `esmc_6b` resolves for
      Biocentral
- [x] 3.2 `test_local_embedder.py` / `test_notebooks.py`: drop the `BIOCENTRAL_INVALID` cases and the
      Synthyra mentions
- [x] 3.3 Notebook test: the panel blocks nothing on Biocentral
- [x] 3.5 `test_cli_no_similarity.py`: the CLI list equals both backends' registries
- [x] 3.4 Canary: `esmc_6b` ubiquitin reference vector + live comparison

## 4. Docs

- [x] 4.1 `docs/guide/python-cli.md`, `apps/protspace/CLAUDE.md`
- [x] 4.2 Re-run the live suite with the change; `pytest`, ruff, `pnpm precommit`
