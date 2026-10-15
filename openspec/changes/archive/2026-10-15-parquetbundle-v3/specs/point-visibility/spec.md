## ADDED Requirements

### Requirement: Points without finite coordinates SHALL be culled when plot data is built

The system SHALL remove every point whose coordinates in the selected projection are not all
finite, at the single step that builds plot data from a projection, alongside the query-filter and
isolation culls. No consumer SHALL draw, hit-test, lasso, brush, contour, stack, depth-sort, export or include in the scale domains a point with a non-finite
coordinate, and none SHALL depend on a finiteness check of its own to achieve this. A culled protein SHALL stay in the
dataset (`protein_ids`, annotation arrays, legend counts, search), and in isolation mode it SHALL
stay in the isolated subset: isolation is membership in the isolation layers, never the set of
points the selected projection places.

#### Scenario: A protein missing from the selected projection

- **WHEN** protein `P` has NaN coordinates in the selected projection
- **THEN** `P` is absent from the plot data, is not drawn, is not returned by hover, click, brush or
  lasso, and does not contribute to the density contours

#### Scenario: Scale domains ignore the missing point

- **WHEN** plot data is built for a projection where some proteins have NaN coordinates
- **THEN** the scale domains are computed from the finite points only, and no point is drawn at the
  position of `(0, 0)` on their behalf

#### Scenario: Switching between a complete and an incomplete projection

- **WHEN** the user switches from projection `A`, where `P` has coordinates, to projection `B`,
  where it does not, and back
- **THEN** `P` disappears in `B` and reappears in `A`, and no stale coordinate from the other
  projection is drawn for it

#### Scenario: Exports omit the missing point

- **WHEN** an image is exported while `P` is culled
- **THEN** the exported image contains no marker for `P`

#### Scenario: A culled protein stays in the dataset

- **WHEN** `P` is culled from the selected projection but has coordinates in another
- **THEN** `P` is still counted in its legend category and can be found by search

#### Scenario: An isolated protein the selected projection does not place

- **WHEN** `P` and `Q` are isolated in projection `A` and the user switches to projection `B`,
  which does not place `P`
- **THEN** the current data (the `.parquetbundle` export and the legend counts) still holds `P`,
  with its annotations and its coordinates in `A`, and an isolated subset of which `B` places no
  point is still that subset, not the whole dataset

#### Scenario: Isolating a selection the selected projection does not fully place

- **WHEN** `P` and `Q` are selected in projection `A`, the user switches to `B`, which does not
  place `P`, and isolates the selection
- **THEN** the isolation layer holds `P` and `Q`, and `P` is drawn again on the way back to `A`

#### Scenario: Isolating proteins of which the selected projection places one

- **WHEN** `P`, `Q` and `R` are selected in projection `A`, the user switches to `B`, which
  places only `R`, and isolates the selection
- **THEN** selection mode stays available, since the isolated subset holds three proteins, and
  the isolation reports that size

## MODIFIED Requirements

### Requirement: Single source of truth for display state

The system SHALL compute per-point display state (tier `hidden | faded | base |
selected`, numeric opacity, base opacity, interactivity) in exactly one pure module, and
every consumer (style getters, point grid construction, hover, click, brush, lasso) SHALL
read that module rather than re-deriving visibility. Category focus (Shift + hover) SHALL
be an input to that module, not a separate opacity path.

#### Scenario: All consumers agree

- **WHEN** any combination of legend-hide, selection, highlight, and category-focus state
  is active
- **THEN** the opacity used for rendering, the points indexed by the point grid, and the
  points accepted by hover/click/brush/lasso hit-tests are all derived from the same
  model and can never disagree

### Requirement: Hidden points have exactly zero opacity

The system SHALL assign opacity exactly `0` (not merely a small value) to
annotation-hidden points: consumers gate with a mix of comparisons (`=== 0` at export
culling and hover/click, `> 0` at tracking and the point grid, `< 0.001` at the shader
discard) that agree on "invisible and non-interactive" only at exactly `0`.

#### Scenario: Hidden value yields exact zero

- **WHEN** every annotation value of a point is in the hidden set (after normalization)
  and not all values of the selected annotation are hidden
- **THEN** the model's opacity for that point is exactly `0`

### Requirement: Interactivity is numeric opacity, evaluated at event time

The system SHALL define interactivity as `opacity > 0` using the configured opacity
values (a `fadedOpacity` of `0` makes faded points non-interactive), and SHALL evaluate
it against current inputs at event time so hit-testing is correct even while the
point grid rebuild is rAF-deferred. The renderer-capacity gate (`isPointRendered`) remains
a separate check outside the model.

#### Scenario: Faded points are clickable under default config

- **WHEN** a selection is active and `fadedOpacity` is the default `0.15`
- **THEN** faded points respond to hover, click, brush, and lasso

#### Scenario: Hidden points are not clickable

- **WHEN** a point's opacity is `0`
- **THEN** it is excluded from the point grid and rejected by hover/click/brush/lasso even
  during the one-frame point grid staleness window
