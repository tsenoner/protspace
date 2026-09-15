# Data Format Reference

ProtSpace uses `.parquetbundle` files - a single file containing all visualization data. This page explains the structure for users who want to understand the file format.

## What is a .parquetbundle?

A `.parquetbundle` is a single file containing three core Parquet tables bundled together, with optional settings and statistics sections:

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

This bundled format allows efficient loading in the browser while keeping everything in one convenient file.

The optional settings section is stored as `settings.parquet`, a one-row Parquet table with a `settings_json` column. It stores legend customizations (colors, shapes, ordering, visibility, palette, numeric binning settings) and export options (image dimensions, legend sizing) per annotation. When present, these settings are applied automatically on load so the visualization renders exactly as it was exported.

## Tables

### 1. Annotations Table

Contains metadata and biological annotations for each protein.

| Column       | Type          | Description                |
| ------------ | ------------- | -------------------------- |
| `identifier` | string        | Protein ID (e.g., P12345)  |
| _others_     | string/number | Any biological annotations |

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

### Encoding (Format v2)

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

**Version detection:**

- A bundle's annotation format version is stored in the parquet key-value metadata of the `selected_annotations` table under the key `protspace_format_version`
- Format version 2 is detected by reading this metadata via hyparquet's `parquetMetadata` (returns `"2"` as a string)
- v1 bundles (no version key present, or version < 2) render using the legacy parser, which does not decode percent-encoded sequences
- This ensures backward compatibility: existing v1 bundles load unchanged without requiring special-case handling

**Numeric column typing:**

- A numeric Parquet type does **not** by itself make a column numeric. Numeric-ness is decided by the content scan described in [Numeric Annotations](#numeric-annotations); the declared type is consulted in only two cases, to upgrade an already-numeric column's type to `int`, and to rescue a column whose every row is missing. A column with any real value stays categorical whatever the schema says.
- Only an _integer_ physical type (`INT32`/`INT64`) is authoritative for the int/float distinction: bundles written before this writer stored **every** numeric column as `DOUBLE`, so `FLOAT`/`DOUBLE` carries no int/float information and the reader lets value inference decide there, since trusting it would re-label those bundles' integer annotations (legend labels `10 - 25` → `10.0 - 25.0`)
- Only an _unannotated_ physical type counts. A logical or converted type means the physical type is a carrier rather than the identity (pyarrow stores an all-null column as `INT32` + logical `NULL`, and `DECIMAL` rides on `INT32`/`INT64`), so those fall back to inference too
- This matters for a column whose rows are all missing, for example an isolation-mode or query-filtered export. Such a column has no values left to infer from and would otherwise reload as a categorical column with a single N/A category
- Bundles that store annotations as text (the `protspace` CLI writes its annotation frame stringified) carry no such type, and fall back to inferring numeric-ness from the values as before

**Known formatting:**

- Unnamed CATH superfamilies from TED domains display the bare code without a decoding step (see [tsenoner/protspace-legacy#57](https://github.com/tsenoner/protspace-legacy/issues/57))

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
