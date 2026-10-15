## 1. Cutoff in the transfer core

- [x] 1.1 `data/io/predictions.py`: `set_neighbor_column` (near/distant by identifier, stale column replaced)
- [x] 1.2 `run_transfer(max_distance=..., skip_distant=...)`: class each query by its rank-1 distance, drop distant predictions on request, drop a stale `<COL>__neighbor` when no cutoff is given
- [x] 1.3 `auto`: 95th percentile of reference-to-nearest-other-reference distances (self excluded by index), logged; fewer than two references is an error
- [x] 1.4 Report rows carry `neighbor` and `max_distance` when a cutoff is given

## 2. CLI

- [x] 2.1 `--max-distance D|auto` (non-negative number or `auto`) and `--skip-distant` (needs a cutoff) as usage errors otherwise

## 3. Web label

- [x] 3.1 `getAnnotationMeta`: `<BASE>__neighbor` fallback label/description; tests in `annotation-metadata.test.ts`

## 4. Tests

- [x] 4.1 `tests/test_transfer_cli.py`: fixed cutoff classes, references null, default still labels distant queries, `--skip-distant` drops their predictions, `auto` equals the percentile computed by hand and lands in the report, single-reference `auto` and `--skip-distant` alone are usage errors, a re-run without cutoff drops the column
- [x] 4.2 `tests/test_predictions_overlay.py`: `set_neighbor_column` alignment and replacement

## 5. Docs

- [x] 5.1 `docs/guide/python-cli.md`: flags, the calibration rule, the column
- [x] 5.2 `docs/explore/eat.md`: the near/distant column and the "which unknowns sit near my references" recipe
- [x] 5.3 `apps/protspace/CLAUDE.md`: transfer row and test-file rows

## 6. Verification

- [x] 6.1 pytest, ruff, `pnpm test`, `pnpm precommit`, `pnpm format:check`
- [x] 6.2 `openspec validate add-transfer-distance-cutoff --strict`
