## ADDED Requirements

### Requirement: Filter query builder is opened from the control bar

The control bar SHALL expose a `Filter` button that opens the query-builder overlay (`role="dialog"`, `aria-label="Filter Query Builder"`) containing a `protspace-query-builder` element. Opening the builder when no query exists SHALL seed exactly one empty condition row.

#### Scenario: Opening the builder seeds an empty condition

- **WHEN** the user clicks the `Filter` button with no active query
- **THEN** the `Filter Query Builder` dialog becomes visible
- **AND** it contains one `protspace-query-condition-row`

### Requirement: A condition filters one annotation to a chosen set of values

Each condition row SHALL let the user choose an annotation (via the annotation picker) and add one or more of that annotation's values (via the value picker). The value picker SHALL list the annotation's values in a stable order derived from the annotation data (independent of the legend's reverse/manual-reorder display order — the builder can filter annotations that are not the selected one and have no legend), exclude already-selected values, and show a per-value match count. Numeric bins are identified in the picker by their internal id (e.g. `num:quantile:…`); tests map internal ids to friendly bin labels via `numericMetadata.bins`.

#### Scenario: Selecting an annotation and values

- **WHEN** the user opens a condition, selects an annotation, and adds a value from the value picker
- **THEN** the chosen value appears as a chip on the condition row
- **AND** the value is removed from the value-picker list (chips represent the active selection)

#### Scenario: Filter values stay in sync with current bins

- **WHEN** a numeric annotation is rebinned (bins change)
- **THEN** the value-picker lists exactly the current bins (stale bins are gone), as a set, regardless of legend display order

### Requirement: Apply & Isolate isolates the view to matched proteins

The query builder SHALL evaluate the query and, on `Apply & Isolate`, isolate the scatter-plot to the matched proteins via `isolateSelection()`. After applying, `getCurrentData().protein_ids` SHALL contain exactly the matched proteins, and the control bar SHALL mark the filter active. `Apply & Isolate` SHALL be disabled when the query is empty or matches zero proteins.

#### Scenario: Applying a single-annotation condition isolates the view

- **WHEN** the user sets a condition to one bin of a numeric annotation and clicks `Apply & Isolate`
- **THEN** `getCurrentData().protein_ids` contains exactly the proteins in that bin
- **AND** the `Filter Query Builder` dialog closes

#### Scenario: Zero-match query disables Apply & Isolate and leaves the view unchanged

- **WHEN** a query matches no proteins (e.g. two conjoined conditions with no overlap)
- **THEN** the match count reads `0 of N`, `Apply & Isolate` is disabled, and the view stays on the full dataset (it cannot be applied, so it neither isolates to empty nor falls back via a stale filter)

### Requirement: Reset All clears isolation

The query builder SHALL provide `Reset All`, which clears the active query, resets isolation (`resetIsolation()`), and marks the filter inactive while leaving the builder open for a new query.

#### Scenario: Reset restores the full dataset

- **WHEN** a filter is active and the user clicks `Reset All`
- **THEN** isolation is cleared and the full dataset is visible again

### Requirement: Loading a new dataset clears active filters

Loading a replacement dataset SHALL clear any active query-builder filter and isolation so the replacement renders unfiltered.

#### Scenario: Replacement dataset renders unfiltered

- **WHEN** a filter is active and a new dataset is loaded
- **THEN** the filter is inactive, isolation is cleared, and the full replacement dataset is visible

### Requirement: numeric-binning e2e suite passes against the query builder

The `numeric-binning` Playwright project SHALL drive the query-builder UI (not the removed `.filter-menu` DOM) and assert on the isolation model (not `filteredProteinIds`/`filtersActive`). All tests in the project SHALL pass.

#### Scenario: Full numeric-binning project is green

- **WHEN** `pnpm test:e2e --project=numeric-binning` is run against the shipped UI
- **THEN** every test passes
