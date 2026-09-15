## ADDED Requirements

### Requirement: Resources for an unused feature SHALL NOT be allocated

The renderer SHALL allocate the multi-label colour atlas only while the selected annotation actually
stores more than one value for some protein, and SHALL release it when that ceases to be true. It
SHALL re-stage on either transition, because the change alters every point's slice count without
necessarily altering any sampled style value.

#### Scenario: A single-value annotation costs nothing

- **WHEN** a dataset is rendered with an annotation whose every protein has one value
- **THEN** no capacity-sized colour atlas is allocated on the CPU or the GPU
- **AND** markers render exactly as they did when the atlas was allocated unconditionally

#### Scenario: Switching to a multi-value annotation mid-session

- **WHEN** the user selects a multi-value annotation after a single-value one
- **THEN** the atlas is allocated once and the points are re-staged with their slice counts
- **AND** switching back releases it

#### Scenario: The gate does not depend on what is currently visible

- **WHEN** hidden values reduce every point to a single rendered colour
- **THEN** the annotation is still treated as multi-value and the atlas is retained, so restoring a
  hidden value needs no reallocation
