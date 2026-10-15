# bundle-format-contract Specification

## Purpose

The `.parquetbundle` layout, payload encoding, and fixture rules that the Python producer and the TypeScript consumer must agree on, plus the CI trigger boundary that makes the cross-language check unavoidable.

## Requirements

### Requirement: Bundle fixtures are generated, never committed

Every `.parquetbundle` used by the contract suite SHALL be produced during the test run by the Python producer and written to a temporary directory. The contract suite SHALL NOT read any `.parquetbundle` checked into the repository.

#### Scenario: The contract suite runs

- **WHEN** the contract suite executes
- **THEN** its bundles are generated into a temporary directory by the generator
- **AND** no committed `.parquetbundle` file is read by the suite

#### Scenario: The Python writer changes its output

- **WHEN** a change alters what the producer emits
- **THEN** the next contract run reads the new output rather than a stale committed blob

### Requirement: Bundles are produced through the real bundle CLI

The generator SHALL invoke the `protspace bundle` command as a subprocess rather than calling `write_bundle` directly, so that the CLI's `identifier` to `protein_id` rename and its format-version stamping are inside the tested surface. A non-zero exit from the subprocess SHALL fail the suite with the subprocess's captured stderr included in the failure message.

#### Scenario: Format-version stamping is removed from the CLI

- **WHEN** the annotations table is no longer stamped before bundling
- **THEN** the contract suite fails because the reader reports format version `1` instead of `2`

#### Scenario: The bundle subprocess exits non-zero

- **WHEN** `protspace bundle` fails during generation
- **THEN** the suite fails with the captured stderr rather than with a missing-file error

### Requirement: The reader accepts every layout the producer can write

The web reader SHALL accept bundles of three, four, and five parts. Parts beyond the settings part SHALL be ignored rather than parsed or rejected. A zero-byte settings part SHALL be reported as absent settings.

#### Scenario: A three-part bundle is read

- **WHEN** a bundle without settings or statistics is read
- **THEN** extraction succeeds and settings are reported as absent

#### Scenario: A four-part bundle is read

- **WHEN** a bundle with a settings part is read
- **THEN** extraction succeeds and the settings are normalized through the shared settings normalizer

#### Scenario: A five-part bundle with settings and statistics is read

- **WHEN** a bundle written with both settings and statistics is read
- **THEN** extraction succeeds, the settings are returned, and the statistics part is ignored

#### Scenario: A five-part bundle carries the zero-byte settings sentinel

- **WHEN** a bundle written with statistics but without settings is read
- **THEN** extraction succeeds, settings are reported as absent, and the statistics part is ignored

#### Scenario: A bundle carries more parts than the format defines

- **WHEN** a file with more than five parts is read
- **THEN** extraction fails with an error naming the observed part count

### Requirement: The contract payload exercises the annotation encoding

The generated bundle SHALL carry annotation and projection values that distinguish a correct reader from one that only parses the part layout: at least one percent-encoded label, at least one multi-hit cell using the reserved delimiter, at least one numeric annotation column containing a null, at least one three-dimensional projection, and projection metadata whose JSON contains a value that arrives from parquet as a big integer.

#### Scenario: A percent-encoded label round-trips

- **WHEN** an annotation value written by the producer contains a percent-encoded character
- **THEN** the reader decodes it to the original character rather than exposing the escape sequence

#### Scenario: A multi-hit annotation cell is split

- **WHEN** an annotation cell contains several values joined by the reserved delimiter
- **THEN** the reader reports them as separate values for that protein

#### Scenario: A numeric annotation column contains a null

- **WHEN** a numeric annotation is missing for a protein
- **THEN** the reader reports that protein as having no value for the annotation rather than a zero or a not-a-number value

#### Scenario: A three-dimensional projection is read

- **WHEN** a projection declares three dimensions
- **THEN** the reader exposes its `z` coordinates and reports the dimension count from the projection metadata

#### Scenario: Projection metadata contains a big integer

- **WHEN** projection metadata JSON carries a value parsed from parquet as a big integer
- **THEN** extraction completes without a serialization failure

### Requirement: The contract covers both conversion implementations

