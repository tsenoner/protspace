## ADDED Requirements

### Requirement: `protspace convert` SHALL rewrite a v1 or v2 bundle as v3

The CLI SHALL provide `protspace convert INPUT [OUTPUT] [--in-place]`, which reads a v1 or v2
bundle and writes it as a format v3 container carrying the same proteins, annotations and
projections. An unstamped (v1) annotations table SHALL be migrated to the v2 cell grammar before it
is encoded, so its labels keep their parsed hit structure.

#### Scenario: A v2 bundle is converted

- **WHEN** `protspace convert old.parquetbundle new.parquetbundle` runs on a v2 bundle
- **THEN** `new.parquetbundle` is a v3 container, and decoding it gives back the tables read from
  `old.parquetbundle`, up to the canonical spellings listed in the data-format guide

#### Scenario: A v1 label contains a percent sign

- **WHEN** a v1 bundle has the annotation label `50% identity` and is converted
- **THEN** the converted bundle shows the label `50% identity` in the browser and in Python

#### Scenario: A v1 cell has a semicolon inside parentheses

- **WHEN** a v1 cell reads `Membrane (single-pass; type I)`
- **THEN** the converted bundle holds it as one label, not two hits

### Requirement: `protspace convert` SHALL NOT overwrite its input unless explicitly asked

The command SHALL require either an `OUTPUT` path or `--in-place`. It SHALL write over `INPUT` only
when `OUTPUT` is the same path as `INPUT` or `--in-place` is given.

#### Scenario: Neither an output nor the in-place flag

- **WHEN** `protspace convert old.parquetbundle` runs
- **THEN** it exits non-zero with a usage error naming `OUTPUT` and `--in-place`, and
  `old.parquetbundle` is unchanged

#### Scenario: In-place conversion

- **WHEN** `protspace convert old.parquetbundle --in-place` runs on a v2 bundle
- **THEN** `old.parquetbundle` is replaced by its v3 conversion

#### Scenario: The output names the input

- **WHEN** `protspace convert old.parquetbundle old.parquetbundle` runs on a v2 bundle
- **THEN** `old.parquetbundle` is replaced by its v3 conversion

### Requirement: `protspace convert` SHALL preserve settings and statistics

The converted bundle SHALL carry the input's settings and its statistics part. Settings SHALL be
kept as stored, including the web app's envelope, and statistics SHALL be kept byte for byte.

#### Scenario: A five-part bundle with settings and statistics

- **WHEN** a v2 bundle with legend settings and a statistics part is converted
- **THEN** the v3 output's settings equal the input's, and its statistics part is byte-identical

#### Scenario: A bundle with statistics but no settings

- **WHEN** a v2 bundle with a zero-byte settings slot and a statistics part is converted
- **THEN** the v3 output has no settings and the same statistics

### Requirement: `protspace convert` SHALL leave a v3 input untouched

When `INPUT` is already a v3 container, the command SHALL report that the file is already current,
exit successfully and write nothing.

#### Scenario: Converting a v3 bundle

- **WHEN** `protspace convert current.parquetbundle out.parquetbundle` runs on a v3 bundle
- **THEN** it exits `0`, says the file is already v3, `current.parquetbundle` is byte-identical
  and `out.parquetbundle` is not created

### Requirement: `protspace convert` SHALL write its output atomically

The converted bundle SHALL be written through the package's atomic file writer, so a failed or
interrupted conversion leaves the destination as it was.

#### Scenario: Encoding fails part-way

- **WHEN** encoding fails during an in-place conversion
- **THEN** the command exits non-zero, the input file is byte-identical to before, and no temporary
  file is left next to it

### Requirement: Exporting a loaded v1 or v2 bundle from the web app SHALL write v3

The web app SHALL write a v3 bundle when a user exports a dataset that was loaded from a v1 or v2
file, carrying its settings and statistics as for any other export, so the app upgrades a file
without a Python install.

#### Scenario: Re-exporting a legacy import

- **WHEN** a user imports a v1 bundle and exports it as a `.parquetbundle`
- **THEN** the exported file is v3, and importing it shows the same proteins, projections,
  annotation values and legend settings without the format notice
