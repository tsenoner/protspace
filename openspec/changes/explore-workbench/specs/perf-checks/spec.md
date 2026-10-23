## MODIFIED Requirements

### Requirement: A segment's reset SHALL restore the plot's pixels

Every segment that changes view state SHALL end with a reset through the UI, and a screenshot of the
plot taken before the segment SHALL equal one taken after the reset. The segments SHALL run in a
browser context with the default layout and the light theme stored and a light colour scheme, so
the plot's size and colours are the same in every run, and the theme segment's reset SHALL return
the page to light.

#### Scenario: A projection switch and back

- **WHEN** the projection is switched and switched back
- **THEN** the plot's pixels match the ones before the switch

#### Scenario: Collapsing the sidebar and back

- **WHEN** the sidebar is collapsed and expanded again
- **THEN** the plot's pixels match the ones before the collapse

#### Scenario: Dark and back

- **WHEN** the page is switched to the dark theme and back to light
- **THEN** the plot's pixels match the ones before the switch

## ADDED Requirements

### Requirement: The counts gate budgets the layout, theme and hover segments

`pnpm perf:counts` SHALL include a `panel-toggle` segment that collapses the sidebar (its reset
expands it), a `panel-expand` segment that expands a collapsed sidebar, a `theme-switch` segment
that sets the dark theme (its reset sets light), and a `hover` segment that moves the pointer over
several points. Their budgets SHALL be: `panel-toggle` and `panel-expand` one render and one
point-grid rebuild, with no re-stage, data processing, legend update or upload; `theme-switch` one
render and nothing else; `hover` nothing at all, renders included.

#### Scenario: Collapsing the sidebar

- **WHEN** the panel-toggle segment collapses the sidebar
- **THEN** the counters record one render and one grid rebuild, and nothing re-stages

#### Scenario: Switching to dark

- **WHEN** the theme-switch segment sets the dark theme
- **THEN** the counters record one render, and no re-stage, data processing or grid rebuild

#### Scenario: Hovering points

- **WHEN** the hover segment moves the pointer over several points
- **THEN** every counter stays at zero, renders included
