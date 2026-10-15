## Context

The web reader removes a fixed list of column names from a table's annotation columns
(`ID_COLUMNS` in `packages/core/src/components/data-loader/utils/conversion.ts`). The Python
custom annotation loader (`csv-id-first-column`) renames a later column with one of those names, so
it is not hidden. Both sides hold the same list; `shared-constants` gives such a value one source.

## Decisions

- **One entry, `NON_ANNOTATION_COLUMNS`, kind `set`.** The name says what both sides use it for: a
  name that is never an annotation column. Both sides only test membership (the web builds a `Set`
  from it plus the detected id column; Python tests `column in RESERVED_COLUMNS`), so a set fits.
- **It is a value, not a rule.** `contracts/README.md` keeps "which column holds the ids" out of the
  shared source because that is code. This list is not that rule: the web still detects the id
  column by its own substring search, and Python still takes a custom file's first column. The list
  only names the columns the reader skips.
- **Existing names stay.** `RESERVED_COLUMNS` keeps its name in Python, re-exported from the
  generated module, as the other shared constants keep theirs; the web's private `ID_COLUMNS`
  disappears, since nothing outside `conversion.ts` read it.

## Risks / Trade-offs

- **[A web-only edit to the list]** Changing which columns the reader skips now changes what the
  Python loader renames, which is the point. The change lands in the JSON, so `shared-constants`'
  unfiltered CI job covers it.
