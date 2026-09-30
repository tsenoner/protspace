## Why

Typing `ted` into the annotation dropdown returns the four Biocentral predictions —
Membrane, Signal peptide, Subcellular location, Transmembrane — above the one annotation
the reader was looking for. Every one of them matches on `predic**ted**_*`, the raw column
name, and none of them matches on anything the dropdown actually displays:

```
MATCH predicted_subcellular_location  key:Y  label("Subcellular location"):n
MATCH predicted_membrane              key:Y  label("Membrane"):n
MATCH predicted_signal_peptide        key:Y  label("Signal peptide"):n
MATCH predicted_transmembrane         key:Y  label("Transmembrane"):n
MATCH ted_domains                     key:Y  label("TED domains"):Y
```

Searching the column name is deliberate and worth keeping — it is how someone who knows
`predicted_membrane` finds it. Matching an arbitrary substring of it is what makes the
result unexplainable, because the matched text is never on screen.

The query builder's annotation picker has the same flaw and one more: it matches the raw
column name _only_, so a reader who searches for the label they can see finds nothing.

## What Changes

- Match a query against a column name by word, not by arbitrary substring: the query must
  begin where a word does. Query and column are both split on `_`/`-`, so a column is still
  findable by its own full name.
- Keep matching the friendly label as a substring, so partial words the reader can actually
  see still work.
- Move the rule into one shared helper and have both the annotation dropdown and the query
  builder's annotation picker use it, so the two pickers stop disagreeing.

## Capabilities

### Modified Capabilities

- `annotation-presentation`: annotation search matches the displayed label or a word of the
  column name, and behaves identically in both pickers.

## Impact

- Adds one exported helper beside `annotationLabel`/`annotationSource` in `packages/utils`.
- Changes the filter in `annotation-select.ts` and `query-condition-row.ts` to call it.
- No data, storage, URL or API change. Only which rows a query shows.
