## Context

Two pickers filter the same annotation list with two different, hand-written rules:
`annotation-select.ts` matches `column.includes(q) || label(column).includes(q)`, and
`query-condition-row.ts` matches `column.includes(q)`. Neither is tested, and the first is
what produces the `ted` → four-Biocentral-rows result.

## Goals / Non-Goals

**Goals:**

- A query only matches text the reader can account for.
- Searching by raw column name keeps working.
- One rule, one implementation, both pickers.

**Non-Goals:**

- Fuzzy matching, ranking, or scoring. The list is short and grouped by source.
- Highlighting the matched substring. Worth doing, but it is a rendering change in two
  components and does not depend on this.
- Touching the value picker (`query-value-picker.ts`), which searches annotation _values_,
  not column names.

## Decisions

### Match column names by word, labels by substring

A query matches a column when it is a prefix of one of the words in the column name
(split on `_` and `-`), or a substring of the friendly label.

The asymmetry is the point. Column names are machine identifiers built by joining words,
so a word boundary is meaningful in them and a mid-word hit is almost always an accident —
`ted` inside `predicted` is the whole bug. Labels are prose the reader is looking at, so a
mid-word hit there is exactly what they meant: `cellular` should still find
`Subcellular location`, and `membrane` should still find `Transmembrane`.

Worked through against the real registry:

| query       | matches                                         | via                       |
| ----------- | ----------------------------------------------- | ------------------------- |
| `ted`       | `ted_domains` only                              | label and first word      |
| `predicted` | all four Biocentral                             | first word of each column |
| `membrane`  | `predicted_membrane`, `predicted_transmembrane` | word; label substring     |
| `cellular`  | `predicted_subcellular_location`                | label substring           |
| `loc`       | `predicted_subcellular_location`                | word `location`           |

Alternatives considered:

- **Match the label only.** Kills the `predicted` case and every other search by real
  column name, which is how anyone reading a bundle's schema looks things up.
- **Match labels first, fall back to column names when nothing matched.** Fixes `ted` too,
  but the result set then depends on whether some _other_ annotation happened to match,
  so the same query behaves differently in different datasets.
- **Substring on both, and mark why a row matched.** The better end state, but it is a
  rendering change in two components; the matching rule should be right regardless.

### One helper, in the registry module

`annotationMatchesQuery` goes beside `annotationLabel` and `annotationSource` in
`packages/utils`, which already own per-column presentation knowledge. Both pickers call
it. Today they disagree — the query builder never matches labels at all — and that is only
possible because the rule is written twice.

## Risks / Trade-offs

- **A mid-word column search stops working** — `cellular` no longer matches
  `predicted_subcellular_location` _by column name_. It still matches by label, and every
  registry column has a label. A column with no registry entry falls back to a label
  derived from its own name, so the word rule still reaches it.

## Migration Plan

None. Pure filtering behaviour, no stored state.

## Open Questions

None.
