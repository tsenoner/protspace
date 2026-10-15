## ADDED Requirements

### Requirement: A distance cutoff marks each query near or distant

`protspace transfer --max-distance D` SHALL classify every query of a `--transfer` column as
`near` when the embedding distance to its nearest reference is at most `D`, and as `distant`
otherwise, and SHALL write that class to the bundle as a categorical column `<COL>__neighbor`,
missing for every protein that was not a query of `COL`. Without `--max-distance` no such column
SHALL be written, and a `<COL>__neighbor` left by an earlier run SHALL be removed when `COL` is
transferred again.

#### Scenario: A fixed cutoff

- **WHEN** transfer runs with `--max-distance 0.2`
- **THEN** a query whose nearest reference lies at distance 0.1 is `near`
- **AND** a query whose nearest reference lies at distance 0.5 is `distant`
- **AND** every reference has no `<COL>__neighbor` value

#### Scenario: Every query is still labelled by default

- **WHEN** transfer runs with `--max-distance` and without `--skip-distant`
- **THEN** distant queries still receive `__pred_*` values, as without a cutoff

#### Scenario: Distant queries left unpredicted

- **WHEN** transfer runs with `--max-distance` and `--skip-distant`
- **THEN** a distant query has no `__pred_*` values and `<COL>__neighbor` is `distant`

#### Scenario: Skipping needs a cutoff

- **WHEN** `--skip-distant` is passed without `--max-distance`
- **THEN** the command fails with a usage error and writes nothing

#### Scenario: Re-running without a cutoff

- **WHEN** a bundle that already has `<COL>__neighbor` is transferred again on `COL` without
  `--max-distance`
- **THEN** the output has no `<COL>__neighbor` column

### Requirement: An automatic cutoff is calibrated on the references

`--max-distance auto` SHALL set the cutoff for each `--transfer` column to the 95th percentile of
the distances from each reference of that column to its nearest other reference, SHALL log the
value chosen, and SHALL fail with a usage error when a column has fewer than two references.
When `--report` is given, every report row SHALL carry the cutoff used for its column and the
query's class.

#### Scenario: Calibrated value is reported

- **WHEN** transfer runs with `--max-distance auto --report predictions.tsv`
- **THEN** each report row's `max_distance` is that column's 95th percentile of
  reference-to-nearest-other-reference distances
- **AND** its `neighbor` value is the class written to `<COL>__neighbor` for that query

#### Scenario: Too few references to calibrate

- **WHEN** a transferred column has a single reference and `--max-distance auto` is given
- **THEN** the command fails with a usage error naming the column