The reader routes datasets past a row-count threshold through a separate, optimized conversion implementation. The contract SHALL exercise both that implementation and the small-data one, asserting the same annotation encoding contract through each.

#### Scenario: A dataset large enough to take the optimized path is read

- **WHEN** a generated bundle exceeds the reader's optimized-path row threshold
- **THEN** the optimized conversion entry point decodes its percent-encoded labels, splits its multi-hit cells, and reports its missing numeric values exactly as the small-data path does

#### Scenario: Only the optimized implementation regresses

- **WHEN** annotation decoding breaks in the optimized implementation but not the small-data one
- **THEN** the contract suite fails

### Requirement: Contract assertions fail when the behavior they name regresses

Each assertion SHALL be falsifiable by the regression it describes. An assertion SHALL NOT be satisfied by an out-of-range index, by an unrelated error message, or by behavior that is identical with and without the code under test.

#### Scenario: The zero-byte settings guard is removed

- **WHEN** the reader stops treating an empty settings part as the producer's sentinel and routes it through the settings parser
- **THEN** the contract suite fails

#### Scenario: A reader drops a protein from a numeric annotation column

- **WHEN** a numeric annotation array is shorter than the protein count
- **THEN** the missing-value assertion fails rather than passing on an undefined index

#### Scenario: Converted data retains a value that cannot be serialized

- **WHEN** conversion leaves a BigInt in its output
- **THEN** the contract suite fails at serialization rather than only at conversion

### Requirement: The contract check cannot be silently skipped

The contract suite SHALL be a standalone test project that is not part of the default workspace test run, and SHALL NOT guard itself on the presence of the Python toolchain. Its CI job SHALL run for every change that can affect either side of the seam, without a hand-maintained path filter — a filter is a copy of an import graph, and when it is wrong the job does not fail, it silently does not run.

#### Scenario: The Python toolchain is unavailable in the contract job

- **WHEN** the generator cannot be executed
- **THEN** the suite fails rather than reporting skipped tests

#### Scenario: A pull request changes only the Python producer

- **WHEN** a change touches the bundle writer, the annotation encoding, or the bundle CLI
- **THEN** the contract job runs even though the TypeScript quality workflow does not

#### Scenario: A pull request changes only the TypeScript consumer

- **WHEN** a change touches the data-loader or the shared parquet utilities
- **THEN** the contract job runs even though the Python workflow does not

#### Scenario: A pull request changes a module the assertions depend on indirectly

- **WHEN** a change touches a module the reader imports to normalize settings or to decode missing values, without touching the data-loader itself
- **THEN** the contract job still runs

### Requirement: A bundle never carries the internal lookup columns

Every path that writes a bundle's annotations part SHALL omit the internal lookup columns
`organism_id` and `sequence`: `prepare`, `bundle`, `transfer` and the Python bundle-writing
functions. ProtSpace fetches these only to drive the taxonomy and sequence-based lookups. The
annotation-metadata registry and no bundle reader use them. In a bundle they show up in the web
app as meaningless near-unique categorical columns, and the sequences inflate the file.

#### Scenario: A table holding internal columns is bundled

- **WHEN** `protspace bundle -a` is given an annotations parquet that contains `organism_id` and
  `sequence`, such as the annotation cache
- **THEN** the written bundle's annotations part contains neither column
- **AND** every other column is kept unchanged

#### Scenario: Annotations of an existing bundle are replaced

- **WHEN** `protspace transfer` or the annotations-replacement function writes a bundle whose
  input bundle carried `organism_id` or `sequence`
- **THEN** the output bundle carries neither column

#### Scenario: The pipeline writes a bundle

- **WHEN** `protspace prepare` writes a bundle
- **THEN** it carries neither column, as before

#### Scenario: A user asks annotate for the sequence

- **WHEN** `protspace annotate -a sequence` writes its parquet output
- **THEN** that output keeps the `sequence` column, because it is not a bundle

### Requirement: Producer and reader read the same cells as missing

