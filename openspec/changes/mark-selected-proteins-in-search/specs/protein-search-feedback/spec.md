## ADDED Requirements

### Requirement: Protein search shows already-selected proteins as marked suggestions

The protein search SHALL include already-selected protein IDs in the suggestion list, visually marked as selected, rather than omitting them. Selected and selectable entries SHALL draw from independent display budgets so that selectable entries remain visible regardless of how many matches are already selected. The selected-entry display budget SHALL be 10 rows.

#### Scenario: Every prefix match is already selected

- **WHEN** a user searches a partial ID whose every available match is already selected
- **THEN** up to the first 10 matching proteins in available-protein order are listed and marked as selected
- **AND** additional selected matches beyond that display budget are not rendered
- **AND** the feedback does not display `No matching protein IDs found`

#### Scenario: Selected ID is a strict prefix of unselected IDs

- **WHEN** a user searches an ID that is already selected and is also a strict prefix of other unselected IDs
- **THEN** the selected protein is listed and marked
- **AND** the unselected proteins remain listed and selectable

#### Scenario: Selected protein is searched using different letter case

- **WHEN** a user searches an available selected protein ID using different letter case
- **THEN** the protein is listed and marked as selected

#### Scenario: Selections are visible on an empty focused input

- **WHEN** a user focuses the search input with an empty query
- **THEN** current selections are listed and marked alongside the selectable entries

### Requirement: Activating a marked suggestion removes that protein

The protein search SHALL remove a protein from the selection when its marked suggestion is activated by click or by Enter, and SHALL preserve the current query so that further proteins can be removed from the same result set.

#### Scenario: Marked suggestion is clicked

- **WHEN** a user clicks a suggestion marked as already selected
- **THEN** that protein is removed from the selection
- **AND** the query is preserved and the row becomes selectable

#### Scenario: Marked suggestion is activated by keyboard

- **WHEN** a user presses Enter on a highlighted suggestion marked as already selected
- **THEN** that protein is removed from the selection

### Requirement: The suggestion list is navigable by assistive technology

The protein search SHALL expose the suggestion list as a multi-selectable listbox owned by the input, so that `aria-selected` denotes membership of the protein selection and the keyboard cursor is conveyed separately by `aria-activedescendant`.

#### Scenario: Keyboard cursor moves between suggestions

- **WHEN** a user moves the highlight with the arrow keys
- **THEN** the input's `aria-activedescendant` names the highlighted row
- **AND** `aria-selected` continues to reflect only whether each protein is in the selection

#### Scenario: Dropdown closes

- **WHEN** the suggestion dropdown closes
- **THEN** the input reports `aria-expanded` as false
- **AND** the input exposes no `aria-activedescendant`

### Requirement: Generic no-match feedback remains available

The protein search SHALL show generic no-match feedback only when a non-empty query matches no available protein ID at all.

#### Scenario: Query matches nothing

- **WHEN** a non-empty query prefix-matches no available protein ID
- **THEN** the search feedback displays `No matching protein IDs found`
