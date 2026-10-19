## Why

The archived `custom-csv-annotations` change let a column named `identifier`, `protein_id` or `id`
outrank the first column as a custom annotation file's id column. The maintainers decided against
it: the id column of a custom annotation file is the first column, always, whatever its header.

- It is the rule every release has had. v3's `protspace-local`, v4.4.0 and 4.16.5 all renamed the
  first column to `identifier` (`local_processor.py` in v3.3.1, `pipeline.py` in v4.4.0 and
  4.16.5). The precedence rule was never released.
- One positional rule is easier to state and to predict than a ranking of names. A file such as
  `accession,id,family` silently keyed on the wrong column under the ranking.

The precedence rule did fix something real, and that must not regress: a later column named
`identifier` or `protein_id` used to fail `prepare` with `The column label 'identifier' is not
unique` or `Duplicate column names found`, because the first column is renamed `identifier` and
the bundle writer renames that to `protein_id`.

## What Changes

- **The first column holds the ids** of a custom annotation file (`.csv`, `.tsv`, `.txt`), in
  `prepare`, `annotate`, `stats` and `bundle`. No column name takes precedence over it.
- **A later column with a reserved name is kept, renamed.** A non-first column named `identifier`
  or `protein_id` (the pipeline's and the bundle's id column), or `id`, `uniprot`, `entry`,
  `projection_name`, `x`, `y` or `z` (names the web viewer reads as id or projection columns and
  never shows as annotations), becomes the annotation `<name>_annotation`, and a warning names the
  file, the column and its new name.
- **A parquet's id column** (`stats -a`, `bundle -a`) is the column named `protein_id` or
  `identifier`, as every table ProtSpace writes names it and as released `bundle -a` required, else
  the first column; a parquet with both is refused. The case-insensitive match and the `id` rank
  the archived change gave parquets were never released and are dropped.
- **Docs and notebook** state the first-column rule; the "Upgrading from v4.4" note no longer
  warns about an id-column change, since there is none.

## Capabilities

### Modified Capabilities

- `custom-annotation-files`: the id-column requirement is replaced by the first-column rule, the
  reserved-name rename and the parquet rule.

## Impact

- Python (`apps/protspace`): `data/processors/custom_annotations.py` (`_read_file`,
  `resolve_id_column`, `RESERVED_COLUMNS`); comments and help in `cli/stats.py`, `cli/bundle.py`,
  `cli/prepare.py`; the `serve` app's help FAQ (`assets/help_content/help_faq.md`).
- Behaviour a user can see, compared with the unreleased archived change: a later `identifier`,
  `protein_id` or `id` column no longer becomes the id column; it reaches the output as
  `<name>_annotation`. Compared with 4.16.5: those files now work instead of failing, and a later
  `id`, `uniprot`, `entry`, `x`, `y`, `z` or `projection_name` column, which the viewer used to
  hide, is shown under its new name.
- Tests: `tests/test_custom_annotations.py` (first-column, rename and parquet cases; the reserved
  names pinned against the viewer's list).
- Docs: `docs/guide/python-cli.md` ("Custom annotation files", the `bundle` section, "Upgrading from
  v4.4"), `docs/guide/data-preparation.md`, `docs/guide/faq.md`, `apps/protspace/CLAUDE.md`, the
  Preparation notebook's CSV hint.
- No bundle-format, dependency or public API change.
