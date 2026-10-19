## 1. InterPro cache version

- [x] 1.1 Add the InterPro columns to cache semantics version 4 in `encoding.py`
- [x] 1.2 Test that a version-3 cache refetches InterPro once and reuses UniProt, and keep the
      version-3 tests to the columns that version changed

## 2. Shared categorical default

- [x] 2.1 Add `DEFAULT_CATEGORICAL_PALETTE_ID` to `contracts/shared-constants.json` and the
      generator invariant that it is a categorical palette id; regenerate both modules
- [x] 2.2 Read it in place of every default `kellys` literal in Python and TypeScript

## 3. Verification

- [x] 3.1 Run the Python and web test suites, the bundle contract and `pnpm precommit`
