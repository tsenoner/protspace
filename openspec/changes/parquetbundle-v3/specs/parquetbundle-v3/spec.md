## ADDED Requirements

### Requirement: Every bundle ProtSpace writes SHALL be a format v3 container

A written bundle SHALL be a six-part container whose first part carries
`protspace_container_version` `"3"` and a `protspace_v3_manifest` in its Parquet key-value
metadata, with the physical layout documented in `docs/guide/data-format.md`. This applies to every bundle written by the Python
package (`prepare`, `bundle`, `transfer`, `style`, `convert` and any other command that writes a
bundle) and by the web app's bundle export.

#### Scenario: The Python pipeline writes a bundle

- **WHEN** `protspace bundle` writes a bundle
- **THEN** the file has six parts and part 1's footer declares container version `3` with a
  manifest

#### Scenario: The web app exports a bundle

- **WHEN** a user exports a loaded dataset as a `.parquetbundle` from the web app
- **THEN** the file has six parts, part 1's footer declares container version `3`, and
  `decodeParquetBundle` reads it back to the same protein IDs, projections, annotation values,
  settings and statistics that were exported

#### Scenario: A web export is read by Python

- **WHEN** a bundle exported from the web app is read with the Python package
- **THEN** it decodes without error and without a legacy-format warning

### Requirement: v1 and v2 bundles SHALL remain readable until protspace 5.0.0

The Python package and the browser SHALL keep reading format v1 and v2 bundles (three to five
parts), producing the same data they did before v3 existed except where this change sets a new
rule for missing coordinates. Support for reading them is deprecated and planned for removal in
protspace 5.0.0.

#### Scenario: A v1 bundle loads in the browser

- **WHEN** a three-part bundle with neither `protspace_container_version` nor
  `protspace_format_version` in part 1 is loaded
- **THEN** it renders with the legacy parser, and percent-encoded sequences are not decoded

#### Scenario: A v2 bundle is read in Python

- **WHEN** `read_tables` is called on a five-part v2 bundle
- **THEN** it returns the stored tables, settings and statistics as before

### Requirement: Reading a v1 or v2 bundle in Python SHALL log a deprecation warning

Every read of a v1 or v2 bundle through the Python package SHALL log exactly one warning that says
reading v1/v2 bundles is deprecated, that support will be removed in protspace 5.0.0, and that
`protspace convert` rewrites the file as v3. Reading a v3 bundle SHALL NOT log it.

#### Scenario: A legacy bundle is read twice

- **WHEN** a script reads the same v2 bundle twice in one process
- **THEN** the warning is logged twice, once per read, and each names `protspace convert` and
  `5.0.0`

#### Scenario: A v3 bundle is read

- **WHEN** a v3 bundle is read
- **THEN** no deprecation warning is logged

### Requirement: The web app SHALL show a non-blocking notice when a user loads a v1 or v2 bundle

When a user-provided bundle that is format v1 or v2 finishes loading, the web app SHALL show a
notice through its existing notification mechanism that says the file uses an older format whose
support will end in protspace 5.0.0, and that re-exporting it from the app or running
`protspace convert` upgrades it. The notice SHALL NOT block or delay rendering. Datasets the app
serves itself SHALL NOT trigger it.

#### Scenario: A user imports a v2 bundle

- **WHEN** a user imports a v2 bundle
- **THEN** the dataset renders and a dismissible notice names re-export and `protspace convert`

#### Scenario: A user imports a v3 bundle

- **WHEN** a user imports a v3 bundle
- **THEN** no format notice is shown

#### Scenario: The default dataset loads

- **WHEN** the app loads its bundled default dataset
- **THEN** no format notice is shown, whatever the dataset's format version

### Requirement: A missing coordinate SHALL be NaN, never zero

A protein that a projection does not cover SHALL have NaN for every coordinate of that projection:
the v3 encoder SHALL write NaN into part 3, the browser v3 reader SHALL keep NaN, and the browser
legacy reader SHALL produce NaN rather than the zero a fresh `Float32Array` holds. Python's
`decode_v3` SHALL emit a long-format projection row only for a protein whose coordinates in that
projection are finite.

