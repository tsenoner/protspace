## MODIFIED Requirements

### Requirement: Bundles are produced through the real bundle CLI

The generator SHALL invoke the `protspace bundle` command as a subprocess rather than calling `write_bundle` directly, so that the CLI's ID column handling, its cell-grammar decision and its v3 encoding are inside the tested surface. The generator's stand-in for `protspace annotate` output SHALL be keyed on `protein_id` and stamped as v2 cell grammar, as `annotate` writes it. A non-zero exit from the subprocess SHALL fail the suite with the subprocess's captured stderr included in the failure message.

#### Scenario: The producer stops writing v3

- **WHEN** the CLI writes a container other than the six-part layout, or part 1 stops declaring `protspace_container_version` `3`, or starts carrying `protspace_format_version`
- **THEN** the contract suite fails on the layout assertion

#### Scenario: The CLI loses the input's cell grammar

- **WHEN** the CLI stops reading the input's grammar stamp before an operation drops it, so the encoder is handed an unstamped table
- **THEN** the bundle subprocess fails and the suite reports its stderr

#### Scenario: The CLI treats `annotate` output as plain text

- **WHEN** the CLI migrates the stamped `annotate` stand-in as if it were v1, escaping its cells a second time
- **THEN** the contract suite fails because the reader surfaces a percent-encoded label still escaped

#### Scenario: The bundle subprocess exits non-zero

- **WHEN** `protspace bundle` fails during generation
- **THEN** the suite fails with the captured stderr rather than with a missing-file error

## ADDED Requirements

### Requirement: Both writers name the ID column PROTEIN_ID_COLUMN

The contract suite SHALL fail when a bundle written by the Python CLI or re-exported by the web
writer declares a manifest `idColumn` other than the shared `PROTEIN_ID_COLUMN`, including for a
dataset with an annotation named `identifier`.

#### Scenario: The web writer falls back to identifier

- **WHEN** the web writer names the ID column `identifier` for a dataset without an `identifier`
  annotation
- **THEN** the contract suite fails on the `idColumn` assertion
