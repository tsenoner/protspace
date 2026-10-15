## ADDED Requirements

### Requirement: Automatic loads preserve dataset display settings

The explore view SHALL restore a dataset's saved display settings, including its picked Shape size,
when the demo or an example loads without the user choosing it from the Import menu: on startup,
from a reload, from a deep link, or from Back/Forward navigation.

#### Scenario: In-place projection change retains Shape size

- **WHEN** a user saves a non-default Shape size and changes projection without reloading the dataset
- **THEN** the Shape size and its effective rendered point size remain unchanged

#### Scenario: Direct projection URL restores Shape size

- **WHEN** a user saves a non-default Shape size and opens a projection URL for the same dataset with
  another annotation selected
- **THEN** the Shape size and its effective rendered point size match the saved setting

#### Scenario: Reload after projection change restores Shape size

- **WHEN** a user saves a non-default Shape size, changes projection, and reloads the explore page
- **THEN** the Shape size and its effective rendered point size match the saved setting

#### Scenario: Back/Forward to an example restores its settings

- **WHEN** a user saves a Shape size on an example, opens another example from the Import menu, and
  goes Back
- **THEN** the first example's saved settings and Shape size apply

#### Scenario: A bundle's shape size does not replace a saved one on an automatic load

- **WHEN** a user saves a Shape size for a dataset whose bundle carries a top-level `shapeSize`, and
  the dataset loads again automatically
- **THEN** the saved Shape size applies, not the bundle's

#### Scenario: Silent URL restores saved tooltip selection

- **WHEN** an automatic load has a saved tooltip-annotation selection and the URL does not specify
  `tooltip`
- **THEN** the saved tooltip-annotation selection is restored

### Requirement: Persistence components share complete dataset identity

The dataset controller and legend SHALL derive the same persistence identity from display-relevant
dataset fields, including EAT prediction cells.

#### Scenario: EAT-backed dataset restores the controller-keyed legend record

- **GIVEN** a dataset contains `annotation_predicted` values
- **WHEN** the controller preserves a legend record during an automatic load
- **THEN** the legend reads and writes that record under the same dataset hash

### Requirement: A menu choice resets an example to its bundle's settings

The explore view SHALL clear an example's saved display settings and apply its bundle's settings
when the user chooses it from the Import menu.

#### Scenario: Choosing the demo from the Import menu restores its defaults

- **WHEN** the user chooses the demo from **Import → Examples**
- **THEN** its saved legend display settings and Shape size are cleared
- **AND** the demo uses the legend display settings of its bundle

### Requirement: Imported settings retain precedence

The explore view SHALL continue to replace local persisted display settings with settings embedded
in a user-imported dataset bundle.

#### Scenario: Import bundle with settings

- **WHEN** a user imports a dataset bundle containing legend settings
- **THEN** the embedded legend settings are applied instead of stale local settings for that dataset
