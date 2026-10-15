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

## 5. Agent docs

- [x] 5.1 Describe the registry and the gate in `AGENTS.md` (near the semantic-release section) and `apps/protspace/CLAUDE.md` (commands table, package tree, test table, conventions)

## 6. Integration

- [x] 6.1 `openspec validate deprecate-3d-and-serve --strict`, `uv run pytest -m "not slow"`, `uv run ruff check src/ packages/ tests/ scripts/`, `pnpm precommit`, `pnpm format:check` all pass

## Workflow follow-up

- Archive this change at integration, before the merge (`/opsx:archive`).
- The 5.0.0 change deletes what design.md's "v5.0.0 removal inventory" lists and the registry entries with it.
