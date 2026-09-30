## Context

A `.parquetbundle` is Parquet files joined by `---PARQUET_DELIMITER---`. Up to format v2 the
annotations are string cells in the v2 grammar (`;` between hits, `|` before a score or evidence
code, percent-encoded labels), and projections are long-format rows, one per protein and
projection. The browser parses every cell into row objects and then into typed arrays, and on the
573K Swiss-Prot bundle that parse dominates load time and peak memory.

PR #477 (Peyman Vahidi) adds format v3, which moves the parse to the writer. The format is
documented in `docs/guide/data-format.md` ("Format v3 layout" and "Format v3 Physical Schema"),
and this document does not restate it. In short: six fixed slots; part 1 holds one row per protein
with `INT32` codes, `INT32` per-row hit counts or `DOUBLE` numerics, and a JSON manifest in its
footer; part 3 is wide `FLOAT` columns `<name>__x|y|z`; part 6 holds label dictionaries and CSR
buffers. The Python side is a container-boundary codec (`encode_v3` / `decode_v3`), so every
command above it still sees v2-shaped tables.

This change is written after the PR's first implementation and review. It records what the
maintainer decided on the open points and splits the remaining work into a Python track and a
TypeScript track.

## Goals / Non-Goals

**Goals:**

- One written format: every bundle ProtSpace writes, from Python or from the web app, is v3.
- Every v1/v2 bundle keeps loading until 5.0.0, and users are told what to do about it.
- A way to upgrade a file with and without installing anything.
- v3 renders the same dataset v2 did: same proteins, same labels, same dimensions, nothing at
  (0,0) that was not there.
- An imported file survives a tab crash during its first render, as it does on `main`.

**Non-Goals:**

- Missing-value labels marked in the manifest.
- Splitting #477's unrelated performance commits into other PRs.

## Decisions

### v3 everywhere on write, v1/v2 read-only until 5.0.0

Both producers write v3: the Python writer already does, and the web exporter switches from v2. Read
support for v1/v2 stays in both languages and is deprecated. The alternative, keeping v2 as the web
export format, would leave two writers producing two formats, and a bundle's format would depend on
which tool last touched it.

Deprecation is announced where each reader runs:

- **Python** logs one warning per legacy read, at the one place a bundle's layout is decoded
  (`bundle._parse_bundle` and its callers), naming `protspace convert` and 5.0.0. One warning per
  read, not per process: a script that loads ten legacy bundles should say so ten times, and
  nothing is quiet after the first.
- **The browser** shows a non-blocking notice through the app's existing `notify` mechanism when a
  user-provided v1/v2 bundle loads, suggesting a re-export from the app or `protspace convert`. The
  core reader does not show UI. `decodeParquetBundle` reports the container's format version and
  the app decides. Datasets the app serves itself (the default `data.parquetbundle` and the example
  datasets) do not trigger the notice: a first-time visitor cannot act on it. They were v1 (one v2)
  and are converted to v3 in this change, so the notice would not fire for them anyway, and a user
  who downloads an example dataset and imports it does not see it either.

The release is a minor. Every bundle still loads, so there is nothing breaking to announce, and a
`BREAKING CHANGE` footer would cut protspace 5.0.0 now, before the removal it names.

### `protspace convert`

A new command in the same panel as `style` and `transfer`. It follows `style`'s positional form:
`protspace convert INPUT [OUTPUT]`, plus `--in-place`. It requires one of the two. Passing `OUTPUT`
equal to `INPUT` is an explicit request, and so is `--in-place`; nothing else writes over the
input. A default output name (say `<stem>.v3.parquetbundle`) was considered and rejected, because
a batch script would then leave a v1 and a v3 copy side by side with nothing to say which one the
app should load.

It reads through the same legacy reader as every other command. The legacy annotations part is
read with its grammar stamp intact, so `convert` knows whether it is v1 and migrates it to the v2
grammar explicitly before encoding (see "Two version keys" below: the encoder no longer guesses).
Settings and the statistics part are carried over, and the result goes through
`atomic_write_bytes`, so an interrupted run leaves either the old file or the new one. A v3 input is
reported as already current, and nothing is written, not even to a separate `OUTPUT`.

