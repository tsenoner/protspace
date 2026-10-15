## ADDED Requirements

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
