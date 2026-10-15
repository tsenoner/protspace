## ADDED Requirements

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
