## Why

`csv-id-first-column` renames a custom annotation file's later column when the web viewer would
hide it: the viewer's `ID_COLUMNS` (`conversion.ts`) drops `identifier`, `protein_id`, `id`,
`uniprot`, `entry`, `projection_name`, `x`, `y` and `z` from the annotation columns. The Python
loader therefore holds a copy of that list, pinned by a test that parses the TypeScript.

Main has since made `contracts/shared-constants.json` the one home of a value both languages hold
(`shared-constants`, AGENTS.md): a hand-written copy on either side is what that capability exists
to remove. The pin also sat outside `protspace-ci.yml`'s path filter, so an edit to
`conversion.ts` alone would not run it.

## What Changes

- `NON_ANNOTATION_COLUMNS` joins `contracts/shared-constants.json`: the column names the web reader
  never shows as an annotation.
- The web's `conversion.ts` reads it from `@protspace/utils` instead of its own `ID_COLUMNS`
  literal; the Python loader's `RESERVED_COLUMNS` re-exports it.
- The test that parsed `conversion.ts` is replaced by the shared-constants re-export test.

No behaviour changes: the generated value is the list both sides already hold.

## Capabilities

### Modified Capabilities

- `shared-constants`: the shared source also covers the column names the web reader never shows
  as an annotation.

## Impact

- `contracts/shared-constants.json`, both generated modules, `contracts/README.md`,
  `CONTRIBUTING.md`.
- Web: `packages/utils/src/index.ts` (export), `packages/core/.../conversion.ts` (import).
- Python: `data/processors/custom_annotations.py`; `tests/test_shared_constants.py`,
  `tests/test_custom_annotations.py`; `apps/protspace/CLAUDE.md`.
