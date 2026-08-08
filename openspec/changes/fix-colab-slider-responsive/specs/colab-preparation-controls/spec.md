## ADDED Requirements

### Requirement: Parameter sliders remain usable in compressed notebook layouts

The preparation notebook SHALL lay out dimensionality-reduction parameter groups with a wrapping flex basis and minimum width of at least 300 px so a group's slider description and value readout cannot collapse its interactive track before or after the group wraps.

#### Scenario: Terminal compresses the notebook content area

- **WHEN** three parameter groups are visible and the notebook content area becomes too narrow to allocate at least 300 px to each group
- **THEN** the groups wrap onto another row
- **AND** each visible slider retains a usable horizontal track instead of collapsing to its thumb

#### Scenario: Pane becomes narrower than one parameter group

- **WHEN** the notebook content area becomes narrower than 300 px
- **THEN** each parameter group retains its minimum width
- **AND** the surrounding widget area can scroll horizontally instead of shrinking the slider track below its usable reserve

#### Scenario: Ordinary desktop notebook width

- **WHEN** the notebook content area can allocate at least 300 px to each of three visible groups
- **THEN** the groups remain on one row
- **AND** existing slider labels, values, and interactions remain unchanged
