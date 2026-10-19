## MODIFIED Requirements

### Requirement: Bundles are produced through the real bundle CLI

The generator SHALL invoke the `protspace bundle` command as a subprocess rather than calling `write_bundle` directly, so that the CLI's `identifier` to `protein_id` rename, its cell-grammar decision and its v3 encoding are inside the tested surface. The generator's stand-in for `protspace annotate` output SHALL be stamped as v2 cell grammar, as `annotate` stamps it. A non-zero exit from the subprocess SHALL fail the suite with the subprocess's captured stderr included in the failure message.

#### Scenario: The producer stops writing v3

- **WHEN** the CLI writes a container other than the six-part layout, or part 1 stops declaring `protspace_container_version` `3`, or starts carrying `protspace_format_version`
- **THEN** the contract suite fails on the layout assertion

#### Scenario: The CLI loses the input's cell grammar

- **WHEN** the CLI stops reading the input's grammar stamp before its rename drops it, so the encoder is handed an unstamped table
- **THEN** the bundle subprocess fails and the suite reports its stderr

#### Scenario: The CLI treats `annotate` output as plain text

- **WHEN** the CLI migrates the stamped `annotate` stand-in as if it were v1, escaping its cells a second time
- **THEN** the contract suite fails because the reader surfaces a percent-encoded label still escaped

#### Scenario: The bundle subprocess exits non-zero

- **WHEN** `protspace bundle` fails during generation
- **THEN** the suite fails with the captured stderr rather than with a missing-file error

### Requirement: The reader accepts every layout the producer can write

The web reader SHALL accept six-part format v3 bundles, and SHALL keep accepting legacy bundles of three, four, and five parts until legacy read support is removed. A zero-byte settings slot SHALL be reported as absent settings. A statistics part SHALL be carried through unmodified and parsed into statistics rows, without leaking into the settings. A file with more parts than the format defines SHALL be rejected.

#### Scenario: A bundle without settings or statistics is read

- **WHEN** a bundle written without settings or statistics is read
- **THEN** extraction succeeds and settings and statistics are reported as absent

#### Scenario: A bundle with settings is read

- **WHEN** a bundle with a settings part is read
- **THEN** extraction succeeds and the settings are normalized through the shared settings normalizer

#### Scenario: A bundle with settings and statistics is read

- **WHEN** a bundle written with both settings and statistics is read
- **THEN** extraction succeeds, the settings are returned, and the statistics are returned as the original bytes and as rows whose columns match the producer's statistics schema

#### Scenario: A bundle carries the zero-byte settings sentinel

- **WHEN** a bundle written with statistics but without settings is read
- **THEN** extraction succeeds, settings are reported as absent without entering the settings parser, and the statistics are returned

#### Scenario: A bundle carries more parts than the format defines

- **WHEN** a file with more than six parts is read
- **THEN** extraction fails with an error naming the observed delimiter count

### Requirement: The contract payload exercises the annotation encoding

The generated bundle SHALL carry annotation and projection values that distinguish a correct reader from one that only parses the part layout: at least one percent-encoded label, at least one multi-hit cell using the reserved delimiter, at least one numeric annotation column containing a null, at least one boolean annotation column, at least one three-dimensional projection, at least one protein that one projection does not cover, and projection metadata whose JSON contains a value that arrives from parquet as a big integer.

#### Scenario: A percent-encoded label round-trips

- **WHEN** an annotation value written by the producer contains a percent-encoded character
- **THEN** the reader decodes it to the original character rather than exposing the escape sequence

#### Scenario: A multi-hit annotation cell is split

- **WHEN** an annotation cell contains several values joined by the reserved delimiter
- **THEN** the reader reports them as separate values for that protein

#### Scenario: A numeric annotation column contains a null

- **WHEN** a numeric annotation is missing for a protein
- **THEN** the reader reports that protein as having no value for the annotation rather than a zero or a not-a-number value

#### Scenario: A boolean annotation column is read

- **WHEN** the producer writes an annotation column of Arrow type `BOOLEAN`
- **THEN** the reader reports its values as `true` and `false`

#### Scenario: A three-dimensional projection is read

- **WHEN** a projection's rows carry `z` coordinates
- **THEN** the reader exposes its `z` coordinates and reports three dimensions

#### Scenario: A protein is missing from one projection

- **WHEN** the producer writes a protein with coordinates in one projection and none in another
- **THEN** the reader reports NaN coordinates for it in the projection that does not cover it, and keeps it in the protein list

#### Scenario: Projection metadata contains a big integer

- **WHEN** projection metadata JSON carries a value parsed from parquet as a big integer
- **THEN** extraction completes without a serialization failure

### Requirement: A bundle never carries the internal lookup columns

Every path that writes a bundle's annotations part SHALL omit the internal lookup columns
`organism_id` and `sequence`: `prepare`, `bundle`, `transfer`, `convert`, `style` on a v1 or v2
input, and the Python bundle-writing functions. ProtSpace fetches these only to drive the taxonomy
and sequence-based lookups. The annotation-metadata registry and no bundle reader use them. In a
bundle they show up in the web app as meaningless near-unique categorical columns, and the
sequences inflate the file.

#### Scenario: A table holding internal columns is bundled

- **WHEN** `protspace bundle -a` is given an annotations parquet that contains `organism_id` and
  `sequence`, such as the annotation cache
- **THEN** the written bundle's annotations part contains neither column
- **AND** every other column is kept unchanged

#### Scenario: Annotations of an existing bundle are replaced

- **WHEN** `protspace transfer` or the annotations-replacement function writes a bundle whose
  input bundle carried `organism_id` or `sequence`
- **THEN** the output bundle carries neither column

#### Scenario: A legacy bundle that carries them is rewritten as v3

- **WHEN** `protspace convert`, or `protspace style`, rewrites a v1 or v2 bundle whose annotations
  carry `organism_id` or `sequence`
- **THEN** the v3 output carries neither column, and every other annotation column is kept

#### Scenario: The pipeline writes a bundle

- **WHEN** `protspace prepare` writes a bundle
- **THEN** it carries neither column, as before

#### Scenario: A user asks annotate for the sequence

- **WHEN** `protspace annotate -a sequence` writes its parquet output
- **THEN** that output keeps the `sequence` column, because it is not a bundle

## REMOVED Requirements

### Requirement: The contract covers both conversion implementations

**Reason**: The producer now writes only v3, which the browser reads with a single columnar reader. The two threshold-routed conversion implementations are reached only by v1/v2 bundles, which the real CLI can no longer produce.

**Migration**: The legacy conversion paths stay covered by the in-language tests over the committed `v2-sample` fixture until legacy read support is removed. The contract's scale coverage moves to "The contract covers the reader at production scale".

## ADDED Requirements

### Requirement: The contract covers the reader at production scale

The contract SHALL read, besides the small bundles, a generated bundle large enough that shortcuts sized from the first rows (a label dictionary, a CSR payload, a hit count) would show and that spans several data pages per column, SHALL assert the same annotation encoding contract on it as on the small bundles, and SHALL check its labels, hits, scores, numeric values and coordinates row by row.

#### Scenario: A dataset of production scale is read

- **WHEN** the large generated bundle is read
- **THEN** its protein count matches the producer's, and it decodes percent-encoded labels, splits multi-hit cells and reports missing numeric values exactly as the small bundles do

#### Scenario: Only large payloads regress

- **WHEN** the reader mishandles a payload only past its first rows, or a chunk that starts past
  row 0
- **THEN** the contract suite fails
