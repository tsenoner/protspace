## ADDED Requirements

### Requirement: The EAT cell offers example filters

The EAT cell SHALL offer a button that fills in filters copying `protein_families` from reviewed
(Swiss-Prot) proteins to unreviewed (TrEMBL) ones, and SHALL say why and fill in nothing when the
bundle has no `reviewed` column or no bundle was generated yet.

#### Scenario: A bundle of the Snake Toxin example

- **WHEN** the user clicks Load example filters after generating it
- **THEN** the target is `protein_families`, the query filter `reviewed~TrEMBL` and the reference
  filter `reviewed~Swiss-Prot`, and Transfer fills only TrEMBL proteins

#### Scenario: A bundle without UniProt annotations

- **WHEN** the bundle has no `reviewed` column
- **THEN** the cell says so and the filters stay empty
