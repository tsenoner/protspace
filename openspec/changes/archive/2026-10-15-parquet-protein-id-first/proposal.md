## Why

`custom-csv-annotations` made `bundle -a` and `stats -a` refuse a parquet holding both a
`protein_id` and an `identifier` column, and `csv-id-first-column` kept that. Released `bundle -a`
took `protein_id` as the id and kept `identifier` as an annotation, and the bundle contract suite
(`tests/contract/emit_bundles.py`, its `coverage` variant) builds exactly such a table to pin the
web writer naming its id column around an `identifier` annotation. With the refusal, `pnpm
test:contract` fails before it tests anything.

## What Changes

- A parquet's id column is `protein_id`, else `identifier`, else the first column, for `stats -a`
  and `bundle -a` alike. Beside `protein_id`, an `identifier` column is an ordinary annotation, as
  in every release; the refusal, never released, is dropped.
- A custom annotation file is unaffected: its first column is the id column, and a later
  `identifier` or `protein_id` column is renamed `<name>_annotation`.

## Capabilities

### Modified Capabilities

- `custom-annotation-files`: the parquet id rule prefers `protein_id` instead of refusing a table
  with both names.

## Impact

- `apps/protspace/src/protspace/data/processors/custom_annotations.py` (`resolve_id_column`).
- Tests: `tests/test_custom_annotations.py`; `pnpm test:contract` passes again.
- Docs: `docs/guide/python-cli.md` (`bundle` section), `apps/protspace/CLAUDE.md`.
