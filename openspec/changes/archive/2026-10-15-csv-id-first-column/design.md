## Context

`custom_annotations.py` is the one reader of a user's `-a` table. `_read_file` resolves the id
column with `resolve_id_column`, which ranks `identifier`/`protein_id` (case-insensitive, any
position) over `id` over the first column, and renames the winner `identifier`. `stats -a` and
`bundle -a` resolve a parquet's id column with the same function. The precedence was added on this
branch and never released; 4.16.5, v4.4.0 and v3.3.1 all key on the first column.

Downstream, the column names that are not free for an annotation:

- `identifier`: the pipeline's id column, which the loader gives the first column.
- `protein_id`: the bundle's id column; `base_processor` renames `identifier` to it, and the v3
  encoder and `transfer` key on `protein_id`/`identifier` by name, refusing a table with both.
- `id`, `uniprot`, `entry`, `projection_name`, `x`, `y`, `z`: the web viewer's `ID_COLUMNS`
  (`packages/core/src/components/data-loader/utils/conversion.ts`), which it removes from the
  annotation columns by exact name, so such a column never shows.

## Goals / Non-Goals

**Goals:** the first column is the id column of every custom annotation file; a later column with a
reserved name reaches the output and the viewer; `stats` and `bundle` still agree on a parquet.

**Non-Goals:** an option to choose the id column; changing the viewer's reserved list; renaming
reserved columns of a parquet the user built (the parquet path keeps its released behaviour).

## Decisions

### The first column, whatever its header

`_read_file` sets the columns to `[identifier, *rest]` positionally, so no header lookup happens
and a first column named anything, including `protein_id` or `id`, is the id. Coverage reporting
already catches the file whose first column holds no ids: its ids match no input protein, and the
warning shows examples of both.

### Reserved later columns are renamed, with a warning

Each non-first column whose header is exactly one of `RESERVED_COLUMNS` becomes
`<name>_annotation` (then `<name>_annotation_2`, … if the file already has that name), and a
WARNING names the file, the original and the new name, and why. Renaming instead of failing keeps
the 4.16.5 regression fixed (the duplicate-column errors) without asking the user to edit the file.
Renaming instead of dropping keeps the data. The match is exact and case-sensitive because every
collision is: pandas, the bundle writer, `transfer` and the viewer's `Set` all compare names
exactly, so `Protein_ID` or `ID` collides with nothing and is left alone.

The viewer's names are in the set because a column the viewer hides is lost just as surely as one
that fails the run. The set is pinned against `ID_COLUMNS` in `conversion.ts` by a test, so a change
to either list fails CI instead of drifting.

### A parquet keeps its name-based rule

`resolve_id_column` now serves only parquets: `protein_id` or `identifier` by exact name, else the
first column, and both is an error. Every parquet ProtSpace writes (`annotate`, the prepare cache,
`stats`' `<stem>.annotations.parquet`, an unbundled `selected_annotations.parquet`) names its id
column so; released `bundle -a` required one of those names and released `stats -a` took
`identifier`, else the first column. Applying the positional rule to parquets would silently mis-key
a pandas-built table with `protein_id` second, which `bundle` has always accepted. The archived
change's case-insensitive match and `id` rank are dropped: unreleased, and `id` no longer means
anything to the custom-file rule either.

`stats -a labels.csv` writes the loader's frame, so its `<stem>.annotations.parquet` has the ids in
`identifier`, first, and any reserved later column already renamed. `bundle -a` on it therefore
finds exactly one id column, whichever of the two rules is applied.

## Risks / Trade-offs

- **[A user who relied on the unreleased precedence]** Only a pre-release build had it. A file with
  the ids in a later column now gets a coverage warning naming unmatched ids; moving the id column
  first fixes it.
- **[Renamed columns change names]** A later `id` column reaches the bundle as `id_annotation`. The
  warning says so; before, it was hidden in the viewer or failed the run.
- **[The pin reads a TypeScript file]** The Python test parses `ID_COLUMNS` from `conversion.ts`. A
  reformat of that literal can break the parse; the test then fails loudly rather than passing.
