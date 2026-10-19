# eat-transfer-scope Specification

## Purpose

Which proteins act as queries and which as references when `protspace transfer` (EAT) runs, including the no-rules case that transfers within a single dataset, and the errors that keep a mis-scoped run from silently succeeding.

## Requirements

### Requirement: A rule with no clauses restricts nothing

A classification `Rule` carrying neither an id prefix nor a `where` clause SHALL match every
protein. Running `protspace transfer` with no query or reference filters SHALL therefore transfer
within the bundle: every protein missing a value in a target column receives one from its nearest
neighbour among the proteins that have a value. An _explicit_ rule that matches nothing SHALL
remain an error.

#### Scenario: No rules at all

- **WHEN** `protspace transfer` is run with no `--query-*` and no `--reference-*` filters
- **THEN** every protein missing a value in a `--transfer` column is a query
- **AND** every protein holding a value in that column is a reference
- **AND** no marker column is required

#### Scenario: An explicit rule that matches nothing still errors

- **WHEN** a query rule names an id prefix no protein carries
- **THEN** classification fails with an error naming the query filters

#### Scenario: An explicit reference rule that matches nothing errors too

- **WHEN** a reference rule names an id prefix no protein carries
- **THEN** classification fails with an error naming the reference filters
- **AND** the command does not exit successfully having written the bundle back unchanged

#### Scenario: A query rule that consumes every reference

- **WHEN** both rules are explicit and the query rule matches every protein the reference rule matches
- **THEN** precedence leaves the reference set empty, and classification fails rather than transferring nothing

### Requirement: An open rule does not consume proteins from the other set

Query classification SHALL take precedence over reference classification only when BOTH rules are
explicit. When either rule is open, a protein matching both SHALL remain a candidate on both sides.

#### Scenario: Both rules open

- **WHEN** both rules are open
- **THEN** the query set and the reference set each cover the whole table

#### Scenario: Only a query rule is given

- **WHEN** a query rule is explicit and no reference rule is given
- **THEN** every protein in the table is offered as a reference rather than the set coming back
  empty — including proteins the query rule matched, since the per-column missing-vs-present split
  is what keeps the two sets disjoint
- **AND** the run does not exit successfully having transferred nothing

#### Scenario: Two explicit rules

- **WHEN** both rules are explicit and a protein matches both
- **THEN** that protein is a query and not a reference

### Requirement: A protein is never its own reference

For each transfer column the query set and the reference set SHALL be complements of the
missing-value test over that column, so no protein can supply its own label.

#### Scenario: Self-transfer over a real dataset

- **WHEN** transfer runs with no rules over a dataset where some proteins carry the target value
- **THEN** no emitted prediction names its own protein as the source

### Requirement: A transfer can report every query's neighbours

`protspace transfer --report PATH` SHALL write a tab-separated table with one row per query
protein and neighbour considered, for every `--transfer` column. Each row SHALL carry the
transferred column, the query id, the predicted label, its source reference, the raw embedding
distance to that source and the reliability index, followed by the neighbour's rank (1 = nearest),
reference id, label and distance. A query SHALL have `min(k, number of references)` rows.

#### Scenario: One neighbour per query

- **WHEN** transfer runs with `--k 1` and `--report predictions.tsv`
- **THEN** the report has one row per query, whose rank-1 reference is the prediction's source
- **AND** its `distance` is the raw distance to that source, not the reliability index

#### Scenario: Several neighbours per query

- **WHEN** transfer runs with `--k 3` against at least three references
- **THEN** each query has three rows, ranked by ascending distance, each naming a reference and
  its label

#### Scenario: Equidistant references

- **WHEN** two references lie at exactly the same distance from a query
- **THEN** the one with the smaller id is ranked first, so the report does not depend on the order
  of the references

### Requirement: The report leaves the bundle unchanged

Asking for a report SHALL NOT change the bundle a transfer writes.

#### Scenario: Same run with and without a report

- **WHEN** the same transfer runs once with `--report` and once without
- **THEN** both runs write the same annotations

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
- **AND** with `--report`, its rows still name the label and source it would have been given,
  with `neighbor` `distant`

#### Scenario: Every query distant

- **WHEN** `--skip-distant` leaves every query of a column unpredicted
- **THEN** transfer logs a warning at default verbosity naming the column and the cutoff

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
Above 10,000 references the percentile SHALL be estimated from a fixed seeded sample of 10,000 of
them, each still searched against all references, so the same references always give the same
cutoff.
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

### Requirement: A transfer keys the bundle on protein_id

`protspace transfer` SHALL key the bundle's proteins on `protein_id`, the column every bundle is
read back with. Beside it, an `identifier` column SHALL be an ordinary annotation: written back
unchanged and usable in `--query-where` and `--reference-where`, and never a reason to refuse the
bundle.

#### Scenario: A bundle with an annotation named identifier

- **WHEN** `transfer` runs on a bundle holding `protein_id` and an `identifier` annotation
- **THEN** it succeeds, the written bundle is keyed on `protein_id`, and every protein's
  `identifier` value is the one it had

#### Scenario: Filtering on the identifier annotation

- **WHEN** such a transfer is given `--query-where identifier~alias-1`
- **THEN** the queries are the proteins whose `identifier` value contains `alias-1`
