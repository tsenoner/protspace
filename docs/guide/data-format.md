# Data Format Reference

ProtSpace uses `.parquetbundle` files - a single file containing all visualization data. This page explains the structure for users who want to understand the file format.

## What is a .parquetbundle?

A `.parquetbundle` is a single file containing three Parquet tables bundled together, with an optional settings section:

```
.parquetbundle file
├── selected_annotations.parquet  # Protein metadata and annotations
├── ---PARQUET_DELIMITER---       # Separator
├── projections_metadata.parquet  # Projection method information
├── ---PARQUET_DELIMITER---       # Separator
├── projections_data.parquet      # 2D/3D coordinates
├── ---PARQUET_DELIMITER---       # Optional separator
└── settings.parquet              # Optional: one-row Parquet table with settings_json
```

This bundled format allows efficient loading in the browser while keeping everything in one convenient file.

The optional settings section is stored as `settings.parquet`, a one-row Parquet table with a `settings_json` column. It stores legend customizations (colors, shapes, ordering, visibility, palette, numeric binning settings) and export options (image dimensions, legend sizing) per annotation. When present, these settings are applied automatically on load so the visualization renders exactly as it was exported.

## Tables

### 1. Annotations Table

Contains metadata and biological annotations for each protein.

| Column       | Type          | Description                |
| ------------ | ------------- | -------------------------- |
| `identifier` | string        | Protein ID (e.g., P12345)  |
| _others_     | string/number | Any biological annotations |

The columns `gene_name`, `protein_name`, and `uniprot_kb_id` are **tooltip-only** — shown on hover but excluded from the annotation dropdown.

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

## Annotation Types

ProtSpace distinguishes three practical annotation shapes:

- **Categorical**: plain text values such as taxonomy or family. These get discrete legend entries.
- **Numeric**: scalar numeric values such as `length`. These stay numeric in the file and are binned in the browser at runtime.
- **Multi-Label**: semicolon-separated values such as `EC:1.1.1;EC:2.1.1`. These are displayed as pie charts.

### Numeric Annotations

A column is treated as numeric when every non-empty value is a single finite scalar number. This
includes true numeric source values and dense or continuous numeric-looking strings. Sparse or
small integer-like string columns stay categorical by default so identifier-style code fields are
not silently reclassified.

Numeric detection does **not** apply to:

- sparse integer-like string labels such as cluster or code identifiers
- semicolon-separated multi-value fields
- pipe-coded score/evidence fields such as `PF00001|1.5e-10`
- mixed-format columns

For numeric annotations:

- raw numeric values are stored and exported as numbers
- legend bins are generated client-side from the raw values plus the saved numeric settings
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
- All-null numeric columns produce zero bins.
- Very narrow decimal ranges can require extra precision in the displayed labels.

Numeric legend labels are summaries of the observed values in each realized bin. They are meant for readability, not as the exact bin-membership rule.

### Missing Values

The following are recognized as missing values and collapse into a single
canonical "N/A" legend category:

- JS `null` / `undefined`
- Empty or whitespace-only strings (`""`, `"   "`)
- Non-finite numbers (`NaN`, `Infinity`, `-Infinity`)
- These string spellings (case-insensitive, trimmed): `"NA"`, `"N/A"`, `"NaN"`,
  `"null"`, `"None"`

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

- Reserved characters — `%`, `;`, `|`, and control characters (0x00–0x1F, 0x7F) — are percent-encoded as `%XX` (uppercase hex)
  - `%` → `%25`
  - `;` (field separator) → `%3B`
  - `|` (score/evidence separator) → `%7C`
  - control chars (including newline, tab) → `%0A`, `%09`, etc.
- Literal characters — `,` (score delimiter), `(`, `)` — stay unencoded for readability in names and labels

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

**Known formatting:**

- Unnamed CATH superfamilies from TED domains display the bare code without a decoding step (see [#57](https://github.com/tsenoner/protspace_web/issues/57))

## Creating Files

Use the [Google Colab notebook](/guide/data-preparation) or [Python CLI](/guide/python-cli) to generate `.parquetbundle` files.

## Export And Import Notes

Numeric annotations round-trip differently from categorical annotations:

- the bundle stores the raw numeric column, not precomputed bin labels
- the exported settings remember the numeric palette, gradient direction, target bin count, distribution, hidden bins, and compatible manual order
- when a bundle is imported again, ProtSpace rebuilds the numeric bins from the raw values and the saved numeric settings

If the saved numeric topology no longer matches the realized one, incompatible numeric hidden/manual state is dropped instead of being applied to the wrong bins.