In the browser, loading a legacy bundle and exporting it writes v3. That is the converter for users
without Python, and it needs no extra UI.

### `protspace style` upgrades a legacy input

`style` replaces the settings part (`replace_settings_in_bundle`). On a v3 input it keeps every
other part byte for byte, as before. On a v1/v2 input it used to do the same, so a styled legacy
bundle stayed legacy. That made `style` the one command whose output format depended on its input,
and it kept producing files in a format that is deprecated. It now encodes a legacy input's core
exactly as `convert` does (the same helper, v1 grammar migrated from the part's own stamp),
carries the statistics part over, writes the new settings, and logs one warning naming the input's
version and saying the output is v3, since builds from before v3 cannot open it. The input is never
written, so `style old.parquetbundle old.parquetbundle` is the only way it replaces a legacy file,
as for `convert`.

A legacy file the encoder cannot take as it stands is the cost of that choice: before this
change `style` copied the core parts through, whatever they held. Two shapes the v2 browser
reader accepted and v3 refuses are common enough in hand-built bundles to matter, and the
conversion helper now reads them the way the browser did, with a warning each: an id column
named other than `protein_id` or `identifier` (the browser took the first column whose name
contains `protein_id`, `identifier`, `id`, `uniprot` or `entry`, else the first column), and null
or repeated ids (it skipped a null, and a later row replaced an earlier one in its `Map`). Both
`convert` and `style` go through it. What is still refused (projection sets that disagree
between metadata and data, two rows for one protein in one projection) is a usage error with
the encoder's reason in both commands, never a traceback, and nothing is written.

The alternative, keeping `style` a pure settings edit and leaving `convert` as the only upgrade
path, was the first version of this change. It was dropped because "every write emits v3" is the
rule users can rely on, and the cost is a re-encode that `transfer` already pays.

### Missing coordinates are NaN, culled in one place

v2's long-format projections simply had no row for a protein a projection did not cover. The v2
browser reader allocated a zero-filled `Float32Array` and never wrote those slots, so such a protein
was drawn at (0,0). The PR kept that and wrote `0.0` into v3's wide columns for parity. (0,0) is a
real position in every projection, so a missing value there reads as data.

Missing is NaN from the file up:

- the v3 encoder writes NaN into part 3 for a protein a projection does not cover;
- the v3 reader keeps NaN, and the legacy reader fills its coordinate arrays with NaN before
  writing the rows it has;
- Python's `decode_v3` emits long-format projection rows only for finite coordinates, so a v3
  round trip gives back the v2 tables the encoder was handed.

The scatter plot culls non-finite points in `DataProcessor.processVisualizationData`, where plot
data is built from the projection arrays, next to the query-filter and isolation culls. The
visibility model was the other candidate, and it is the wrong layer: an opacity of `0` still leaves a
point in the plot data, the GPU buffers, the depth sort and the point count. Several consumers never
consult opacity at all. The extent loop in `createScales` skips NaN only because every comparison
with NaN is false. Everything downstream (the scale domains, the WebGL buffers, the depth sort, the
picking grid, hover, click, brush, lasso, the density contours, duplicate stacks and every export)
reads `PlotData`, so after the cull none of them sees such a point. Existing `Number.isFinite` guards in the duplicate
stack and picking code become redundant. They stay for now.

One path bypasses `processVisualizationData` today. On a projection switch,
`scatter-plot.ts#_updatePlotDataCoordinates` copies the new projection's coordinates into the
existing `PlotData` in place, to avoid reallocating it. With per-projection culling, the set of
surviving points can change between projections, so that fast path is only valid when the new
projection leaves exactly the same points after the cull (in practice: neither projection has a
missing coordinate). Otherwise it falls back to a full rebuild. The TypeScript track audits every other read of `data.projections` for the
same bypass.

Isolation is the one cull that is a set of proteins rather than a view. `PlotData` holds the
isolated points the selected projection places, so the isolated subset itself (what
`getCurrentData` hands the `.parquetbundle` export and the legend, and what `isolateSelection`
checks a new selection against) is taken from membership in the isolation layers and the query
filter, not from `PlotData`: a protein missing from one projection stays isolated and comes back
in the next.

An unfiltered projection with no missing points keeps the identity path (`originalIndices = null`),
so the common case pays one finiteness pass and no copy.

### The browser protein set is the proteins with some finite coordinate

v2's reader built the protein list from the projection rows, so an annotation-only protein never
appeared, was never counted in a legend and could not be searched. v3's part 1 keeps
annotation-only rows (the file stays lossless), and the browser v3 reader drops every protein that
has no finite coordinate in any projection before it builds `protein_ids` and the annotation arrays.
That includes the label dictionaries: the encoder ranks a column's labels over every row of part
1, so after the drop the reader re-ranks them over the placed proteins' hits (by descending count,
ties by first occurrence, as the encoder ranks) and leaves out the labels only dropped proteins
carried, before it folds missing spellings, assigns the palette and adds an N/A entry. A label
only an unplaced protein has therefore takes no rank, colour or N/A slot, and the dataset hash
that keys saved legend settings is the one v2 gave the same data.
A protein with coordinates in one projection but not another stays in the set and is culled per
projection by the rule above.

