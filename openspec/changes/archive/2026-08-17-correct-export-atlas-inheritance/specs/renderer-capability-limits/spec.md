## MODIFIED Requirements

### Requirement: Exported images SHALL use the same marker fidelity as the live view

The export renderer SHALL query its own context's texture limit and SHALL use a slice stride no
greater than the live renderer's, so an exported figure carries the same marker segmentation the
user saw on screen. Its declared maximum output dimension SHALL be the smaller of its own limit and
its configured maximum.

Whether an atlas is wanted at all SHALL be decided from the same styling authority the export stages
its colours through, and SHALL NOT be inferred from whichever atlas the last completed render left
behind — nothing forces a render before an export, so that allocation is stale in both directions. A
live plan, where one exists, still caps the stride.

#### Scenario: A figure matches the screen

- **WHEN** the live view is rendering at reduced stride and the user exports an image
- **THEN** the exported markers use the same stride

#### Scenario: The device cannot hold an atlas

- **WHEN** the live renderer has permanently disabled its atlas because no layout fits the device
- **THEN** the export allocates none either and renders dominant colours

#### Scenario: A single-value annotation is selected

- **WHEN** the selected annotation stores one value per protein
- **THEN** the export allocates no atlas, whether or not the live renderer still holds one staged
  for an earlier annotation

#### Scenario: A multi-value annotation has not been staged yet

- **WHEN** a multi-value annotation is selected and no frame has been rendered since
- **THEN** the export still allocates an atlas and renders multi-segment markers, planned at full
  fidelity against its own context's limit, because no live plan exists to cap it

#### Scenario: The declared export dimension limit is truthful

- **WHEN** a device reports a texture limit below the configured maximum export dimension
- **THEN** the export's enforced maximum is the device's limit, and its rejection message names the
  limit actually enforced
