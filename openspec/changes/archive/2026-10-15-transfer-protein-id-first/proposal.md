## Why

`protspace transfer` stopped with "Bundle annotations contain both 'protein_id' and 'identifier'
columns" whenever a bundle held both (#551). Such bundles are legitimate: the web exporter wrote
`protein_id` when an annotation was itself named `identifier`, and `bundle -a` keys a table
holding both on `protein_id`. A user whose data has a column called `identifier` could build and
view the bundle but not run annotation transfer on it.

## What Changes

- `transfer` keys a bundle on `protein_id`, as `read_tables` hands every bundle back since
  `single-protein-id-column`. Beside it, an `identifier` column is an ordinary annotation: kept in
  the written bundle unchanged, and usable in `--query-where` / `--reference-where`. The refusal
  is dropped.

## Capabilities

### Modified Capabilities

- `eat-transfer-scope`: a bundle holding `protein_id` and `identifier` transfers, keyed on
  `protein_id`.

## Impact

- `apps/protspace/src/protspace/cli/transfer.py`: the refusal goes.
- Tests: `tests/test_transfer_cli.py`.
- Docs: `apps/protspace/CLAUDE.md`.
