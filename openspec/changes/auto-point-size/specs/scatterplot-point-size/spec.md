## RENAMED Requirements

- FROM: `### Requirement: The legend shape size SHALL default to 10 and never exceed 64`
- TO: `### Requirement: The legend shape size SHALL default from the dataset's protein count and never exceed 64`

## MODIFIED Requirements

### Requirement: The legend shape size SHALL default from the dataset's protein count and never exceed 64

The legend's default shape size SHALL be `clamp(round(10 · (10000 / N)^⅔), 1, 10)`, where `N` is
the number of proteins in the whole dataset, and SHALL be 10 when `N` is 0, negative or not finite.
`N` SHALL count every protein of the loaded dataset, so hiding categories, filtering or isolating
SHALL NOT change the default. The settings dialog SHALL accept whole sizes from 1 to 64 and SHALL
cap a larger entry at 64, showing the capped value. A larger size from a bundle, top-level or
per-annotation, or from browser storage SHALL be capped at 64 as well, and a capped top-level
bundle size SHALL be stored as 64. The dialog's size field SHALL show the size in use, and its
placeholder and hint SHALL give the dataset's default. Saving the dialog with the size field
emptied SHALL clear the shape size as Reset does, so the default applies, and SHALL keep the
annotation's other settings. The point size SHALL be `max(10, round(8 · shapeSize))`.

#### Scenario: Default for a small dataset

- **WHEN** a dataset of 5,000 proteins loads with no stored or bundled shape size
- **THEN** the shape size is 10 and dots are drawn at point size 80

#### Scenario: Default for a large dataset

- **WHEN** a dataset of 105,562 proteins loads with no stored or bundled shape size
- **THEN** the shape size is 2 and dots are drawn at point size 16

#### Scenario: Default for Swiss-Prot

- **WHEN** a dataset of 573,649 proteins loads with no stored or bundled shape size
- **THEN** the shape size is 1 and dots are drawn at point size 10

#### Scenario: Hiding categories or isolating

- **WHEN** the user hides categories of a 40,000-protein dataset, or isolates 1,000 of its proteins
- **THEN** the shape size stays 4, the default for 40,000 proteins

#### Scenario: The dialog names the default

- **WHEN** the user opens the legend settings on a 105,562-protein dataset without a picked size
- **THEN** the size field shows 2, and its placeholder and hint give 2 as the dataset's default

#### Scenario: Emptying the size field

- **WHEN** the user picked shape size 10 on a 40,000-protein dataset, then empties the size field
  and presses Save
- **THEN** no size is stored for the dataset and the dots return to the default shape size 4

#### Scenario: Oversized entry

- **WHEN** the user types 640 into the shape size field
- **THEN** 64 is applied and the field shows 64

#### Scenario: Oversized bundle size

- **WHEN** a bundle with a top-level `"shapeSize": 200` is imported
- **THEN** dots are drawn at shape size 64 (point size 512) and 64 is stored for the dataset

#### Scenario: Oversized stored size

- **WHEN** the browser holds a shape size of 200 for the dataset or the annotation
- **THEN** the legend loads it as 64

### Requirement: A picked shape size SHALL hold for every annotation of the dataset

A shape size the user picks SHALL be stored once per dataset in the browser and SHALL apply to every
annotation of that dataset. Until the user picks a size, an annotation's own stored or bundled size
SHALL apply, and without one the default from the dataset's protein count. Reset in the settings
dialog SHALL remove the dataset's stored size and every annotation's own size, stored or from a
bundle, so the whole dataset returns to its default, and SHALL NOT store that default. A
dataset-wide size stored before the default followed the protein count SHALL still apply, except a
stored 10, which the earlier Reset wrote as the default of the time: the legend SHALL then clear
every annotation's own stored size, once, as Reset does now.

#### Scenario: Switching annotations

- **WHEN** the user picks shape size 20 and then switches to another annotation
- **THEN** the dots stay at shape size 20

#### Scenario: Reloading

- **WHEN** the user reloads the page on the same dataset
- **THEN** the picked size is restored

#### Scenario: Reset

- **WHEN** the user picks shape size 20 on a 105,562-protein dataset and then presses Reset
- **THEN** no size is stored for the dataset and the dots return to shape size 2
- **AND** switching annotations keeps shape size 2

#### Scenario: A size stored before this change

- **WHEN** the browser holds a dataset-wide shape size of 7, stored before the default followed the
  protein count, for a 105,562-protein dataset
- **THEN** the dots are drawn at shape size 7

#### Scenario: A 10 stored by the earlier Reset

- **WHEN** the browser holds a dataset-wide shape size of 10, stored before the default followed the
  protein count, for a 105,562-protein dataset, and an annotation's record still holds the size 12
  picked before that Reset
- **THEN** every annotation, that one included, draws at the default shape size 2, and an export
  carries no top-level `shapeSize`

#### Scenario: Switching datasets

- **WHEN** the user opens a 5,000-protein dataset and then a 105,562-protein one, picking no size in
  either
- **THEN** the dots are drawn at shape size 10 and then at 2

### Requirement: Bundles SHALL carry a picked shape size as a top-level `shapeSize`

A bundle exported with legend settings SHALL carry a top-level `shapeSize` only when a size was
picked or applied from a bundle, and SHALL then also write that value into each annotation's
`shapeSize` for older readers. Otherwise each annotation's `shapeSize` SHALL be the annotation's own
size or the filler 10, never the default computed from the protein count. On import, a top-level
`shapeSize` SHALL override every per-annotation `shapeSize`. A per-annotation `shapeSize` of exactly
10 or 30, the fillers the writers emit, SHALL read as unset, so the default from the protein count
applies.

#### Scenario: Export after picking a size

- **WHEN** the user picks shape size 20 and exports a bundle with legend settings
- **THEN** the settings carry `"shapeSize": 20` at the top level and in every annotation's entry

#### Scenario: Export without picking a size

- **WHEN** the user exports a 105,562-protein dataset with legend settings without ever picking a
  size
- **THEN** the settings carry no top-level `shapeSize`, and each annotation's `shapeSize` is 10, not
  the default 2

#### Scenario: Import of a bundle with a top-level size

- **WHEN** a bundle with top-level `"shapeSize": 20` and a per-annotation `"shapeSize": 12` is
  imported
- **THEN** every annotation draws at shape size 20

#### Scenario: A bundle with its own per-annotation size

- **WHEN** a 105,562-protein bundle whose annotation stores `"shapeSize": 5` and no top-level size
  is imported
- **THEN** that annotation draws at shape size 5

#### Scenario: A CLI-written bundle

- **WHEN** a 105,562-protein bundle whose annotations store the filler `"shapeSize": 10` is imported
- **THEN** the dots are drawn at the default shape size 2

#### Scenario: A bundle written before this change

- **WHEN** a bundle whose annotations store `"shapeSize": 30` is imported
- **THEN** the dots are drawn at the default shape size for its protein count
