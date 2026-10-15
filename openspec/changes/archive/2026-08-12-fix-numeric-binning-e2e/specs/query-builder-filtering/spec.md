## ADDED Requirements

### Requirement: Filter query builder is opened from the control bar

The control bar SHALL expose a `Filter` button that opens the query-builder overlay (`role="dialog"`, `aria-label="Filter Query Builder"`) containing a `protspace-query-builder` element. Opening the builder when no query exists SHALL seed exactly one empty condition row.

#### Scenario: Opening the builder seeds an empty condition

- **WHEN** the user clicks the `Filter` button with no active query
- **THEN** the `Filter Query Builder` dialog becomes visible
- **AND** it contains one `protspace-query-condition-row`

### Requirement: A condition filters one annotation by type-appropriate input

Each condition row SHALL let the user choose an annotation (via the annotation picker, whose items are keyed by the raw annotation name). The input rendered for the condition depends on the annotation type:

- **Categorical** annotations render a `protspace-query-value-picker`: the user adds one or more values, which appear as chips on the row; the picker lists the annotation's values in a stable order derived from the annotation data (independent of the legend's reverse/manual-reorder display order — the builder can filter categorical annotations that are not the selected one and have no legend), excludes already-selected values, and shows a per-value match count.
- **Numeric** annotations (including a numeric annotation materialized into legend bins, which keeps `sourceKind: 'numeric'`) render a `protspace-query-numeric-input`: an operator dropdown (`>`, `<`, `between`) plus one or two number fields (min/max). Numeric filtering matches **raw values** (not bins): `>` is `value > min`, `<` is `value < max`, `between` is `value >= min && value <= max`. There is no value picker and no bin list for numeric annotations; legend bins remain a display/coloring concern only.

#### Scenario: Selecting a categorical value

- **WHEN** the user opens a condition, selects a categorical annotation, and adds a value from the value picker
- **THEN** the chosen value appears as a chip on the condition row
- **AND** the value is removed from the value-picker list (chips represent the active selection)

#### Scenario: Setting a numeric range

- **WHEN** the user opens a condition, selects a numeric annotation, chooses an operator, and enters the required bound(s)
- **THEN** the condition matches the proteins whose raw value satisfies the operator/bounds
- **AND** a live match count is shown once the condition has its required bound(s)

### Requirement: Applying a filter isolates the view to matched proteins

The query builder SHALL evaluate the query and, on the primary `Apply` action, drive the scatter-plot's dedicated filter channel: the matched protein ids are written to `filteredProteinIds`, `filtersActive` is set, and the control bar marks `filterActive`. After applying, `getCurrentData().protein_ids` SHALL contain exactly the matched proteins (the plot data is physically culled to the matched set) and the dialog SHALL close. The primary `Apply` button SHALL be disabled when the query has no configured condition, matches zero proteins, or matches the entire dataset.

#### Scenario: Applying a single-condition filter

- **WHEN** the user sets one condition (e.g. a numeric `between` range) and clicks `Apply`
- **THEN** `getCurrentData().protein_ids` contains exactly the proteins matching the condition
- **AND** the control bar reports `filterActive`
- **AND** the `Filter Query Builder` dialog closes

#### Scenario: Zero-match query disables Apply and leaves the view unchanged

- **WHEN** a query matches no proteins (e.g. a numeric range above every value)
- **THEN** the match count reads `0 of N`, the primary `Apply` button is disabled, and the view stays on the full dataset (it cannot be applied, so it neither collapses to empty nor falls back via a stale filter)

### Requirement: Reset All clears the active filter

The query builder SHALL provide `Reset All`, which clears the active query, clears the filter channel (`filteredProteinIds = []`, `filtersActive = false`, control-bar `filterActive = false`), and seeds a fresh empty condition while leaving the builder open for a new query.

#### Scenario: Reset restores the full dataset

- **WHEN** a filter is active and the user clicks `Reset All`
- **THEN** the filter is cleared and the full dataset is visible again

### Requirement: Loading a new dataset clears active filters

Loading a replacement dataset SHALL clear any active query-builder filter so the replacement renders unfiltered.

#### Scenario: Replacement dataset renders unfiltered

- **WHEN** a filter is active and a new dataset is loaded
- **THEN** `filterActive` is false and the full replacement dataset is visible

### Requirement: numeric-binning e2e suite passes against the query builder

The `numeric-binning` Playwright project SHALL drive the shipped query-builder UI — the numeric operator+range input for numeric annotations and the value picker for categorical annotations — and assert on the filter model (`getCurrentData().protein_ids` subset and control-bar `filterActive`), not the removed `.filter-menu` DOM or numeric bin value-picker. All tests in the project SHALL pass.

#### Scenario: Full numeric-binning project is green

- **WHEN** `pnpm test:e2e --project=numeric-binning` is run against the shipped UI
- **THEN** every test passes
