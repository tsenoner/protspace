## Why

`protspace transfer` gives every query a label, however far its nearest reference is. A user
re-annotating unknowns against a curated reference database wants the opposite split first:
which unknowns sit near a reference at all, and which are distant. Their own prototype
("extractor") did this with a distance cutoff in the projections. ProtSpace can do it better, in
the embedding, but today only as a view filter (the web app's reliability control), which is not
written anywhere, has no principled default, and does not stop a distant query from carrying the
nearest family's label in the bundle.

A fixed number does not travel: ESM2 cosine similarities are high between unrelated proteins,
and the published EAT cutoff (1.1, euclidean) is specific to ProtTucker. A cutoff calibrated
against the references themselves does: a query whose nearest reference is farther than almost
every reference is from its own nearest neighbour sits outside the reference set's spacing.

**Refs:** #363 (thresholds for EAT confidence), #424 (neighbourhoods in embedding space).

## What Changes

- `protspace transfer --max-distance D` classifies each query by the distance to its nearest
  reference: `near` when it is at most `D`, `distant` otherwise. The class is written to the
  bundle as an ordinary categorical column `<COL>__neighbor`, null for every protein that was not
  a query.
- `--max-distance auto` picks `D` per column as the 95th percentile of each reference's distance
  to its nearest other reference. The chosen value is logged and, with `--report`, written to the
  report.
- `--skip-distant` leaves the distant queries unpredicted: they get no `__pred_*` cells, only
  `<COL>__neighbor = distant`. Without it every query is still labelled, as today.
- With `--report`, two columns are added: `neighbor` (the class) and `max_distance` (the cutoff
  used for that column).
- The web app labels `<COL>__neighbor` as "<COL label> — EAT neighbourhood" with a description,
  instead of the prettified column name.
- Re-running transfer on a column replaces a stale `<COL>__neighbor`, as it does the `__pred_*`
  columns, and drops it when the new run has no cutoff.

### Non-goals

- A confidence cutoff (`--min-confidence`). For cosine with `--k 1` it is `1 - D`; for the other
  settings the reliability index is a ranking, and the web app's reliability filter already
  covers it.
- An elbow-based automatic cutoff. A percentile of the reference spacing is explainable in one
  sentence and needs no curve shape; it can be added as another `auto` mode later.
- Any change to the bundle format or the reliability filter.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `eat-transfer-scope`: adds the near/distant cutoff and what it writes.
- `annotation-metadata`: adds the display label of a `<COL>__neighbor` column.

## Impact

- Depends on `add-transfer-neighbour-report` (the cutoff reads the rank-1 neighbour it keeps, and
  extends its report).
- `apps/protspace/src/protspace/cli/transfer.py` (flags, calibration), `data/io/predictions.py`
  (`<COL>__neighbor` column).
- `packages/utils/src/visualization/annotation-metadata.ts` (label fallback for the column).
- `feat:` on `apps/protspace/`.
- Interplay checked: the reliability filter (`eat-reliability-filter`) identifies its condition by
  the synthetic eat-confidence column only, so a `<COL>__neighbor` column is an ordinary
  annotation to it and to the filter builder. The `__pred_` namespace (`eat-annotation-overlay`)
  is untouched. No bundle format change (`bundle-format-contract`, `parquetbundle-v3`): the
  column is a plain string column, which v3 stores as categorical.
- Docs: `docs/guide/python-cli.md`, `docs/explore/eat.md`; `apps/protspace/CLAUDE.md`.
- Tests: `tests/test_transfer_cli.py`, `tests/test_predictions_overlay.py`,
  `annotation-metadata.test.ts`.