#### Scenario: The encoder writes a protein absent from one projection

- **WHEN** a bundle is written where protein `P` has rows in projection `A` but not in projection
  `B`
- **THEN** part 3 holds finite values in `A__x` and `A__y` for `P`, and NaN in `B__x` and `B__y`

#### Scenario: The browser reads that bundle

- **WHEN** the browser decodes it
- **THEN** `P`'s coordinates in `B` are NaN, not `0`

#### Scenario: A part 3 shorter than part 1

- **WHEN** the browser decodes a v3 bundle whose part 3 holds fewer rows than part 1
- **THEN** it rejects the file, as Python does, rather than placing the unread proteins at `0`

#### Scenario: The legacy reader reads the same gap

- **WHEN** the browser decodes a v2 bundle whose projection `B` has no row for `P`
- **THEN** `P`'s coordinates in `B` are NaN, not `0`

#### Scenario: A v3 round trip in Python

- **WHEN** Python decodes that v3 bundle back into tables
- **THEN** the projections table has a row for `P` in `A` and none for `P` in `B`

### Requirement: The browser protein set SHALL be the proteins with a finite coordinate

The browser reader SHALL include a protein in `protein_ids`, and in every annotation array built
over them, only when it has at least one finite coordinate in at least one projection. A v3 file
SHALL still store annotation-only proteins in part 1, so Python decodes them back.

#### Scenario: An annotation-only protein in a v3 file

- **WHEN** a v3 bundle's part 1 holds protein `Q`, which no projection covers
- **THEN** the browser does not list, count, colour or search `Q`
- **AND** Python's decoded annotations table still contains `Q`

#### Scenario: A label only an unplaced protein carries

- **WHEN** a v3 bundle's part 1 holds placed proteins labelled `A` and `B` and unplaced proteins
  labelled `C`, or with a missing value, in the same column
- **THEN** the browser's labels for that column are `A` and `B` with the order, colours and
  dataset hash a bundle without the unplaced proteins gives, with no `C` and no N/A entry

#### Scenario: A protein covered by one projection of two

- **WHEN** protein `P` has coordinates in projection `A` only
- **THEN** `P` is in `protein_ids` and is shown in `A`

### Requirement: The encoder SHALL add projection identifiers missing from the annotations

The v3 encoder SHALL add an identifier that the projections data names but the annotations table
does not contain as an annotations row whose every annotation is missing, rather than raising.

#### Scenario: A projected protein without annotations

- **WHEN** a bundle is written where protein `R` has coordinates but no annotations row
- **THEN** the write succeeds and the browser shows `R` with N/A for every annotation

### Requirement: A projection's dimension SHALL be derived from its data

The v3 encoder SHALL record a projection as three-dimensional when any of its rows has a finite
`z`, and as two-dimensional otherwise; a NaN `z` counts as missing, as a null one does. A `dimensions` value in the projection metadata that
disagrees SHALL be ignored, with a warning naming the projection and both values, and part 2 SHALL
be written with the derived value so the projection metadata agrees with the manifest and part 3.
Python's `decode_v3` SHALL return the manifest's dimension in the metadata it decodes.

#### Scenario: Metadata declares 2 for a projection with z values

- **WHEN** a projection's rows carry finite `z` values and its metadata says `dimensions` 2
- **THEN** the manifest records dimension 3, part 3 holds its `__z` column, part 2's `dimensions`
  is 3, and a warning is logged

#### Scenario: Metadata declares 3 for a projection without z values

- **WHEN** a projection's `z` is null in every row and its metadata says `dimensions` 3
- **THEN** the manifest records dimension 2, part 3 has no `__z` column, part 2's `dimensions` is
  2, and a warning is logged

#### Scenario: A z column holding only NaN

- **WHEN** a projection's `z` is NaN, not null, in every row
- **THEN** the manifest records dimension 2 and part 3 has no `__z` column, so its points are
  drawn as the legacy readers drew them rather than culled as missing

#### Scenario: Metadata agrees with the data

- **WHEN** the metadata dimension matches the data
- **THEN** no warning is logged and part 2 is written as given

