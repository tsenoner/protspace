## RENAMED Requirements

- FROM: `### Requirement: Filter query builder is opened from the control bar`
- TO: `### Requirement: Filter queries are built in the Filter panel`
- FROM: `### Requirement: Reset All clears the active filter`
- TO: `### Requirement: Reset clears the active filter`

## MODIFIED Requirements

### Requirement: Filter queries are built in the Filter panel

The view bar's Filter button SHALL open the sidebar's Filter panel in place of the legend and move
focus to the panel's "Filter" heading; it SHALL never close the panel, and opening it SHALL NOT
resize the plot. On a desktop the rail's Filter item SHALL open the panel too and show as pressed
while it is open, and the panel's "Close filter" button SHALL return to the legend with focus on the
rail's Filter item; below 951 px the panel is the Filter tab (explore-mobile-layout). The panel
SHALL hold the `protspace-query-builder` element under its own heading, with no title or close
button of the builder's own, and SHALL show exactly one empty condition row while no filter is
applied. Which panel is open is part of the stored layout; the filter itself is not stored.

#### Scenario: Opening the panel seeds an empty condition

- **WHEN** the user clicks the view bar's `Filter` button with no applied filter
- **THEN** the Filter panel is shown in place of the legend, its heading has focus, and it contains
  one `protspace-query-condition-row`
- **AND** the plot is not resized

#### Scenario: The rail's Filter and Close filter

- **WHEN** the user opens the Filter panel from the rail and then presses "Close filter"
- **THEN** the rail's Filter item shows as pressed while the panel is open, and afterwards the
  legend is shown again with focus on the rail's Filter item

#### Scenario: A reload keeps the panel, not the filter

- **WHEN** a filter is applied and the page is opened again
- **THEN** the Filter panel is still the one shown, with one empty condition row and no filter
  applied

### Requirement: Applying a filter isolates the view to matched proteins

