## ADDED Requirements

### Requirement: Every table ProtSpace writes names its protein ID column protein_id

Every table the Python package or the web app writes SHALL hold its protein IDs in a column named
`protein_id`, the shared `PROTEIN_ID_COLUMN`. This covers a bundle's part 1 and its manifest
`idColumn`, from the Python encoder and the web exporter alike, both parts of an unbundled
directory that carry IDs (`selected_annotations.parquet`, `projections_data.parquet`), `protspace
annotate` output, the `<stem>.annotations.parquet` that `stats -a` writes, and `prepare`'s
annotation cache. The tables `read_tables` and `read_bundle_contents` return SHALL be keyed on
`protein_id`, the long projections table included.

#### Scenario: A bundle from the pipeline

- **WHEN** `protspace prepare` writes a bundle
- **THEN** part 1's ID column and the manifest's `idColumn` are `protein_id`

#### Scenario: A bundle from a table keyed on identifier

- **WHEN** `write_bundle` is given an annotations table and a projections table both keyed on
  `identifier`
- **THEN** part 1's ID column and the manifest's `idColumn` are `protein_id`

#### Scenario: A web export

- **WHEN** the web app exports a dataset, including one with an annotation named `identifier`
- **THEN** the manifest's `idColumn` is `protein_id` and `identifier` is an annotation column

#### Scenario: An unbundled directory

- **WHEN** `prepare --no-bundled` or `protspace project` writes a directory
- **THEN** each of its files that carries protein IDs holds them in `protein_id`

#### Scenario: annotate output

- **WHEN** `protspace annotate` writes its parquet or CSV
- **THEN** the IDs are in its first column, named `protein_id`

#### Scenario: The decoded projections

- **WHEN** a script reads `read_bundle_contents(path).projections`
- **THEN** its columns are `projection_name`, `protein_id`, `x`, `y`, `z`

### Requirement: A v3 reader takes the ID column from the manifest

The browser's and Python's v3 readers SHALL read the protein IDs from the part 1 column the
manifest's `idColumn` names, whatever its name, and SHALL NOT choose the column by name. Python
SHALL hand the decoded annotations back with that column named `protein_id`.

#### Scenario: A v3 file from an older web export

- **WHEN** a v3 bundle whose manifest says `"idColumn": "identifier"` is read by `read_tables`
- **THEN** the annotations table holds those IDs in `protein_id`, and no `identifier` column

#### Scenario: A manifest naming another column

- **WHEN** a v3 manifest's `idColumn` is `accession`
- **THEN** the browser lists the proteins from `accession`, and Python hands them back in
  `protein_id`

### Requirement: A table without a manifest is keyed on protein_id, else identifier

A reader SHALL take `protein_id` as a table's ID column when present, else `identifier`, for a
table with no manifest (an unbundled directory part, an annotation parquet given to `bundle -a` or
`stats -a`, `prepare`'s annotation cache, a v1/v2 bundle part). Beside `protein_id`, an `identifier`
column SHALL be an ordinary annotation. Taking `identifier` as the ID column of an unbundled
directory part or an annotation parquet SHALL log the `LEGACY_ID_COLUMN` deprecation warning once
per read, naming the file. A v1/v2 bundle, which warns for its format, and the annotation cache
SHALL NOT log it.

#### Scenario: An old projections directory

- **WHEN** `protspace bundle -p` reads a directory whose `projections_data.parquet` is keyed on
  `identifier`
- **THEN** the bundle is written keyed on `protein_id`, and one deprecation warning names the file
  and the removal version

#### Scenario: Old annotate output

- **WHEN** `bundle -a` reads an annotation parquet keyed on `identifier`, with no `protein_id`
- **THEN** its IDs key the bundle's rows and the deprecation warning is logged once

#### Scenario: A table with both names

- **WHEN** an annotation parquet holds `protein_id` and `identifier`
- **THEN** `protein_id` holds the IDs, `identifier` reaches the bundle as an annotation, and no
  deprecation warning is logged

#### Scenario: A cache from an older release

- **WHEN** `prepare` reuses an annotation cache keyed on `identifier`
- **THEN** its values are reused, no deprecation warning is logged, and the next write keys it on
  `protein_id`
