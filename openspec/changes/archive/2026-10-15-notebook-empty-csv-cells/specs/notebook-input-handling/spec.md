## ADDED Requirements

### Requirement: The panel leaves missing annotation cells missing

The Preparation notebook SHALL build its annotations table with the package's
`align_annotations`, as `protspace prepare` does, so an empty cell of a custom CSV, a null the
annotations hand back, and a protein they do not cover are all missing in the bundle and never
the label `nan`. Under a released protspace without `align_annotations`, the notebook's fallback
SHALL do the same.

#### Scenario: A CSV with empty cells

- **WHEN** Generate runs on a CSV whose rows leave some cells empty
- **THEN** those cells are missing in the bundle, and no cell holds `nan`

#### Scenario: The released package

- **WHEN** the installed protspace has no `align_annotations` and reads empty CSV cells as nulls
- **THEN** the bundle the panel writes is the same as with the current package