The Python package SHALL treat an annotation cell as missing exactly when the web reader
does: a null, a non-finite number, a blank string, or a string that, trimmed and
lower-cased, is one of the web reader's missing-value spellings. Python SHALL hold one
definition of this, used by every Python reader of annotation cells (the Dash plot,
`protspace stats` and `protspace transfer`). The contract suite SHALL fail when the two
sides' spellings or matching rules differ.

#### Scenario: A spelling is added on one side only

- **WHEN** a missing-value spelling is added to the web reader's set but not to Python's, or
  the reverse
- **THEN** the contract suite fails

#### Scenario: One side changes how it matches

- **WHEN** either side stops trimming, stops comparing case-insensitively, or stops treating
  a blank cell as missing
- **THEN** the contract suite fails

#### Scenario: A cell spelled like a missing value in another case

- **WHEN** an annotation cell holds `N/A`, `NULL`, `None`, or `na` padded with spaces
- **THEN** the Dash plot shows it as N/A, `protspace stats` leaves it out of every category,
  and `protspace transfer` treats the protein as missing a value in that column

### Requirement: Producer categories are never spelled like a missing value

The Python producer SHALL NOT write a fixed category, or any hit of a multi-hit category,
that the web reader would read as missing. A test SHALL run each fixed producer vocabulary
through the shared missing-value definition, and SHALL fail on any string literal in the
annotation producer modules spelled like a missing value.

#### Scenario: A producer's negative category is renamed to a missing spelling

- **WHEN** a fixed producer vocabulary (for example TMbed's `non-transmembrane`) is changed
  to a value such as `none`
- **THEN** the Python test suite fails, naming the value

#### Scenario: A new producer writes a literal missing spelling

- **WHEN** a module under the annotation retrievers, transformers or parsers gains a string
  literal spelled like a missing value
- **THEN** the Python test suite fails, naming the file and line

### Requirement: A style for N/A reaches the web's N/A category

`protspace style` SHALL store every style that names a value the web reads as missing under the
web's N/A key, `__NA__`, whatever spelling the data or the styles file uses. This covers colours,
shapes, `pinnedValues` and `hiddenValues`. The settings it writes SHALL hold at most one N/A
category, and a newly given N/A style SHALL replace a stored one.

#### Scenario: Missing cells spelled in a way the old alias list missed

- **WHEN** a column's missing cells are spelled `N/A` and the styles file colours `N/A`
- **THEN** the settings hold that colour under `__NA__` and no `N/A` category

#### Scenario: Restyling N/A

- **WHEN** a bundle's settings already colour `__NA__` and `protspace style` is given a new N/A
  colour under any N/A spelling
- **THEN** the written settings hold the new colour under `__NA__`

#### Scenario: Hiding or pinning N/A by its spelling

- **WHEN** `hiddenValues` or `pinnedValues` name N/A as `N/A`, `""` or `none`
- **THEN** the written settings name it `__NA__`, once

### Requirement: Produced annotation categories do not collide with missing-value sentinels

The Python annotation producer SHALL serialize a completed categorical prediction using
a value that the TypeScript bundle consumer preserves as a category rather than
normalizing to missing data.

#### Scenario: Negative TMbed prediction crosses the bundle boundary

- **WHEN** Biocentral returns a completed TMbed prediction containing neither an
  alpha-helical nor a beta-barrel transmembrane segment
- **THEN** the producer emits `non-transmembrane`
- **AND** the TypeScript visualization data exposes `non-transmembrane` as a categorical
  value rather than `N/A`

#### Scenario: Missing TMbed prediction remains missing

- **WHEN** Biocentral returns no TMbed prediction for a protein
- **THEN** the producer emits the established missing representation
- **AND** the TypeScript visualization data does not invent a transmembrane category

#### Scenario: Empty or malformed TMbed payload remains missing

- **WHEN** Biocentral returns a TMbed prediction object whose optional `value` payload
  is `None`, empty, non-string, blank, or contains unsupported topology labels
- **THEN** the producer emits the established missing representation before scanning
  topology labels
- **AND** the TypeScript visualization data exposes the protein as `N/A` rather than
  `non-transmembrane`
- **AND** the derived signal-peptide annotation is also exposed as `N/A` rather than
  `False`
