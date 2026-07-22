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
