## 1. Implementation

- [x] 1.1 Add `NON_ANNOTATION_COLUMNS` (a set) to `contracts/shared-constants.json` and run
      `pnpm shared-constants`
- [x] 1.2 Export it from `@protspace/utils` and use it in `conversion.ts` in place of `ID_COLUMNS`
- [x] 1.3 `custom_annotations.RESERVED_COLUMNS` re-exports it

## 2. Tests

- [x] 2.1 `test_shared_constants.py`: `RESERVED_COLUMNS` holds the generated value
- [x] 2.2 Drop the `conversion.ts`-parsing test from `test_custom_annotations.py`

## 3. Docs

- [x] 3.1 `contracts/README.md`, `CONTRIBUTING.md` and `apps/protspace/CLAUDE.md` list it

## 4. Verify

- [x] 4.1 `pnpm shared-constants:check`, `pnpm quality`, `pnpm test`, the Python suite
- [x] 4.2 `openspec validate share-non-annotation-columns --strict`