"Ties by first occurrence" is only v2's order if part 1 is in v2's protein order, and v2 built
that order from the projection rows (first appearance, across projections), not from the
annotations table. The encoder therefore writes part 1 in that order, with the proteins no
projection covers after them. Every shipped dataset already listed its annotations in projection
order, but a user's table given to `protspace bundle -a` sorted by accession, say, would otherwise
change the default colours of tied labels and the dataset hash that keys saved legend settings.

In the other direction, a projection identifier missing from the annotations table was an error in
the PR's encoder. v2 accepted it and showed the protein with N/A annotations. The encoder now adds
such identifiers as rows whose annotations are all missing.

### Dimension from the data

The PR's encoder took the dimension from projection metadata when it said 2 or 3, and fell back to
the data otherwise. Metadata written by hand or by an older tool can be wrong. A 3D projection
declared 2D then loses its `z`, and a 2D one declared 3D gets a NaN `z` column. The encoder now sets
the dimension from the data (any finite `z` means 3; a NaN `z` is as missing as a null one, as
both legacy readers treat it) and logs a warning when a `dimensions` value
disagrees. The manifest records the derived value, and the browser reader keeps trusting the
manifest. Part 2 is written with the derived value too: a stale `dimensions` left there would
contradict the manifest and part 3 for anything that reads projection metadata on its own (the
Python Dash viewer, `protspace stats`). An agreeing column is written as given, and a rewritten one
keeps its integer type, or becomes `int64` when it was not an integer column. `decode_v3` applies
the same rule, so a part 2 written by another tool still decodes to the manifest's dimension.

### Booleans are spelled `true` / `false`

The v2 browser reader rendered an Arrow `BOOLEAN` annotation as `true`/`false`, JavaScript's
spelling. The v3 encoder flattened it with Python's `str()`, which gives `True`/`False`, so legend
entries, colour assignments keyed by label and saved legend settings stopped matching. Both
encoders spell booleans `true`/`false`.

### List columns are multi-valued

A user's annotations table can hold a list column, GO terms kept as a pandas list column for
instance. The v2 writer stored it as a Parquet list, and the v2 browser reader showed each cell
as its elements joined by commas, one label per cell (JavaScript's `String` of an array). The v3
encoder casts every non-numeric column to text and had no rule for a list, so such a table could
no longer be bundled at all. A list is what a v2 multi-valued cell means, so the encoder writes
each non-empty element of a cell as one hit, percent-encoding it first so a `;` or `|` inside an
element stays part of its label, and records `sourceType` `"?"`. Numeric inference, which would
read a list of single numbers (`[1]`, `[2]`) as a numeric column, is skipped for a list: v2 showed
such a cell as the category `1`. A column with no text form (a
struct, a map, a list of lists) is refused with an error that names it, and `protspace bundle`
reports the encoder's input errors as a usage error rather than a traceback.

### Column types survive a web re-export

The manifest's `sourceType` is the Arrow type a column had in Python (`bool`, `int32`, `string`,
...). `decode_v3` restores a numeric column to it and a `bool` column from its `true`/`false`
labels. The web exporter used to write its own guess (`string`, `int64` or `double`), so a
Python-written boolean column exported from the app decoded in Python as the strings `true` and
`false`, and a float64 column of whole numbers came back `int64`.

