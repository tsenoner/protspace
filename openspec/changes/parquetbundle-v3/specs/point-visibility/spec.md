## ADDED Requirements

### Requirement: Points without finite coordinates SHALL be culled when plot data is built

The system SHALL remove every point whose coordinates in the selected projection are not all
finite, at the single step that builds plot data from a projection, alongside the query-filter and
isolation culls. No consumer SHALL draw, hit-test, lasso, brush, contour, stack, depth-sort, export or include in the scale domains a point with a non-finite
coordinate, and none SHALL depend on a finiteness check of its own to achieve this. A culled protein SHALL stay in the
dataset (`protein_ids`, annotation arrays, legend counts, search).

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
