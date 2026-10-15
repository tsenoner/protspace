## 1. One Python definition of missing

- [x] 1.1 Write failing tests for `is_missing_value` and for each consumer (Dash `standardize_missing`, `stats`, `transfer`) reading `N/A`, `NULL`, `None`, padded and `__NA__` cells as missing
- [x] 1.2 Replace `MISSING_VALUE_TOKENS` with the web's lower-case set and add `is_missing_value` in `core/constants.py`; remove `BROWSER_MISSING_TOKENS`
- [x] 1.3 Route `standardize_missing`, `stats/annotation_select.py` and `cli/transfer.py` through `is_missing_value`
- [x] 1.4 Move the v3 encoder's numeric inference and the showcase build's N/A gate (and its README) to the shared set and predicate

## 2. Cross-language guard

- [x] 2.1 Write Python's token set and its verdict on a probe table into the contract manifest (`tests/contract/emit_bundles.py`)
- [x] 2.2 Assert in `bundle.contract.test.ts` that the web's set and `normalizeMissingValue` agree with the manifest
- [x] 2.3 Remove the regex parity test from `test_biocentral_retriever.py`
- [x] 2.4 Check the guard fails: drop a token on each side, and make each side case-sensitive, one at a time

## 3. Producer vocabulary guard

- [x] 3.1 Test that every fixed producer vocabulary (TMbed, signal peptide, PDB, fragment, reviewed, boolean labels) is not missing, hit by hit
- [x] 3.2 Test that no string literal in `data/annotations/` or `data/parsers/` is spelled like a missing value
- [x] 3.3 Check both fail when TMbed's negative is renamed back to `none`

## 4. Verify and document

- [x] 4.1 Update `apps/protspace/CLAUDE.md` for the new test file, and `docs/guide/` (`data-format.md` Missing Values, `python-cli.md` transfer) for the Python readers
- [x] 4.2 Run `uv run ruff check`, `uv run pytest -m "not slow"`, `pnpm test:contract`, `pnpm format:check` and `pnpm precommit`
