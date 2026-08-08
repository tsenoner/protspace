## ADDED Requirements

### Requirement: Automatic projection navigation preserves dataset display settings

The explore view SHALL restore dataset-scoped display settings when projection navigation or a
browser reload causes a fresh controller to load the same default dataset automatically.

#### Scenario: In-place projection change retains Shape size

- **WHEN** a user saves a non-default Shape size and changes projection without reloading the dataset
- **THEN** the Shape size and its effective rendered point size remain unchanged

#### Scenario: Direct projection URL restores Shape size

- **WHEN** a user saves a non-default Shape size and opens a projection URL for the same default
  dataset in a fresh explore controller
- **THEN** the Shape size and its effective rendered point size match the saved setting

#### Scenario: Reload after projection change restores Shape size

- **WHEN** a user saves a non-default Shape size, changes projection, and reloads the explore page
- **THEN** the Shape size and its effective rendered point size match the saved setting

#### Scenario: Silent URL restores saved tooltip selection

- **WHEN** a fresh automatic load has a saved tooltip-annotation selection and the URL does not
  specify `tooltip`
- **THEN** the saved tooltip-annotation selection is restored

### Requirement: Persistence components share complete dataset identity

The dataset controller and legend SHALL derive the same persistence identity from display-relevant
dataset fields, including EAT prediction cells.

#### Scenario: EAT-backed dataset restores the controller-keyed legend record

- **GIVEN** a dataset contains `annotation_predicted` values
- **WHEN** the controller preserves a legend record during an automatic load
- **THEN** the legend reads and writes that record under the same dataset hash

### Requirement: Explicit demo reset clears dataset display settings

The explore view SHALL clear persisted dataset display settings when the user explicitly resets to
the demo dataset after a dataset is already active.

#### Scenario: Reset to demo restores defaults

- **WHEN** a dataset is active and the user explicitly resets to the demo dataset
- **THEN** persisted custom legend display settings are cleared
- **AND** the demo dataset uses its default legend display settings

### Requirement: Imported settings retain precedence

The explore view SHALL continue to replace local persisted display settings with settings embedded
in a user-imported dataset bundle.

#### Scenario: Import bundle with settings

- **WHEN** a user imports a dataset bundle containing legend settings
- **THEN** the embedded legend settings are applied instead of stale local settings for that dataset
