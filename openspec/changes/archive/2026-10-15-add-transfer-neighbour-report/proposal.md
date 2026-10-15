## Why

A user re-annotating unknown proteins against a curated reference set asked for "the list of
neighbours" so they could pick candidates by hand. `protspace transfer` already finds every
query's nearest references in the full embedding, and then throws most of that away: the bundle
keeps one label, one reliability index and one source per query. The raw distance is dropped
(it can be recovered as `1 - confidence` only for cosine with `--k 1`, and not at all past a
distance of 1), and with `--k > 1` the other neighbours are dropped too. The only way to get the
list today is a hand-written script against `protlabel.backends.nearest` that re-implements the
query/reference scoping `transfer` already does.

**Refs:** #363 (making the confidence interpretable needs the distances), #424 (audit mode argues
the same point: neighbours belong in embedding space, and a reviewer needs to see them).

## What Changes

- `protspace transfer --report predictions.tsv` writes a tab-separated table beside the bundle:
  one row per query and neighbour, giving the transferred column, the query id, the predicted
  label, its source reference, the raw distance to that source and the reliability index, then
  the neighbour's rank, reference id, reference label and distance. With `--k 1` that is one row
  per query; with `--k 5`, five.
- The bundle is unchanged: same three `__pred_*` columns, no format change. The report is a side
  file, written only when asked for.
- `protlabel.eat()` gains `keep_neighbors=False`; with it on, each `Prediction` carries its
  `neighbors` (reference id, label, distance), nearest first and ties broken by id. The default
  stays bit-identical, so `Lookup` and every existing caller are unaffected.
- `run_transfer()` gains a `report` list it appends the rows to, so the Colab notebooks that call
  it keep their return value.

### Non-goals

- Neighbours in the projection. The report is embedding-space only, like the transfer itself.
- Keeping the neighbours in the bundle. They are a per-query list, not a per-protein value the
  web app could colour by.
- A near/distant cutoff. That is `add-transfer-distance-cutoff`, which builds on this report.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `eat-transfer-scope`: adds what a transfer reports about the neighbours it used.

## Impact

- `apps/protspace/packages/protlabel/src/protlabel/transfer.py` (`Neighbor`,
  `Prediction.neighbors`, `eat(keep_neighbors=...)`), exported from `protlabel/__init__.py`.
  An additive public API change; `protlabel` releases in lock-step with `protspace`.
- `apps/protspace/src/protspace/cli/transfer.py` (`--report`, `run_transfer(report=...)`) and
  `data/io/predictions.py` (report rows and the TSV writer).
- `feat:` on `apps/protspace/`: a new CLI flag users see.
- Docs: `docs/guide/python-cli.md` (transfer section), `docs/explore/eat.md`; the
  `ProtSpace_Transfer.ipynb` notebook writes the report and offers it as a download;
  `apps/protspace/CLAUDE.md`.
- Tests: `tests/test_transfer_cli.py`, `packages/protlabel/tests/test_protlabel_transfer.py`,
  `tests/test_notebooks.py`.
