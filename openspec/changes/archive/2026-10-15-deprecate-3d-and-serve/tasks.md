## 1. Deprecation registry

- [x] 1.1 Add `apps/protspace/src/protspace/deprecations.py` (stdlib only) with entries for 3-D projections, `protspace serve` and v1/v2 bundle reads, all `remove_in="5.0.0"`, plus `warn()` and `due()`; verify `tests/test_deprecations.py` covers version parsing, `due()` and that every removal note names an existing file
- [x] 1.2 Add the tripwire test: `due(protspace.__version__)` is empty, and fails naming the feature when a registry entry is at or below the package version; verify with a monkeypatched version
- [x] 1.3 Read `bundle.LEGACY_REMOVAL_VERSION` and the legacy warning text from the registry; verify `tests/test_convert.py` passes unchanged
- [x] 1.4 Pin the web app's v1/v2 removal version (`notifications.ts`, core `bundle.ts`, `data-loader.ts`) to the registry with a test that reads the TS sources, and add them to `protspace-ci.yml`'s path filter; verify the test fails when a copy differs

## 2. 3-D projections

- [x] 2.1 Warn once from `parse_methods_arg` when any requested method has dimension 3, naming the 3-D methods and the 2-D variant; verify tests for one, several and no 3-D methods
- [x] 2.2 Add the deprecation sentence (version from the registry) to the shared `-m/--methods` help; verify `protspace project --help` and `protspace prepare --help` show it
- [x] 2.3 Exercise `protspace project -m pca2,umap3` on a tiny HDF5 in a CLI test: exits 0, writes both projections, prints the warning
- [x] 2.4 Mark 3-D methods deprecated in `docs/guide/python-cli.md` (commands table, "Projection Methods"); confirm the Colab notebooks request only `*2` methods

## 3. `protspace serve`

- [x] 3.1 Mark `serve` `deprecated=True`, build its help from the registry, and log the registry warning before starting; verify a CLI test with the Dash entry point stubbed, and `protspace --help` showing `(deprecated)`
- [x] 3.2 Drop `protspace serve` from the root `--help` quick start
- [x] 3.3 Mark `serve` deprecated in `docs/guide/python-cli.md` (extras row, commands row, `## protspace serve`), the identical extras row in `apps/protspace/README.md`, and `docs/guide/data-format.md`; verify `test_docs_extras_sync.py` and `pnpm docs:build`

## 4. Release gate

- [x] 4.1 Add `apps/protspace/scripts/check_deprecations.py --next-version X`: passes when X equals the current version or precedes every `remove_in`, otherwise exits 1 listing the due features; verify `tests/test_check_deprecations.py`
- [x] 4.2 Add the gate step to `.github/workflows/protspace-release.yml` before `semantic-release version`, computing X with `semantic-release version --print`; verify a test pins the step's presence and order, and add the workflow to `protspace-ci.yml`'s path filter
- [x] 4.3 Verify `--print` against a full clone with PSR 10.6.1: no release → current version, `feat` → minor, `BREAKING CHANGE` → 5.0.0 (gate fails), working tree unchanged

## 5. Reading 3-D projections

- [x] 5.1 Register `3d-projection-read` (remove_in 5.0.0) with removal notes from the design inventory; verify the registry tests (paths exist, version in text)
- [x] 5.2 Warn once per Python bundle read of projections holding a finite `z` (`read_tables`, `read_bundle_contents`, `read_bundle`, `extract_bundle_to_dir`) and in `stats` for a 3-D projection directory; verify tests for a 3-D read, a 2-D read, a settings-only read, `warn_3d=False`, and that existing legacy-warning counts still hold
- [x] 5.3 Add `getThreeDProjectionNotification` and show it for user imports with a 3-D projection; verify `notifications.test.ts`, the dataset-controller unit tests and an e2e test importing the `umap3` fixture (`pnpm test`, `pnpm test:e2e` for the notice spec)
- [x] 5.4 Extend the Python TS pin to the 3-D notice; verify it fails on a different version
- [x] 5.5 Update `docs/explore/control-bar.md`, `docs/guide/python-cli.md`, `docs/guide/data-format.md`; verify `pnpm docs:build`

## 6. `protspace convert` as the lasting upgrade path

- [x] 6.1 Add `convert --flatten-3d` (X/Y kept, ` (X/Y)` name suffix, `flattened_from_3d`, 3-D quality and statistics rows dropped, v3 inputs too) and the 4.x warning without the flag; verify `tests/test_convert.py` cases for v2 and v3 inputs, nothing-to-flatten, a name collision, and settings/other statistics kept
- [x] 6.2 Say in the v1/v2 registry entry, the registry docstring and `AGENTS.md` that convert's legacy reader is retained and not a registry entry; verify the gate's 5.0.0 output does not list convert
- [x] 6.3 Amend `parquetbundle-v3` task 6.2 and its Migration Plan step 4: convert keeps reading v1/v2 in 5.0.0; verify the diff touches only those passages and `openspec validate parquetbundle-v3` reports the same (pre-existing) issues as before

## 7. Agent docs

- [x] 7.1 Describe the registry and the gate in `AGENTS.md` (near the semantic-release section) and `apps/protspace/CLAUDE.md` (commands table, package tree, test table, conventions)

## 8. Integration

- [x] 8.1 `openspec validate deprecate-3d-and-serve --strict`, `uv run pytest -m "not slow"`, `uv run ruff check src/ packages/ tests/ scripts/`, `pnpm precommit`, `pnpm format:check` all pass; plus `pnpm test`

## 9. Merge into the user-feedback integration branch

- [x] 9.1 Merge `feedback/e-deprecate-3d-serve` with a merge commit, keeping both sides of `docs/guide/python-cli.md` (commands table with `export`, deprecated `project`/`serve` rows), `apps/protspace/CLAUDE.md`, `cli/common_options.py` and `data/processors/pipeline.py` imports, and every path in `protspace-ci.yml`'s filter
- [x] 9.2 State the deprecation wherever the merged docs still offered 3-D or `serve` as supported: the "Upgrading from v4.4" note (removed in 5.0.0, #544), the `serve` section's 3-D sentence, the `export` paragraph and the web Table Export (X/Y only, no `z`), `apps/protspace/docs/cli.md`'s command list; verify `test_export_cli.py` pins the 3-D read warning on `read_bundle_table`
- [x] 9.3 Parse `-m` in `prepare` before any embedding, so the 3-D warning and a malformed-spec error come first on a FASTA or `-q` input; verify `test_deprecations.py` with a mocked embedder (warns before it, refuses `umap2:bogus=5` without calling it)
- [x] 9.4 State `--flatten-3d` as the exception to `bundle-conversion`'s "leave a v3 input untouched" in `deprecation-policy`, and add the unticked carve-out task 5.5 to `parquetbundle-v3`
- [x] 9.5 `pnpm precommit`, `pnpm format:check`, `pnpm quality`, `pnpm test`, `uv run pytest -q` (only the network-bound `TestTaxonomyRetrieverIntegration` fails), ruff check and format, `test_notebooks.py` with ipywidgets 7.7.1, and the Chromium e2e suite all pass

## Workflow follow-up

- Archive this change at integration, before the merge (`/opsx:archive`).
- The 5.0.0 change deletes what design.md's "v5.0.0 removal inventory" lists and the registry entries with it.
