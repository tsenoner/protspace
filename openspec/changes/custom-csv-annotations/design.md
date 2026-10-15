## Context

`prepare -a` has read a custom CSV since v4.0.0, in `ReductionPipeline._fetch_annotations`: the
last `-a` item ending in `.csv`/`.tsv` (case-sensitive) wins, `sep` is tab for `.tsv` and comma
otherwise, the first column is renamed to `identifier`, and `run()` stringifies the frame
(`NaN` → `"nan"`) and left-joins it onto the embedding ids with no coverage check. No other command
reads a CSV: `annotate -a` hands every value to `AnnotationConfiguration`, and `stats`/`bundle`
call `pq.read_table` on whatever `-a` names.

The step commands also disagree on the id column of a parquet: `stats` takes `identifier`, else the
first column; `bundle` renames `identifier` to `protein_id` and otherwise needs `protein_id`.

`build_embed_config` runs unconditionally in `prepare` and imports `protspace.data.embedding`,
whose package `__init__` imports `biocentral.py` and so `biocentral_api` → `biotrainer_core` →
torch when installed. That import chain is what crashed every `prepare` on 4.16.0 with
`KeyError: 'ESM_8M'`, HDF5 input and `-b local` included.

## Goals / Non-Goals

**Goals:**

- One reader for a user's annotation table, with the same rules in every command.
- No silent data loss: a second file merges, a wrong delimiter and unmatched ids are warned about.
- A CSV given to a command that cannot take one is a one-line usage error naming the route that
  can.
- A run that embeds nothing imports nothing embedding-related and says when an embedding option
  had no effect.

**Non-Goals:**

- Annotation or statistics in `project`.
- Spreadsheet formats, an explicit delimiter option, or id normalisation (accession extraction
  from `sp|…|…` keys). Ids still have to match exactly; the warning says so.
- Removing the `*3` methods. They stay accepted and are not mentioned in anything new.

## Decisions

### One module in `data/processors/`

`custom_annotations.py` holds the whole contract: which `-a` values are files
(`split_annotation_args`), the id-column rule (`resolve_id_column`), reading one file, merging
several onto the input's ids (`load_custom_annotations`), and laying them over fetched annotations
(`merge_custom_annotations`, the pipeline's former `_merge_csv`). The CLI commands import it
lazily, as they import everything else.

### A file is recognised by its suffix

`.csv`, `.tsv`, `.txt`, compared case-insensitively. A suffix is a cheap, local test that cannot
mistake a source name for a file; `-a default` with a file called `default` in the working
directory stays the group. A value with any other suffix that names an existing file (`x.xlsx`,
`x.parquet`) is refused with the accepted suffixes, instead of reaching the source-name lookup.

### Sniff the delimiter from the header line

The header is split with `csv.reader` once per candidate (tab, comma, semicolon) and the delimiter
giving the most fields wins; a tie goes to the extension's own delimiter (tab for `.tsv`/`.txt`,
comma for `.csv`), then tab, comma, semicolon. Only the header is used because the data rows are
where the delimiters legitimately occur as text: ProtSpace's own multi-value separator is `;`, and
labels such as `Homo sapiens, human` carry commas. `csv.Sniffer` was not used: it samples data rows
and guesses wrong on exactly those files. A header that splits into one field under every candidate
is a one-column file; it is read, and a warning names the expected delimiters.

### The id column rule

1. A column named `identifier` or `protein_id`, compared case-insensitively, in any position.
   Two such columns are an error: the table names its ids twice.
2. Else a column named `id`, case-insensitively.
3. Else the first column, whatever its header (the rule `prepare` always had).

The chosen column is renamed `identifier`, the pipeline's name for it. Any other column still named
`identifier` or `protein_id` is an error, because the bundle writer renames `identifier` to
`protein_id` and would produce a duplicate. The same function resolves a parquet's id column in
`stats` and `bundle`, so a table `stats` enriched is one `bundle` accepts.

### Text in, text out

`pd.read_csv(dtype=str, keep_default_na=False)`: an empty cell is `""`, and a literal `NA` or
`null` label stays a label. Before parsing, the bytes are decoded as UTF-8 with an optional BOM
(Excel writes one; it would otherwise become part of the first header) and `\r\n` and lone `\r`
become `\n`. Header names and id cells are stripped of surrounding whitespace; other cells are kept
as written. Rows without an id are dropped; a repeated id keeps its first row, with a warning
naming the count.

