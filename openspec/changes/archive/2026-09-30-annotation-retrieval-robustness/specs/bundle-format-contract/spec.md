## ADDED Requirements

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
