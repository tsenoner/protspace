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
