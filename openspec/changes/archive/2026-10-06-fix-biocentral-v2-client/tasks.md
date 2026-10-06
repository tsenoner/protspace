## 1. Failing tests first

- [x] 1.1 `tests/test_biocentral_connection.py`: `wait_for_server` returns the client when the wait succeeds and makes no health request
- [x] 1.2 Same file, one test per reason: server did not answer (connection error, non-200), major outside the window and newer, major outside the window and older, two-digit major compared as a number, in-window but unhealthy, 200 with no readable version
- [x] 1.3 Every message starts `No healthy Biocentral service became available in time`, and contains a `_BIOCENTRAL_DOWN_PATTERNS` substring (`no healthy biocentral`)
- [x] 1.4 `BiocentralUnavailableError` is a `ValueError`; `protspace embed` against an unusable server exits 1 with `ERROR:` and no traceback
- [x] 1.5 `embed_sequences`, `probe_embedder` and the retriever all raise or handle the same error; the retriever logs a warning, returns no predictions and sets `prediction_failed`
- [x] 1.6 The existing `esm2_8m` resolution test (`facebook/esm2_t6_8M_UR50D`) is the red for the rename: with the 2.0.0 client installed and nothing else changed, `biocentral.py` fails to import
- [x] 1.7 Run them and watch each fail for the stated reason, not for an import error

## 2. Dependency

- [x] 2.1 `biocentral-api>=2.0.0,<3` in `apps/protspace/pyproject.toml`; relock the root `uv.lock`
- [x] 2.2 Confirm `uv sync --locked` installs it on Python 3.14 and that it imports and reports the live server healthy there
- [x] 2.3 Repoint `esm2_8m` from `ESM_8M` to `ESM2_8M`

## 3. Connection helper

- [x] 3.1 `BIOCENTRAL_URL`, `BiocentralUnavailableError(ValueError)` and `wait_for_server(api)` in a new `data/biocentral_connection.py`, outside `data/embedding/` so annotation never imports the embedding shortcut tables
- [x] 3.2 Read the client's window and version once, at import
- [x] 3.3 Use the helper in `embed_sequences`, `probe_embedder` and the retriever's `_run_predictions`; drop the three hard-coded addresses
- [x] 3.4 Update the stale `v1.2.1` comments on the server's length limits to say they hold on v2.0.1

## 4. Docs

- [x] 4.1 `docs/guide/python-cli.md`, under `protspace embed`: what `No healthy Biocentral service became available in time` means, the version-mismatch reason and its fix, and the Python 3.14 + `pip` caveat with the `uv` and 3.12/3.13 routes
- [x] 4.2 `apps/protspace/README.md`: Python badge from 3.10+ to 3.12+
- [x] 4.3 Check the Colab notebooks and `apps/protspace/CLAUDE.md` for anything that restates the client version, the shortcut or the new test file

## 5. Verify

- [x] 5.1 `uv run pytest` for `apps/protspace` and `apps/prep`; `ruff check` and `ruff format --check`
- [x] 5.2 A real end-to-end run against the live server through the CLI: `protspace embed` on a small FASTA, and an annotation run with `-a biocentral`
- [x] 5.3 Reproduce the reported failure with the old client: the new message names the version mismatch
- [x] 5.4 `openspec validate fix-biocentral-v2-client --strict`

## 6. Archive

- [x] 6.1 Tick this file, reread `proposal.md` and `design.md` against the final diff, and run `/opsx:archive` as the last commit on the branch