`run()` used `metadata.astype(str)` before joining onto the embedding ids, which turned the `NaN`
that a merge leaves for an unannotated protein into `"nan"`. It fills those with `""` first, as
the bundle writer already does for the rows the join adds.

### Several files merge, collisions fail

Files are read in the order given, de-duplicated by resolved path, and outer-joined on
`identifier`. A non-id column that appears in two files is a `ValueError` naming the column and
both files: there is no right answer to which one wins, and picking one is the silent loss this
change exists to remove. A fetched source column with the same name as a file column is still
overridden by the file, as documented.

### Coverage is checked against the input, per file

Every command that loads a file passes the input's ids (`prepare`: the validated embedding headers;
`annotate`: the extracted identifiers; `stats`: the projections' ids; `bundle`: the projection
data's ids). For each file an INFO line gives the counts, and a WARNING fires when any of the
file's ids matches no input protein, showing up to three of them and three input ids, and saying
ids must match exactly. A file that covers only part of the input is not warned about: annotating
only the references is a normal use. The returned frame has exactly one row per input id, in input
order, so the commands that write a table write the same rows whatever the files held.

### Cells are encoded once, at the loader

Fetched annotations are v2 (percent-encoded) cells; a hand-written table is plain text, which is
the v1 grammar `bundle -a` already migrates. The loader runs `encode_legacy_cell` on every non-id
cell, so every consumer receives v2 and none of them has to know where a column came from:
`prepare` merges it with fetched columns, `annotate` writes it under its v2 stamp, `stats` scores
it, `bundle` passes it through. For the common file nothing changes; a literal `%41` or a `;`
inside parentheses now survives where `prepare` used to decode or split it.

### `stats` writes a text table's enrichment beside the projections

`stats -a table.parquet` enriches the parquet in place. A CSV is the user's source file, so `stats`
does not rewrite it: it builds the frame from the loader (one row per projected protein, so the
unannotated proteins get cluster columns too) and writes it, stamped v2, to
`selected_annotations.parquet` in `-p`, the name the unbundled directory layout already gives the
annotations part, then names that path for `bundle -a`. Writing next to the user's CSV was
rejected: a run should not create files beside its inputs. Requiring a new output option was
rejected: the common recipe would need one more flag to do the obvious thing.

### `project` refuses, it does not grow

Hidden `-a/--annotations` and `--stats` options exist only to turn "No such option" into a
`typer.BadParameter` that names `prepare … -a x.csv --stats` and the `annotate` → `stats` →
`bundle` route. Hidden, because they are not features of the command and must not appear in
`--help`; the help's docstring names `prepare` instead.

### Embedding config only when something is embedded

`prepare` knows before reading any input whether it will embed: FASTA input (by extension, the test
the input loop uses) or `-q`. Only then does it call `build_embed_config`. Otherwise `embed_config`
is `None`, `run.log` lists no embedding settings, and `-b/--backend`, `--batch-size` or
`--max-length` given on the command line (read from Click's parameter source, so a default never
warns) produce one warning: they apply only when sequences are embedded. `--max-length` with the
Biocentral backend stays an error when something is embedded.

The `data/embedding` package `__init__` is left eager: with the config deferred, no run that embeds
nothing reaches it, and a test pins that by running an HDF5-only `prepare` in a fresh interpreter
and checking `sys.modules` for `protspace.data.embedding`, `biocentral_api` and `torch`.

## Risks / Trade-offs

- **[A table with both `identifier` and `protein_id`]** `bundle` used to take `protein_id`
  silently; it now refuses. No ProtSpace producer writes both; the message says to drop one.
- **[Header-only sniffing on an unusual header]** A header whose fields contain the delimiter
  without quoting splits wrongly. The single-column warning and the coverage warning both catch
  the usual outcome.
- **[Plain-text encoding changes rare prepare cells]** A CSV cell that relied on percent-escapes
  being decoded now keeps them. No documented use asked for that; the bundle docs already described
  hand-written tables as plain text.
- **[`stats` writes into `-p`]** A previous `selected_annotations.parquet` there is replaced
  atomically. It is the table the same command would write again.

## Migration Plan

None. Existing single-file `prepare -a` runs give the same bundle unless a cell held a percent
escape or a parenthesised `;`, and every newly accepted input used to fail.

## Open Questions

None.