The browser reader now keeps the manifest's `sourceType` on the loaded `Annotation` (an optional
field, set once per column at load and never read by rendering), and the exporter writes it back
when the column as written still fits it: an integer type when every value is a whole number in
its range that a float64 holds exactly (up to ±2^53 inclusive, where Python's encoder draws the
same line), or when the column is categorical and every label is a decimal integer in its range
(the exact labels described below), `bool` when the column is categorical with only `true`/`false` labels, a float type when
it is numeric, and anything else (`string`, a timestamp, `?`), which Python only renders as text,
always. A column the app changed so that it no longer fits, and every column of a legacy load, gets
the exporter's own choice. The alternative, re-deriving the type in the writer, cannot tell a
float64 column of whole numbers from an integer one or a string column the browser reads as numbers
from a numeric one.

An integer column with a value beyond ±2^53 (a 64-bit hash or ID) cannot be a `DOUBLE` without
losing digits, and the encoder's safe cast refused it, so a bundle that `main` wrote could no
longer be written, converted or styled. The encoder stores such a column as a categorical column
of its exact decimal labels, which is what the v2 browser reader showed for a bigint it could not
hold as a number, and `decode_v3` casts the labels back to the recorded integer type.

The EAT companion columns (`<col>__pred_value`, `__pred_confidence`, `__pred_source`) never
reach an `Annotation`: the reader folds them into the prediction overlay, so there is no carried
`sourceType` to echo. Their types are protspace's own schema, fixed by `protspace transfer`
(`float32` confidence, string value and source), and the exporter writes those.

### Persist before render

On `main`, a user import is written to OPFS, bytes and metadata, before the render, so a tab that
dies while rendering a 145 MB bundle comes back with a recovery banner that can offer the file
again (`apps/web/src/explore/persisted-dataset.ts`). The PR moved the byte copy after the first
paint to shorten time to first render. A crash during the render then left a pending record of the
import with no complete bytes behind it. The deferred `persistBytes` promise also stays in flight
across the whole render, and only the load queue's serialisation keeps it from racing the next
import. Recovery is worth more than the time saved, so `main`'s ordering comes back and the rest of
the PR's `dataset-controller.ts` changes stay.

### Two version keys: container and cell grammar

Before this change one key, `protspace_format_version`, meant two things. In a v3 part 1, `"3"`
was the container version. On a legacy part and on every v2-shaped table Python handles, `"2"` was
the annotation cell grammar (percent-encoded cells), and a missing key meant v1, which the
encoder answered by migrating the table. `rename_columns` drops schema metadata, so an already-v2
table that lost its stamp read as v1 and was migrated a second time, escaping every reserved
character twice (`%3B` to `%253B`) with no way back. Only a warning guarded it. v3 is unreleased,
so its wire format can still change, and the two meanings get two keys:

- **`protspace_container_version`** is in part 1's footer of a v3 bundle and nowhere else. Its
  presence is what makes a file v3. Both readers detect v3 from it, and the part count has to
  agree in both directions: six parts without it, a value other than `3`, or three to five parts
  with it is rejected. `decodeParquetBundle` still reports one `formatVersion`: `3` from this key,
  or `1`/`2` from the grammar key for a legacy file, which is what the legacy notice shows.
