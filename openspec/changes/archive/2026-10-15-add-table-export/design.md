## Context

`read_tables` hands back v2-shaped tables whatever the container: annotation cells in the v2
grammar (`label|score`, percent-encoded names, `;`-joined hits), projections in long format
(`projection_name, identifier, x, y, z`). The web app's `getCurrentData()` already returns the
visible subset (query filter and isolation), and `exportProteinIds` further drops proteins whose
values of the coloured annotation are all hidden in the legend.

## Goals / Non-Goals

**Goals:**

- One table per protein that opens in a spreadsheet or `pandas.read_csv(sep="\t")` with no
  ProtSpace knowledge.
- The web table holds exactly the proteins the ID export would, so the two never disagree.
- CLI and web agree on column names, so a script reading one reads the other.

**Non-Goals:**

- Round-tripping: the table is a read-out, not an input format.

## Decisions

- **Command name `export`.** Every command is a single verb (`prepare`, `bundle`, `transfer`,
  `convert`, ...), and the web app calls the same action Export. Registered in the Refine panel
  after `convert`, with positional `INPUT OUTPUT` like `convert`.
- **Display values, not stored cells.** `to_display_value` (the transform behind `serve`, the style
  keys and the `style` template) strips `|score` / `|evidence`, decodes v2 percent-encoding and
  re-joins hits with `;`. The table is for reading; the stored grammar is in the bundle.
- **Projections opt-in with `-p NAME` (repeatable), wide columns `<name>_x`, `<name>_y`.** A bundle
  can hold many projections; all of them by default would bury the annotations. No `_z` column,
  even for a legacy projection stored with a third axis: 3-D reduction is no longer supported, so
  the table does not offer it. An unknown name is a usage error that lists the
  available ones. A protein a projection does not place gets empty coordinates.
- **Column order: id, coordinates, annotations in bundle order.** The id column is always called
  `protein_id`, whatever the bundle names it (`protein_id` or `identifier`), in both CLI and web.
  The two share column names, not positions: the web places an annotation's `__pred_*` columns
  right after it, the CLI keeps the bundle's order, and the docs say to read columns by name.
- **Web: one visible-set helper for IDs and table.** The hidden-legend filter in
  `exportProteinIds` moves into a private method both exports call, so the two cannot drift.
- **Web columns.** Categorical annotations as their labels (`;`-joined for multi-valued cells,
  empty for N/A); numeric annotations as their raw values, not their bins; the synthetic
  EAT-confidence view skipped; for an annotation with EAT predictions, the base column holds only
  curated values (as the bundle export writes it) and `<col>__pred_value`, `__pred_confidence`,
  `__pred_source` follow it, the names Python writes. Coordinates of the selected projection only,
  as raw stored values (not the plane-mapped plot positions), each float32 written as the
  shortest decimal that reads back as the same float32, as pandas prints a float32 column.
- **Quoting.** Tab-separated, `\n` line ends; a field containing a tab, newline, carriage return
  or `"` is wrapped in quotes with inner quotes doubled, which is what `pandas.to_csv` writes and
  `read_csv` reads. The CLI writes through `pandas.to_csv`, so both sides quote alike.
- **Download through a Blob URL.** A table can be megabytes; a `data:` URI (what the ID export
  uses) is length-limited in some browsers.

## Risks / Trade-offs

- [Large datasets make large tables] → The web export is bounded by what is visible; the CLI
  builds the table in memory as a DataFrame, decoding each distinct cell once, which is the same
  order of memory as reading the bundle.
- [A label containing `;` is indistinguishable from two hits] → Same rule as the app's display;
  the bundle keeps the exact cells.