### Requirement: Boolean annotations SHALL read as `true` and `false`

An annotation column of Arrow type `BOOLEAN` SHALL be encoded with the labels `true` and `false`,
the spelling the v2 browser reader displayed, by both the Python and the web encoder.

#### Scenario: A boolean column written by Python

- **WHEN** a bundle is written from an annotations table with a `BOOLEAN` column
- **THEN** the browser's legend for that column shows `true` and `false`, not `True` and `False`

#### Scenario: Saved legend settings keep matching

- **WHEN** a v2 bundle with a `BOOLEAN` column and legend colours saved for `true` and `false` is
  converted to v3
- **THEN** the converted bundle's legend applies the same colours to the same proteins

### Requirement: A list annotation column SHALL be encoded as a multi-valued column

The Python v3 encoder SHALL write an annotation column of an Arrow list type as a multi-valued
column with one hit per non-empty element, each element taken literally as its label, and SHALL
refuse a column that has no text form (a struct, a map, a list of lists) with an error that names
the column.

#### Scenario: GO terms kept as a list column

- **WHEN** `protspace bundle -a` is given a table whose `go_terms` column is `list<string>` with
  the cells `[GO:1, GO:2]` and `[GO:3]`
- **THEN** the bundle is written, the first protein has the two hits `GO:1` and `GO:2`, and Python
  decodes the column as the cells `GO:1;GO:2` and `GO:3`

#### Scenario: A struct column

- **WHEN** `protspace bundle -a` is given a table with a struct column
- **THEN** it exits with a usage error that names the column, without a traceback, and writes no
  bundle

### Requirement: A web re-export SHALL keep the column types Python wrote

The browser reader SHALL keep each v3 manifest column's `sourceType` on the loaded annotation, and
the web exporter SHALL write that `sourceType` back for a column that still fits it, so the Python
package decodes a web re-export of a Python-written bundle to the same column types as the
original. A column that no longer fits its recorded type SHALL be written with the exporter's
inferred type.

#### Scenario: A boolean column round-trips through the web app

- **WHEN** a bundle written by Python with a `BOOLEAN` annotation column is loaded in the web app
  and exported
- **THEN** Python decodes that column of the export as `bool`, with the same values as the original

#### Scenario: A float column of whole numbers round-trips through the web app

- **WHEN** a bundle written by Python with a `double` column whose values are all whole numbers is
  loaded in the web app and exported
- **THEN** Python decodes that column of the export as `double`, not `int64`

#### Scenario: EAT companion columns round-trip through the web app

- **WHEN** a bundle written by `protspace transfer`, whose `<col>__pred_confidence` column is
  `float`, is loaded in the web app and exported
- **THEN** Python decodes the export's `<col>__pred_confidence` as `float`, not `double`, and its
  `__pred_value` and `__pred_source` columns as `string`

#### Scenario: A 64-bit hash column round-trips through the web app

- **WHEN** a bundle written by Python with an `int64` column holding a value beyond ±2^53, which
  the encoder stores as exact decimal labels, is loaded in the web app and exported
- **THEN** Python decodes that column of the export as `int64`, with the same values and nulls as
  the original

#### Scenario: An integer column at the ±2^53 edge round-trips through the web app

- **WHEN** a bundle written by Python with an `int64` column holding `2^53` and `-2^53` is loaded
  in the web app and exported
- **THEN** Python decodes that column of the export as `int64`, not `double`

#### Scenario: A column that no longer fits its recorded type

- **WHEN** a column recorded as `int32` holds a value outside the `int32` range when it is exported
- **THEN** the export records the exporter's inferred type for it instead

### Requirement: The container version and the cell grammar SHALL be recorded under separate keys

A v3 part 1 SHALL declare its container version under `protspace_container_version` and SHALL NOT
carry `protspace_format_version`. `protspace_format_version` SHALL mean only the annotation cell
grammar (`2`, or absent for v1), on legacy parts and on v2-shaped tables. Both readers SHALL
detect a v3 container from `protspace_container_version` alone, SHALL read a file without it as
legacy, and SHALL reject a file whose part count disagrees with that key.

