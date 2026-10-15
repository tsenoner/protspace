## ADDED Requirements

### Requirement: Produced annotation categories do not collide with missing-value sentinels

The Python annotation producer SHALL serialize a completed categorical prediction using
a value that the TypeScript bundle consumer preserves as a category rather than
normalizing to missing data.

#### Scenario: Negative TMbed prediction crosses the bundle boundary

- **WHEN** Biocentral returns a completed TMbed prediction containing neither an
  alpha-helical nor a beta-barrel transmembrane segment
- **THEN** the producer emits `non-transmembrane`
- **AND** the TypeScript visualization data exposes `non-transmembrane` as a categorical
  value rather than `N/A`

#### Scenario: Missing TMbed prediction remains missing

- **WHEN** Biocentral returns no TMbed prediction for a protein
- **THEN** the producer emits the established missing representation
- **AND** the TypeScript visualization data does not invent a transmembrane category

#### Scenario: Empty or malformed TMbed payload remains missing

- **WHEN** Biocentral returns a TMbed prediction object whose optional `value` payload
  is `None`, empty, non-string, blank, or contains unsupported topology labels
- **THEN** the producer emits the established missing representation before scanning
  topology labels
- **AND** the TypeScript visualization data exposes the protein as `N/A` rather than
  `non-transmembrane`
- **AND** the derived signal-peptide annotation is also exposed as `N/A` rather than
  `False`
