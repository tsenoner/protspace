## Why

A user who brought their own annotation table found every route but one broken, and the one that
worked lost data without saying so:

- `prepare -a a.csv -a b.csv` keeps only `b.csv`. A second table of re-annotation results, added
  next to the original metadata, silently drops the metadata.
- `prepare -a x.csv` trusts the extension for the delimiter. A tab- or semicolon-separated `.csv`
  parses to one column and the bundle gets no annotations, with exit 0 and no warning. So do ids
  that do not match the embedding's (`P60000` against `sp|P60000|TX0_CONSP`), and an id column
  that is not first.
- `.CSV` and `.txt` are "Unknown annotation"; a `protein_id` or `identifier` column that is not
  first fails with a duplicate-column error; an empty cell becomes the literal `nan`.
- `annotate -a x.csv` dies with a `ValueError: Unknown annotation` traceback, and `stats -a x.csv`
  and `bundle -a x.csv` with pyarrow's "Parquet magic bytes not found". `stats` and `bundle` also
  disagree on which column holds the ids, so a table `stats` enriches can be one `bundle` rejects.
- `project` has no `-a` and no `--stats` and says nothing about where they went. v4.4 users
  remember a CSV there; it was `prepare` (or v3's `protspace-local`) all along.

Separately, `prepare` on HDF5 input builds the embedding config whatever it is asked to do, so it
imports `biocentral_api` (and through it torch, when installed) for a run that embeds nothing, and
`-b local` was the user's guess at a fix for what was a client-rename crash in that import. `-b` is
silently ignored on HDF5 input and `--max-length` is rejected there as if it mattered.

## What Changes

- **One loader for custom annotation files**, used by `prepare`, `annotate`, `stats` and `bundle`:
  - `.csv`, `.tsv` and `.txt`, any case, are files; every other `-a` value stays a source name.
  - The delimiter is sniffed from the header (tab, comma or semicolon), not taken from the
    extension; a file that still parses to one column is warned about.
  - The id column is `identifier` or `protein_id` wherever it sits (case-insensitive), else `id`,
    else the first column. Two id-named columns are an error, as is a non-id column named
    `identifier` or `protein_id`.
  - Cells are read as text: an empty cell stays empty. A UTF-8 byte-order mark and CRLF or lone
    CR line endings are normalised.
  - Several files are merged on the id column; a column that two files both define is an error.
  - Each file's ids are counted against the input's ids; ids that match nothing are warned about,
    with examples of both.
  - The cells are plain text, so they are encoded into the v2 cell grammar exactly as `bundle -a`
    already reads a hand-written table: `;` outside parentheses separates values.
- **`annotate -a`** takes files beside source names; files alone fetch nothing. An unknown source
  name is a usage error instead of a traceback.
- **`stats -a`** and **`bundle -a`** take a CSV/TSV. `stats` scores it and, since it does not
  rewrite a text file, writes the table with its cluster columns to `selected_annotations.parquet`
  in the projections directory. A file that is neither is a usage error. Both resolve a parquet's
  id column with the same rule.
- **`project`** gets hidden `-a/--annotations` and `--stats` options that exit with a usage error
  naming the one-shot route (`prepare … -a x.csv --stats`) and the step route (`annotate`, `stats`,
  `bundle`). Its help names `prepare`.
- **Embedding options with nothing to embed.** With HDF5-only input, `prepare` builds no embedding
  config and imports nothing from `protspace.data.embedding`, `biocentral_api` or torch; a given
  `-b/--backend`, `--batch-size` or `--max-length` is warned about as having no effect.
- **Docs.** The CLI guide: "Which command do I need?", a "Custom annotation files" section with the
  rules above, the stepwise recipe, an H5 + CSV + `--stats` example with 2-D methods, `-b` applying
  only when embedding, "Upgrading from v4.4", and a troubleshooting entry for `KeyError: 'ESM_8M'`.
  FAQ: the custom-annotation answer and the bundle part count.

### Non-goals

- A `project` that annotates or scores. `project` stays projection-only; `prepare` is the one-shot
  command.
- Reading spreadsheets (`.xlsx`) or a `--delimiter` option. A file with another suffix is refused
  with the accepted ones named.
- Changing which embedding methods exist. 3-D projections are no longer promoted; no example,
  default or recommendation here uses one.

## Capabilities

### New Capabilities

- `custom-annotation-files`: how a user's annotation table is recognised, parsed, keyed, merged,
  checked against the input and encoded, the same way in every command that takes `-a`; and
  `project` refusing annotation and statistics options with a pointer.

### Modified Capabilities

- `embedding-backend-selection`: embedding options are scoped to runs that embed; a run that embeds
  nothing imports no backend and says the options did nothing.

## Impact

- Python (`apps/protspace`): new `data/processors/custom_annotations.py`; `data/processors/
pipeline.py` (CSV loading moved out, several files, `nan` kept out of the metadata);
  `cli/annotate.py`, `cli/stats.py`, `cli/bundle.py` (`-a` files, id column); `cli/project.py`
  (hidden options, help); `cli/prepare.py` and `cli/common_options.py` (embed config only when
  embedding, warnings, help).
- Behaviour a user can see: `prepare -a` with several files merges instead of keeping the last; a
  plain-text CSV cell is no longer read as percent-encoded (a literal `%41` stays `%41`, and
  `Membrane (single-pass; type I)` stays one value); a parquet carrying both `identifier` and
  `protein_id` is refused by `bundle` instead of silently using `protein_id`; `--max-length` with
  HDF5 input warns instead of failing.
- Tests: a new `tests/test_custom_annotations.py`; `test_pipeline_utils.py`'s
  `_resolve_annotation_names` cases follow the new return shape.
- Docs: `docs/guide/python-cli.md`, `docs/guide/faq.md`, `apps/protspace/CLAUDE.md`.
- No bundle-format, dependency or public Python API change.