#### Scenario: A written v3 bundle's footer

- **WHEN** Python or the web app writes a bundle
- **THEN** part 1's footer has `protspace_container_version` `"3"` and no
  `protspace_format_version`

#### Scenario: Python decodes a v3 bundle

- **WHEN** `read_tables` decodes a v3 bundle
- **THEN** the annotations table is stamped `protspace_format_version` `2` and carries no
  `protspace_container_version`

#### Scenario: Six parts with only the grammar key

- **WHEN** a six-part file whose part 1 carries `protspace_format_version` `"3"` but no
  `protspace_container_version` is read, in Python or in the browser
- **THEN** it is rejected with an error naming `protspace_container_version`, not read as legacy

#### Scenario: A container key in a legacy-sized file

- **WHEN** a three to five part file whose part 1 carries `protspace_container_version` is read
- **THEN** it is rejected rather than read as legacy cells

#### Scenario: The legacy notice reports the version

- **WHEN** a user imports a v2 bundle
- **THEN** `decodeParquetBundle` reports format version `2`, read from `protspace_format_version`

### Requirement: The v3 encoder SHALL refuse an annotations table of undeclared cell grammar

The Python v3 encoder SHALL refuse an annotations table that is not stamped with
`protspace_format_version` `2`, rather than migrating it as v1. A caller that holds v1 cells
SHALL migrate them explicitly before encoding. `protspace bundle -a` SHALL take the grammar from
its input's stamp, read before any operation drops it, SHALL read the pipeline's own annotation
cache as v2 whether or not it is stamped, and SHALL treat any other unstamped input table as
legacy v1 plain text.

#### Scenario: An already-v2 table that lost its stamp

- **WHEN** `write_bundle` is given an annotations table with v2 cells and no stamp
- **THEN** it raises an error naming `protspace_format_version`, writes nothing, and no cell is
  escaped a second time

#### Scenario: `annotate` output is bundled

- **WHEN** `protspace bundle -a` is given `protspace annotate` output, stamped v2, whose id column
  is `identifier`
- **THEN** the cells in the bundle are the input's cells, not migrated again

#### Scenario: The prepare annotation cache is bundled

- **WHEN** `protspace bundle -a` is given the `tmp/all_annotations.parquet` cache `prepare` kept,
  whose cells hold `Membrane%3B single-pass`, stamped or written before the cache was stamped
- **THEN** the bundle shows the label `Membrane; single-pass`, not `Membrane%3B single-pass`

#### Scenario: A hand-made annotations table is bundled

- **WHEN** `protspace bundle -a` is given an unstamped table with the cells `50% identity` and
  `Membrane (single-pass; type I)`
- **THEN** the bundle shows the labels `50% identity` and `Membrane (single-pass; type I)`, the
  second as one label

#### Scenario: Transfer on a v1 bundle

- **WHEN** `protspace transfer` rewrites a v1 bundle
- **THEN** the v1 cells are migrated to v2 once and the output is a v3 bundle

### Requirement: `decodeParquetBundle` SHALL be the public entry point for reading a bundle

`@protspace/core` SHALL export `decodeParquetBundle(arrayBuffer)`, which reads a bundle of any
supported format version, returns its visualization data and settings, and reports the container
format version it read. `extractRowsFromParquetBundle` SHALL be documented as v1/v2-only and
deprecated, and SHALL reject a v3 bundle with an error that names `decodeParquetBundle`.

#### Scenario: An embedding page reads any bundle

- **WHEN** a page imports `decodeParquetBundle` from `@protspace/core` and passes it a v2 or a v3
  bundle
- **THEN** it receives the same visualization data the web app renders, and the format version

#### Scenario: The row extractor is handed a v3 bundle

- **WHEN** `extractRowsFromParquetBundle` is called on a v3 bundle
- **THEN** it throws an error that points to `decodeParquetBundle` rather than returning rows built
  from integer codes

#### Scenario: The developer docs

- **WHEN** a reader follows `docs/developers/embedding.md` or the API reference
- **THEN** the examples use `decodeParquetBundle`, and `extractRowsFromParquetBundle` is marked
  deprecated and v1/v2-only
