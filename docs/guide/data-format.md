# Data Format Reference

ProtSpace uses `.parquetbundle` files - a single file containing all visualization data. This page explains the structure for users who want to understand the file format.

## What is a .parquetbundle?

A `.parquetbundle` is a single file that concatenates several Parquet files, separated by the
byte string `---PARQUET_DELIMITER---`. It keeps everything in one convenient file while still
loading efficiently in the browser.

There are two container layouts. Which one a file uses is recorded in the Parquet key-value
metadata of its first part, under `protspace_format_version` (see
[Version detection](#version-detection)):

| Layout                    | Parts    | Written by                                                                                                           |
| ------------------------- | -------- | -------------------------------------------------------------------------------------------------------------------- |
| Legacy (format v1 and v2) | 3 to 5   | every export from the web app; `protspace style`, which keeps the layout of the bundle it was handed; older releases |
| Columnar (format v3)      | always 6 | `protspace prepare`, `protspace bundle`, `protspace transfer`                                                        |

Both layouts carry the same data. v3 re-encodes the container, not the dataset: the Python API
decodes a v3 file back into the same three tables, in the same cell grammar, that a legacy file
stores directly. Cells come back in their canonical spelling rather than byte for byte, and the
deliberate differences are listed under
[What a v3 round trip does not preserve](#what-a-v3-round-trip-does-not-preserve). See
[Format v3 Physical Schema](#format-v3-physical-schema).

### Legacy layout (3 to 5 parts)

```
.parquetbundle file
├── selected_annotations.parquet  # Protein metadata and annotations
├── ---PARQUET_DELIMITER---       # Separator
├── projections_metadata.parquet  # Projection method information
├── ---PARQUET_DELIMITER---       # Separator
├── projections_data.parquet      # 2D/3D coordinates
├── ---PARQUET_DELIMITER---       # Present when a 4th part follows
├── settings.parquet              # Optional: one-row Parquet table with settings_json
├── ---PARQUET_DELIMITER---       # Present when a 5th part follows
└── statistics.parquet            # Optional: projection quality metrics (protspace stats)
```

Part positions are fixed, not counted. Once a statistics part is present, the settings separator
and the settings slot are mandatory, even when there are no settings to store: the slot is then
written as zero bytes so statistics stay at position five.

### Format v3 layout (always 6 parts)

```
.parquetbundle file (format v3)
├── selected_annotations.parquet  # Integer codes, per-row hit counts, float64 numerics
├── ---PARQUET_DELIMITER---       # Separator
├── projections_metadata.parquet  # Unchanged from the legacy layout
├── ---PARQUET_DELIMITER---       # Separator
├── projections_data.parquet      # Wide float32 columns, one row per protein
├── ---PARQUET_DELIMITER---       # Separator
├── settings.parquet              # Zero bytes when there are no settings
├── ---PARQUET_DELIMITER---       # Separator
├── statistics.parquet            # Zero bytes when there are no statistics
├── ---PARQUET_DELIMITER---       # Separator
└── payloads.parquet              # Required: label dictionaries and CSR buffers
```

All six slots are always emitted, and parts 4 and 5 are written as zero bytes when the bundle
carries no settings or no statistics. Part 6 is required and never empty. The slots are
positional rather than counted because the browser reads the payloads from a fixed index: an
omitted settings or statistics slot would file the payloads where statistics are expected, and
the reader would report a bundle with no payloads part.

This bundled format allows efficient loading in the browser while keeping everything in one convenient file.

The optional settings section is stored as `settings.parquet`, a one-row Parquet table with a `settings_json` column. It stores legend customizations (colors, shapes, ordering, visibility, palette, numeric binning settings) and export options (image dimensions, legend sizing) per annotation. When present, these settings are applied automatically on load so the visualization renders exactly as it was exported.

## Tables

These are the logical tables every bundle carries. A legacy container stores them exactly as
described here. A v3 container stores an equivalent columnar encoding and decodes back to these
same tables on every Python read, so the shapes below are what a Python consumer always sees.

### 1. Annotations Table

Contains metadata and biological annotations for each protein.

| Column       | Type          | Description                                                        |
| ------------ | ------------- | ------------------------------------------------------------------ |
| `identifier` | string        | Protein ID (e.g., P12345); named `protein_id` in Python CLI output |
| _others_     | string/number | Any biological annotations                                         |

The columns `gene_name`, `protein_name`, and `uniprot_kb_id` are **tooltip-only**, shown on hover but excluded from the annotation dropdown.

### 2. Projections Metadata

| Column            | Type    | Description                    |
| ----------------- | ------- | ------------------------------ |
| `projection_name` | string  | Method name (e.g., `PCA_2`)    |
| `dimensions`      | integer | 2 or 3                         |
| `info_json`       | json    | Method parameters and settings |

### 3. Projections Data

| Column            | Type   | Description                 |
| ----------------- | ------ | --------------------------- |
| `projection_name` | string | Method name (e.g., `PCA_2`) |
| `identifier`      | string | Protein ID                  |
| `x`               | float  | X coordinate                |
| `y`               | float  | Y coordinate                |
| `z`               | float  | Z coordinate (null for 2D)  |

### Statistics (Optional, 5th Part)

The optional fifth part, `statistics.parquet`, holds projection quality metrics. It is a tidy
long-format table, one row per space, annotation, label kind, metric and category:

| Column        | Type   | Description                                                                    |
| ------------- | ------ | ------------------------------------------------------------------------------ |
| `space_kind`  | string | `embedding` or `projection`                                                    |
| `space_name`  | string | Which embedding or projection was scored                                       |
| `annotation`  | string | Annotation column the metric was computed against                              |
| `stat_family` | string | One of `annotation_validity`, `cluster_validity`, `cluster_agreement`          |
| `label_kind`  | string | One of `annotation`, `kmeans_elbow`, `kmeans_silhouette`                       |
| `metric`      | string | Metric name (e.g. silhouette, Davies-Bouldin, ARI)                             |
| `metric_kind` | string | One of `validity`, `meta`, `agreement`                                         |
| `value`       | float  | Metric value                                                                   |
| `category`    | string | The category this metric was decomposed for; NULL (not `""`) on aggregate rows |
| `extra_json`  | string | Extra per-row detail as JSON                                                   |

A reader must find the eight required columns `space_kind`, `space_name`, `annotation`,
`stat_family`, `label_kind`, `metric`, `metric_kind` and `value`. `category` and `extra_json` are
optional, so bundles written before either column existed still load, and so do bundles from a newer
producer that adds columns this app does not model.

`annotation` can also name an auto-generated `cluster_elbow_*` / `cluster_silhouette_*` column
rather than a column you prepared, which is why `label_kind == 'annotation'` is the filter for rows
scored on a curated annotation.

Two CLI paths produce it:

```bash
# During the full pipeline
protspace prepare -i embeddings.h5 -m pca2,umap2 --stats -o output

# Standalone, against an existing project directory
protspace stats -i embeddings.h5 -p project_dir -o statistics.parquet
```

::: info What the web app does with the statistics part
The loader parses it and the app renders it: separation-score strips above the legend, the
Separation section of the projection metadata panel, per-category values in the strip tooltips, and
a `STATS` badge on the annotations that carry scores. See
[Separation Scores](/explore/separation-scores). The table is of course also readable with the
Python CLI or any Parquet reader.

The faithfulness metrics do not depend on it: they travel in the projection metadata
(`info_json.quality`) and render for both four- and five-part bundles.
:::

## Annotation Types

ProtSpace distinguishes three practical annotation shapes:

- **Categorical**: plain text values such as taxonomy or family. These get discrete legend entries.
- **Numeric**: scalar numeric values such as `length`. These stay numeric in the file and are binned in the browser at runtime.
- **Multi-Label**: semicolon-separated values such as `EC:1.1.1;EC:2.1.1`. These are displayed as pie charts.

### Numeric Annotations

Detection is all-or-nothing and content-based. ProtSpace scans the column, skips missing values,
and tries to parse each remaining value as a plain finite number. The **first** non-missing value
that fails to parse makes the whole column categorical. If every parsed value is an integer the
column is an integer column; if any value has a fractional part it is a float column. A column with
no numeric value at all stays categorical.

A value fails to parse, and therefore forces the column categorical, when it is:

- anything containing `;`, such as semicolon-separated multi-value fields
- anything containing `|`, such as pipe-coded score or evidence fields (`PF00001|1.5e-10`)
- any other text that is not a plain finite number

Empty and whitespace-only cells are normalized to missing before this check runs, so they never
force a column categorical: a column of numbers with blank cells stays numeric, and the blanks
become the N/A legend entry.

There is no density, cardinality, or sparsity heuristic.

In a v3 bundle the scan runs once, at write time, and the answer is recorded in the manifest, so
the browser never re-scans the column. The write-time test differs from the browser's in two
small ways:

- a column that is already numeric in Arrow stays numeric whatever it holds, including a column
  with no values left at all, where the browser would fall back to categorical
- only decimal literals count as numbers. JavaScript also reads `0x10`, `0o17` and `0b1` as
  numbers, so a column of such literals is categorical in a v3 file and numeric on the legacy
  path. None of the shipped datasets contain one.

::: warning Identifier-style number columns become numeric
A column of cluster IDs or numeric codes stored as strings (`"1"`, `"2"`, `"17"`) parses cleanly as
numbers, so it **is** treated as numeric and binned with a gradient, even if it is sparse and you
meant it as a label. To keep such a column categorical, give every value a non-numeric form before
bundling, for example `cluster_1` / `cluster_2` instead of `1` / `2`.
:::

For numeric annotations:

- the selected distribution can be `linear`, `quantile`, or `logarithmic`
- numeric palettes are sequential gradients, not categorical swatches
- the gradient direction can also be reversed and is persisted as part of the numeric settings
- unsupported numeric palette IDs are normalized to `batlow` on import/load

### Numeric Edge Cases

Numeric binning is data-driven, so the realized number of bins can be lower than `Max legend items`.

Examples:

- Linear or logarithmic intervals can be empty and therefore disappear from the legend.
- Quantile cut points can collapse when many proteins share the same value.
- Constant numeric columns produce a single bin.
- All-null numeric columns produce zero numeric bins and a single N/A entry covering every protein.
- Very narrow decimal ranges can require extra precision in the displayed labels.

Numeric legend labels are summaries of the observed values in each realized bin. They are meant for readability, not as the exact bin-membership rule.

### Missing Values

The following are recognized as missing values and collapse into a single
canonical "N/A" legend category:

- JS `null` / `undefined`
- Empty or whitespace-only strings (`""`, `"   "`)
- Non-finite numbers (`NaN`, `Infinity`, `-Infinity`)
- These string spellings (case-insensitive, trimmed): `"NA"`, `"N/A"`, `"NaN"`,
  `"null"`, `"None"`, `"__NA__"`

`__NA__` is a **reserved** spelling, not just another synonym: it is the token ProtSpace uses
in memory for a missing cell, and the exporter drops it unconditionally. A genuine category
literally named `__NA__` therefore collapses into N/A on load. Give such a category a different
name before bundling.

How missing values are stored: on export a missing categorical cell is written as a Parquet NULL,
not as a sentinel string. Bundles from older web builds may still hold literal `__NA__` cells;
those normalize to N/A on load, as above.

A v3 bundle stores a missing cell as code `-1`, a hit count of `0`, or `NaN`, depending on the
column. It never rewrites the spellings above into a missing value: they stay in the file as
ordinary labels and the reader folds them into N/A, exactly as it does for a legacy bundle. See
[Missing values in a v3 file](#missing-values-in-a-v3-file).

The single "N/A" legend row covers every missing-value protein. Its default
color is light grey (`#DDDDDD`) and circle shape, matching every other
category in the system. For categorical annotations the color and shape are
user-overridable through the legend customizer; for numeric annotations they
are locked.

For numeric annotations, the gradient is preserved when missing values are
present, and one bin slot is reserved for N/A (e.g., requesting 10 bins
yields 9 numeric bins + 1 N/A).

### Scored Annotations

Annotation values can include a numeric score after a pipe character:

- Single score: `PF00001|1.5e-10`
- Multiple scores: `PF00001|1.5e-10,2.3e-5`

Scores are displayed in the protein tooltip when hovering over a point. This is commonly used for InterPro domain E-values.

### Evidence-Coded Annotations

Annotation values can include an [ECO evidence code](https://www.evidenceontology.org/) after a pipe character:

- `Cytoplasm|EXP` (experimental evidence)
- `apoptotic process|IDA` (inferred from direct assay)

Evidence codes are recognized by pattern: any 2–5 uppercase letter code (e.g., `EXP`, `IDA`, `IPI`, `IGI`, `IEP`, `COMB`) or raw ECO identifiers (e.g., `ECO:0000269`). This covers all standard [GO evidence codes](http://geneontology.org/docs/guide-go-evidence-codes/) and ECO ontology IDs.

Evidence codes are displayed in the protein tooltip alongside the annotation value.

### Cell Grammar and Encoding (Format v2) {#encoding-format-v2}

This section describes the **logical** cell grammar: the string spelling of an annotation value,
with its `;` separated values and its `|` suffixed scores and evidence codes. It is what a legacy
bundle stores on disk, and it is also what every Python consumer sees, because a v3 bundle
decodes back into exactly this grammar on every read. Only the physical storage differs, and only
inside a v3 container.

As of bundle format v2, annotation values containing special characters use percent-encoding to ensure reliable parsing while keeping `,` `(` `)` human-readable inside names and labels.

**Encoding rules:**

- Reserved characters (`%`, `;`, `|`, and control characters 0x00–0x1F and 0x7F) are percent-encoded as `%XX` (uppercase hex)
  - `%` → `%25`
  - `;` (field separator) → `%3B`
  - `|` (score/evidence separator) → `%7C`
  - control chars (including newline, tab) → `%0A`, `%09`, etc.
- Literal characters `,` (score separator in suffix; literal in names), `(`, and `)` stay unencoded for readability

**Example:**

For a hypothetical protein with a CATH domain whose name contains a semicolon ("Superfamily; old"), a Pfam family with a comma in the name ("Kinase, serine"), and InterPro matches, a bundle v2 annotation might encode as:

```
1.10.490.10 (Superfamily%3B old)|300;PF00001 (Kinase, serine)|425.5
```

When displayed in ProtSpace, the decoded names render as "Superfamily; old" and "Kinase, serine", with the percent-encoding transparent to the user.

**Numeric column typing:**

- A numeric Parquet type does **not** by itself make a column numeric. Numeric-ness is decided by the content scan described in [Numeric Annotations](#numeric-annotations); the declared type is consulted in only two cases, to upgrade an already-numeric column's type to `int`, and to rescue a column whose every row is missing. A column with any real value stays categorical whatever the schema says.
- Only an _integer_ physical type (`INT32`/`INT64`) is authoritative for the int/float distinction: bundles written before this writer stored **every** numeric column as `DOUBLE`, so `FLOAT`/`DOUBLE` carries no int/float information and the reader lets value inference decide there, since trusting it would re-label those bundles' integer annotations (legend labels `10 - 25` → `10.0 - 25.0`)
- Only an _unannotated_ physical type counts. A logical or converted type means the physical type is a carrier rather than the identity (pyarrow stores an all-null column as `INT32` + logical `NULL`, and `DECIMAL` rides on `INT32`/`INT64`), so those fall back to inference too
- This matters for a column whose rows are all missing, for example an isolation-mode or query-filtered export. Such a column has no values left to infer from and would otherwise reload as a categorical column with a single N/A category
- Bundles that store annotations as text (the `protspace` CLI writes its annotation frame stringified) carry no such type, and fall back to inferring numeric-ness from the values as before
- All of this applies to legacy bundles only. In a v3 bundle the manifest declares each column's kind and `numericType`, and the physical Parquet types are deliberately not consulted, because every dictionary-code column there is an `INT32`

**Known formatting:**

- Unnamed CATH superfamilies from TED domains display the bare code without a decoding step (see [tsenoner/protspace-legacy#57](https://github.com/tsenoner/protspace-legacy/issues/57))

## Version Detection

- A bundle's format version lives in the Parquet key-value metadata of the `selected_annotations`
  part, under the key `protspace_format_version`, and is read from that part's footer before any
  row is decoded.
- `"2"` selects the percent-decoding cell parser described above, `"3"` selects the columnar
  reader. A v1 bundle has no version key and renders with the legacy parser, which does not
  decode percent-encoded sequences. Existing v1 and v2 bundles therefore keep loading unchanged.
- Python cross-checks the two signals: a six-part file whose first part does not say `3` is
  rejected rather than guessed at, and a three to five part file is always read as legacy.
- That cross-check runs in one direction only, which is a known limitation. Only a six-part file
  has its version key consulted; a five-part file whose key says `3` is read as legacy without
  complaint, and its part 1 comes back exactly as stored, `INT32` dictionary codes and
  `<col>__count` columns with no payloads part to resolve them against. Nothing ProtSpace writes
  produces such a file, because every v3 write emits six parts, but a truncated or hand-assembled
  one fails quietly instead of loudly.
- The key versions the **container**, not the cell grammar. The grammar is still v2, which is why
  `BUNDLE_FORMAT_VERSION` on the Python side stays `2` and why the tables handed back from a v3
  read are re-stamped `protspace_format_version=2`: what they contain is v2 cells.
- A web build older than v3 support rejects a v3 file with
  `Expected 2 to 4 delimiters in parquetbundle, found 5`. That is a version-skew signal, not a
  corrupt file.

## Format v3 Physical Schema

Format v3 changes how the three logical tables are physically stored so that the browser can
build its typed arrays without parsing a single annotation cell. On the 573K SwissProt dataset
that takes bundle decoding from about 6.5 s and 2.1 GB of heap to about 0.4 s and under 50 MB,
in a file about 19% smaller than the v2 encoding of the same data. The module docstring in
`bundle_v3.py` quotes 21% for the same bundle. The two numbers measure different builds, not the
same one twice: 21% is what settled the counts-versus-offsets choice described below, measured
while scores were still float32, and 19% is the same comparison after scores widened to float64.

Nothing above the container boundary changes. `read_tables()` decodes a v3 file back into the
v2-shaped tables, so `protspace serve`, `protspace style`, `protspace transfer` and every script
keep their string-cell logic.

### Part 1: annotations

One row per protein, the identifier column first and then the annotation columns in their
original order. The manifest says how to read each one:

| Manifest kind | Part 1 column                | Physical type | Holds                                              | Missing        |
| ------------- | ---------------------------- | ------------- | -------------------------------------------------- | -------------- |
| (identifier)  | `protein_id` or `identifier` | `BYTE_ARRAY`  | the protein ID; null and duplicate IDs are refused | not allowed    |
| `categorical` | `<col>`                      | `INT32`       | a code into `dict:<col>`                           | `-1`           |
| `multi`       | `<col>__count`               | `INT32`       | how many hits this row owns in `csr:<col>`         | a count of `0` |
| `numeric`     | `<col>`                      | `DOUBLE`      | the value                                          | `NaN`          |

A column is `multi` when any row holds more than one value, or when any value carries a score or
an evidence code. Part 1 then stores only the per-row hit counts; the hits themselves live in
part 6. The EAT companion columns (`<col>__pred_value`, `<col>__pred_confidence`,
`<col>__pred_source`) follow the same rules by kind.

Part 2, the projections metadata, is unchanged from the legacy layout.

### Part 3: projections

One row per protein, aligned position by position with part 1, and one `FLOAT` column per axis:
`<name>__x`, `<name>__y`, and `<name>__z` for a 3D projection. A protein with no coordinates in a
projection is stored at `0.0`, which is where the legacy reader placed it too.

The projection name sets in parts 2 and 3 must be identical; the encoder refuses a bundle where
either one names a projection the other does not, because the browser derives the projection set
from the data rows alone.

### Part 6: payloads

A two-column table, `name` (string) and `data` (binary), one row per payload. Every payload is a
raw little-endian buffer:

| Payload                                  | Element    | One per | Contents                                                      |
| ---------------------------------------- | ---------- | ------- | ------------------------------------------------------------- |
| `dict:<col>`                             | utf8 bytes | blob    | every label of `<col>` concatenated, in code order            |
| `dict:<col>:len`                         | int32      | label   | that label's length in bytes                                  |
| `csr:<col>`                              | int32      | hit     | the label code of each hit, rows in row order                 |
| `score_count:<col>`                      | int32      | hit     | how many score values that hit owns                           |
| `scores:<col>`                           | float64    | score   | the score values, in hit order                                |
| `evidence:<col>`                         | int32      | hit     | index into `dict:__evidence`, `-1` for a hit with no evidence |
| `dict:__evidence`, `dict:__evidence:len` | as above   |         | the single evidence dictionary every column indexes into      |

Row `i` of a `multi` column owns the codes at `[start, start + count)`, where `start` is the sum
of the counts of every row before it.

Labels are stored **decoded**: the percent-encoding is removed before the dictionary is written,
and applied again when Python decodes the bundle. Codes run in descending order of how many hits
carry the label, ties broken by first occurrence, so code `0` is the column's most frequent label
and the palette lands on the same categories it did in v2.

### Counts, never offsets

Every length family in v3 is a per-element **count**, never a cumulative offset: `<col>__count`
counts a row's hits, `score_count:<col>` counts a hit's score values, `dict:<col>:len` counts a
label's bytes. The reader prefix-sums them into offsets in a single pass.

That is a size decision. Offsets are near incompressible (snappy manages about 0.4% of them on
the 573K SwissProt bundle) while their first differences, which is what the counts are, compress
about 8x. On that bundle the difference is roughly 16 MB, about 10.0 MB of it in part 1 and
about 5.7 MB in part 6.

### Required, PLAIN, one row group

Every column of parts 1, 3 and 6 is written non-nullable, PLAIN encoded, with dictionary encoding
disabled, in a single row group, snappy compressed.

For parts 1 and 3 that is load bearing, not stylistic. The browser's Parquet reader hands back a
zero-copy typed array only for a REQUIRED flat PLAIN column, and each such chunk then lands in
its preallocated column with a single `set`. A column written nullable or dictionary-encoded
still decodes to the right values, but it arrives as a plain JavaScript array about 4x slower,
and the reader logs a warning naming it. Parts 1 and 3 are read by separate passes that carry one
warning each, so a single read logs at most two. Such a column is a writer bug, not a variant.

Part 6 is read differently and is not zero-copy at all. It is a handful of large blobs rather
than hundreds of per-row columns, so the reader loads the whole part at once and copies each
payload out of the decoded page before wrapping it as a typed array. At that granularity the copy
costs almost nothing, and it is what guarantees alignment: the payload arrives as a view at an
arbitrary byte offset, which a `Float64Array` cannot wrap.

### The manifest

Part 1's footer carries the two key-value entries that describe the format:
`protspace_format_version`, which is `"3"`, and `protspace_v3_manifest`, a JSON object that is
the only description of what the integer columns mean.

```json
{
  "idColumn": "protein_id",
  "columns": {
    "family": { "kind": "multi", "scores": true, "sourceType": "string" },
    "length": { "kind": "numeric", "numericType": "int", "sourceType": "int32" }
  },
  "projections": [{ "name": "UMAP_2", "dimension": 2 }]
}
```

| Field                   | Meaning                                                                        |
| ----------------------- | ------------------------------------------------------------------------------ |
| `idColumn`              | which part 1 column holds the protein IDs                                      |
| `columns.*.kind`        | `categorical`, `multi` or `numeric`                                            |
| `columns.*.numericType` | `int` or `float`; numeric columns only                                         |
| `columns.*.scores`      | present and `true` when a `scores:<col>` payload exists; multi columns only    |
| `columns.*.evidence`    | present and `true` when an `evidence:<col>` payload exists; multi columns only |
| `columns.*.sourceType`  | Python-private, see below                                                      |
| `projections`           | `{ name, dimension }` per projection, in part 3 column order                   |

The browser validates the manifest against part 1's own schema before reading anything. An
unknown kind, a declared column part 1 does not have, a kind whose physical type disagrees (a
code column declared numeric, for instance), a duplicate projection name, or a dimension that is
not 2 or 3 all throw rather than being repaired.

`sourceType` is Python-private and the browser ignores it. It records the Arrow type the column
had before encoding, so the decoder can restore it instead of handing back a string column.

Only a numeric source type is ever restored, and only on a numeric column. The decoder declines
everything else and falls back to the per-kind default:

- a type whose alias cannot be parsed back at all, such as a dictionary, list or decimal column,
  is recorded as `"?"`
- a type whose alias parses but is not an integer or a float is recorded verbatim and declined
  anyway. A `bool` column records `sourceType` `"bool"` and a timestamp column records
  `"timestamp[s]"`; neither is restored, and both come back as v2 string cells
- `"string"` and `"large_string"` are declined by design, because the v2 spelling of the column is
  what the encoder consumed, so rendering it back is the restoration

`sourceType` is also consulted only when decoding a `numeric` column, so on a `categorical` or
`multi` column it is recorded but completely inert.

### Scores are float64

`scores:<col>` is the one wide payload in an otherwise narrow format. float32 cannot carry an
E-value, which is the canonical Pfam and InterPro score: `1e-200` flushes to zero and `1e40`
overflows to infinity, and infinity is not a valid v2 cell, so a second round trip would
reclassify the hit as a plain label. On the 573K SwissProt bundle the float64 scores cost about
940 KB.

### Missing values in a v3 file {#missing-values-in-a-v3-file}

Only a null cell and an empty cell (after trimming whitespace) are missing in v3. The spellings
listed under [Missing Values](#missing-values), `none`, `NA`, `n/a`, `nan`, `null` and `__NA__`,
are kept in the file as ordinary labels, and the browser folds them into its N/A category at read
time, on v3 exactly as it always has on v2.

The reason is that v3 is a container encoding and must hand back the label it was given.
Collapsing these spellings in the file broke `protspace style` on the shipped phosphatase
dataset, where 1383 of 1587 rows of `predicted_transmembrane` are literally the word `none`: the
style command raised, and a 1383-protein legend entry came back blank. Folding them stays a
display decision, made by the reader.

Those spellings are consulted at write time in one place only, to decide whether a column is
numeric, so a column of `NA` stays categorical instead of becoming an all-`NaN` numeric column.

### What a v3 round trip does not preserve

A v3 file stores what the reader would have parsed out of the v2 cells, not the cells themselves,
so decoding a v3 bundle returns the canonical spelling of each cell rather than the original
bytes. The differences are deliberate:

| Written                               | Read back          | Why                                                                                                                             |
| ------------------------------------- | ------------------ | ------------------------------------------------------------------------------------------------------------------------------- |
| `PF00001\|62.0`                       | `PF00001\|62`      | scores are re-spelled by Python's float repr, the shortest spelling that reads back as the same double, minus the trailing `.0` |
| `PF00001\|0.5700`                     | `PF00001\|0.57`    | same rule                                                                                                                       |
| `PF00001\|2.3e-5`                     | `PF00001\|2.3e-05` | same rule; Python's repr is not JavaScript's, and it pads a single-digit exponent to two digits                                 |
| `PF00001\|1e16`                       | `PF00001\|1e+16`   | same rule; Python switches to exponential notation at 1e16, JavaScript not until 1e21                                           |
| ` A \|IDA`                            | `A\|IDA`           | cells and hits are whitespace-trimmed                                                                                           |
| `A;;B`                                | `A;B`              | empty hits are dropped                                                                                                          |
| `%3b`                                 | `%3B`              | labels are re-encoded canonically, in uppercase hex                                                                             |
| a missing cell                        | `""`               | null and blank both mean missing                                                                                                |
| `100.0` where every value is integral | `100`              | the canonical v2 spelling of an integral value                                                                                  |

The `2.3e-5` and `1e16` rows land squarely in the E-value range the float64 scores exist for, so
they are worth knowing about, but they are cosmetic rather than corrupting: both spellings
re-parse to the same double, and a second round trip re-emits the same text.

A cell spelled `none`, `NA` or `null` is an ordinary label and comes back unchanged. Projection
coordinates come back as float32 with `z` null for a 2D projection, and the identifier column
comes back first whatever position it held before.

## Creating Files

Use the [Google Colab notebook](/guide/data-preparation) or [Python CLI](/guide/python-cli) to generate `.parquetbundle` files.

## Export And Import Notes

Numeric annotations round-trip differently from categorical annotations:

- the bundle stores the raw numeric column, not precomputed bin labels
- the exported settings remember the numeric palette, gradient direction, target bin count, distribution, hidden bins, and compatible manual order
- when a bundle is imported again, ProtSpace rebuilds the numeric bins from the raw values and the saved numeric settings

If the saved numeric topology no longer matches the realized one, incompatible numeric hidden/manual state is dropped instead of being applied to the wrong bins.

What else an export from the web app does:

- an integral numeric column is written as `INT32` (`INT64` when a value is out of `INT32` range) and a fractional one as `DOUBLE`. Older exports widened every numeric column to `DOUBLE`, which is why a value could read back as `100.0` where it now reads back as `100`.
- a statistics part read from the source bundle is re-emitted byte for byte, including columns this app version does not model.
- a bundle that carries statistics but no settings has five parts, with a zero-byte settings slot at position four.
- a subset export (isolation, or an active filter) drops the statistics part, because whole-dataset scores would misdescribe a slice.
- the export fails with an error, rather than writing a corrupt file, if any annotation value or category name contains the literal `---PARQUET_DELIMITER---`. The delimiter is in-band and unescaped, so such a value would split one part into two on read-back.
