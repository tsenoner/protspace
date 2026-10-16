## Context

Before `custom-csv-annotations`, `bundle -a` renamed `identifier` to `protein_id` only when
`protein_id` was absent, and `stats -a` took `identifier`, else the first column; the two disagreed
on a table with both. The archived change settled the disagreement by refusing such a table, which
breaks the bundle contract suite's `coverage` variant and a released `bundle -a` input.

## Decisions

- **`protein_id` first, for both commands.** It is what released `bundle -a`, the v3 encoder
  (`_prepare_annotations`) and `docs/guide/data-format.md` ("keeps `protein_id` as its ID column
  and `identifier` as an annotation") already do, so `stats` moves to it rather than `bundle` away
  from it. `stats` and `bundle` still agree, which is what the refusal was for.
- **No warning.** A table with both is a supported shape (the contract pins it), not a mistake.

## Risks / Trade-offs

- **[`stats -a` on a table with both]** It now keys on `protein_id` where 4.16 `stats` keyed on
  `identifier`. The table `bundle` makes of it is keyed on `protein_id` too, so the cluster columns
  `stats` adds land on the rows `bundle` shows.