- **`protspace_format_version`** is only the cell grammar: `2`, or absent for v1, on a legacy part
  1 and on every v2-shaped table (the pipeline's parquets, and the tables a v3 read hands back).
  Legacy detection is unchanged.
- **A v3 footer does not also carry the grammar key.** Its labels are stored decoded in the
  payload part, so there are no cells whose grammar it could describe, and no reader needs it. A
  second key saying `2` next to a container key saying `3` would reintroduce the ambiguity this
  split removes. The encoder strips it (and any stale container key or manifest) from the table's
  metadata, and `decode_v3` drops the container key from the tables it returns and stamps them
  grammar `2`. The web writer never had cells: it encodes already-decoded labels.
- **The grammar is never guessed on write.** `encode_v3`, and with it `write_bundle` and
  `replace_annotations_in_bundle`, refuses an annotations table that is not stamped grammar `2`,
  instead of reading a missing stamp as v1. The callers that hold v1 cells migrate them explicitly:
  `convert` from the legacy part's own stamp, `transfer` from the version it read off the bundle
  before its renames dropped the stamp (`upgrade_cell_grammar(table, version)`), and
  `bundle -a`, which reads the input's stamp before its `identifier` rename. `annotate` stamps its
  output v2, and so does the annotation cache `prepare` keeps (`tmp/all_annotations.parquet`,
  whose cells the emit sites percent-encode), so pipeline output passes through. A cache written
  before it carried the stamp is recognised by the cache-version attribute in its pandas footer,
  which only ever marked v2 cells, and read as v2 too; `ArrowReader.save_data` writes the stamp it
  read. Any other unstamped table given to `bundle -a` is user input, a table written by hand, and
  the CLI treats it as legacy v1 plain text and migrates it, so a literal `%` or a `;` inside
  parentheses keeps the meaning the user gave it.
  `replace_annotations_in_bundle` used to stamp every table v2, which was the opposite guess and
  would have mislabelled v1 cells; it stamps nothing now. The warning and the prose that guarded
  the old guess are gone.

The alternative, keeping one key and distinguishing by context (six parts means the key is a
container version), is what the PR shipped. It worked for reading, but it left the encoder with no
way to tell a v1 table from a v2 table that lost its stamp, and that is where the data loss was.

### Public decode API

`decodeParquetBundle(arrayBuffer)` is the single entry point that sniffs the version and returns
`{ data, settings }` for any bundle. It is exported from `@protspace/core`, and the embedding and API
docs use it. `extractRowsFromParquetBundle` returns v1/v2 row objects, and on a v3 file there are no
such rows to return. It stays exported for existing callers, documented as v1/v2-only and
deprecated alongside legacy read support.

## Risks / Trade-offs

- **Version skew.** A v3 file exported from protspace.app does not open in an older self-hosted web
  build, which reports `Expected 2 to 4 delimiters in parquetbundle, found 5`. → The data-format
  guide names the error as a version-skew signal. Older Python reads fail the same way. Users on an
  old build can upgrade.
- **Converted shipped datasets.** The default dataset and the examples are rewritten as v3, which
  adds their new blobs to the git history (about 69 MB, 36 MB of it the 573K Swiss-Prot bundle;
  the working tree shrinks from 86.7 to 69.4 MB). → Each was checked to decode in the browser to
  the same dataset as its legacy original. The conversion also found a migration bug: a v1 hit
  with a `|` inside its label was split at its first pipe, not at the last one as the browser
  reads it; `encode_legacy_cell` now splits at the last pipe. The legacy reader keeps its own test
  data: the v1 e2e fixtures and the `v2-sample` unit fixture stay legacy until 5.0.0.
- **Legacy coverage.** The contract suite generates bundles with the real CLI, which now writes only
  v3, so the legacy reader loses its cross-language check. → The committed `v2-sample` fixture and
  the Python legacy tests keep it covered in each language until removal.
- **Culling changes counts for data that used to sit at (0,0).** A bundle whose projections do not
  cover every annotated protein now shows fewer points than before. That is the fix, but it is
  visible. → The data-format guide says so.
- **Finiteness pass.** One pass over `N × dimension` floats per plot-data build. That is small next
  to the build itself, and it only allocates when something is actually missing.

## Migration Plan

1. Land the Python track and the TypeScript track on the PR branch, each with its own tests; the
   contract suite runs against both.
2. Release as a minor from the merged PR. Do not squash-merge it (it touches `apps/protspace/`).
3. Convert the served bundles (default and example datasets) to v3 in this change; the legacy e2e
   and unit fixtures stay v1/v2 until 5.0.0 removes the reader they test.
4. In 5.0.0, remove the legacy readers, `extractRowsFromParquetBundle` and the notice, and make
   `protspace convert` point to the last 4.x release for anyone still holding v1/v2 files.

Rollback is a revert of the merge. Files written as v3 in the meantime then need a 4.x build that
reads v3, which is why the reader lands in the same release as the writer.

## Open Questions

None. `protspace style` on a legacy bundle, the one open question of the first version, is settled
above: it writes v3.