The query builder SHALL evaluate the query and, on the primary `Apply` action, drive the
scatter-plot's dedicated filter channel: the matched protein ids are written to
`filteredProteinIds` and `filtersActive` is set. The view bar's Filter button SHALL then show the
number of applied conditions (its accessible name reads, for example, "Filter, 1 condition
applied"), the rail's Filter item SHALL show a dot, and the plot SHALL show the filter's status chip
(selection-workflow). After applying, `getCurrentData().protein_ids` SHALL contain exactly the
matched proteins (the plot data is physically culled to the matched set), and the Filter panel
SHALL stay open, its draft now equal to the applied filter. The primary `Apply` button SHALL be
disabled when the query has no configured condition, matches zero proteins, matches the entire
dataset, or equals the filter already applied.

#### Scenario: Applying a single-condition filter

- **WHEN** the user sets one condition (e.g. a numeric `between` range) and clicks `Apply`
- **THEN** `getCurrentData().protein_ids` contains exactly the proteins matching the condition
- **AND** the plot's `filtersActive` is set and the Filter button reads "Filter, 1 condition
  applied"
- **AND** the Filter panel stays open, and Apply is disabled with "No changes to apply"

#### Scenario: Zero-match query disables Apply and leaves the view unchanged

- **WHEN** a query matches no proteins (e.g. a numeric range above every value)
- **THEN** the match count reads `0 of N proteins match`, the primary `Apply` button is disabled
  with the reason "No proteins match", and the view stays on the full dataset (it cannot be
  applied, so it neither collapses to empty nor falls back via a stale filter)

### Requirement: Reset clears the active filter

The query builder SHALL provide `Reset`, which clears the applied filter and the draft (the filter
channel is released: `filteredProteinIds = []`, `filtersActive = false`; the Filter button's count,
the rail's dot and the filter chip go), and seeds a fresh empty condition while leaving the panel
open for a new query. A Reset that removed an applied filter SHALL be one step of the undo history,
so Undo brings the filter back; a Reset with nothing applied records nothing.

#### Scenario: Reset restores the full dataset

- **WHEN** a filter is active and the user clicks `Reset`
- **THEN** the filter is cleared and the full dataset is visible again
- **AND** the panel stays open with one empty condition row

#### Scenario: Undo after Reset

- **WHEN** the user resets an applied filter and then chooses Undo
- **THEN** the filter is applied again, with its status chip and its condition count

### Requirement: Loading a new dataset clears active filters

Loading a replacement dataset SHALL clear any active query-builder filter and its draft, so the
replacement renders unfiltered and the Filter panel shows one empty condition row.

#### Scenario: Replacement dataset renders unfiltered

- **WHEN** a filter is active and a new dataset is loaded
- **THEN** the plot's `filtersActive` is false and the full replacement dataset is visible

### Requirement: numeric-binning e2e suite passes against the query builder

The `numeric-binning` Playwright project SHALL drive the shipped query-builder UI — the numeric
operator+range input for numeric annotations and the value picker for categorical annotations — in
the Filter panel, and assert on the filter model (`getCurrentData().protein_ids` subset and the
plot's `filtersActive`), not the removed `.filter-menu` DOM or numeric bin value-picker. All tests
in the project SHALL pass.

#### Scenario: Full numeric-binning project is green

- **WHEN** `pnpm test:e2e --project=numeric-binning` is run against the shipped UI
- **THEN** every test passes

## ADDED Requirements

### Requirement: The Filter panel edits a draft that Apply commits and Cancel discards

Edits in the Filter panel SHALL change a draft only: neither the plot nor the legend changes until
Apply. Apply SHALL make the draft the applied filter. `Cancel` SHALL be enabled only while the draft
differs from the applied filter, and SHALL return the draft to it, or to one empty condition row
while no filter is applied. Removing the filter elsewhere (the filter chip's ✕) SHALL leave a
changed draft as it is and reset an unchanged one to one empty row.

#### Scenario: An edit waits for Apply

- **WHEN** the user adds a value to a condition and does not press Apply
- **THEN** the plot's filter channel is unchanged

#### Scenario: Cancel restores the applied filter

- **WHEN** a filter is applied, the user adds a second condition, and presses Cancel
- **THEN** the draft holds the applied filter's one condition again, Cancel is disabled, and the
  filter stays applied

#### Scenario: Removing the filter with a changed draft

- **WHEN** the draft differs from the applied filter and the filter is removed from its chip
- **THEN** the filter is removed and the draft keeps its edits

### Requirement: A disabled Apply says why

While Apply is disabled the panel SHALL show the reason under the match count, and the Apply button
SHALL be described by it: "Add a condition" when no row is configured; "Choose an annotation for
condition N" for a negated row without an annotation; "Choose a value for condition N" or "Enter a
number for condition N" for a row with an annotation but nothing to match, numbering conditions in
display order with groups' conditions included; "No changes to apply" when the draft equals the
applied filter; "No proteins match" and "Every protein matches; nothing to filter" for the counts.
While a count is pending no reason SHALL show, so a stale count is never quoted.

#### Scenario: An incomplete row

- **WHEN** the first condition has a categorical annotation and no value
- **THEN** the reason reads "Choose a value for condition 1" and Apply is disabled

#### Scenario: Apply is described by its reason

- **WHEN** Apply is disabled
- **THEN** its accessible description is the visible reason

### Requirement: The panel counts the matches as the query changes

The Filter panel SHALL show, in a status region, how many proteins the draft keeps as
"<n> of <N proteins> match", counted over the whole loaded dataset, and SHALL count again after each
edit, once typing pauses. The builder SHALL count only while the panel is on screen; a panel that
comes on screen SHALL count the latest data and draft.

#### Scenario: The count follows an edit

- **WHEN** the panel opens on the seeded empty row and the user then sets a categorical condition
- **THEN** the count first reads the whole dataset's size, then a smaller number, ending in
  "proteins match" or "protein match"

#### Scenario: A hidden panel does not count

- **WHEN** the data changes while the Filter panel is not shown, and the panel is then opened
- **THEN** the builder received no data while hidden, and gets the latest when it is shown
