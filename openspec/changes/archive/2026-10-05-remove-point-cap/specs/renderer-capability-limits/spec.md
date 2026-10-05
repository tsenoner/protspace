## RENAMED Requirements

- FROM: `### Requirement: Buffer capacity SHALL be bounded by the renderer's own point cap`
- TO: `### Requirement: Buffer capacity SHALL be bounded by what the device can draw`

## MODIFIED Requirements

### Requirement: Buffer capacity SHALL be bounded by what the device can draw

The renderer SHALL bound planned buffer capacity by the device bound: the smaller of its drawable
limit (2^26 points, set by its widest vertex buffer) and one mark texel per point
(`MAX_TEXTURE_SIZE²`). Geometric growth across reloads within a session SHALL NOT allocate past
it. The bound SHALL NOT reduce capacity below the amount a single load actually requires.

#### Scenario: Geometric growth cannot overshoot the device bound

- **WHEN** a session loads a dataset just under the device bound and then another slightly larger
  one, so that 1.5x growth would exceed it
- **THEN** planned capacity is bounded at the device bound rounded up to allocation granularity

#### Scenario: A load larger than the mark texture is not starved

- **WHEN** capacity is planned for a point count above `MAX_TEXTURE_SIZE²` and within the drawable
  limit
- **THEN** the planner returns enough capacity for that point count
- **AND** the marks are staged with the other styles instead of the mark texture

## ADDED Requirements

### Requirement: A dataset past the drawable limit SHALL be refused, not truncated

The renderer SHALL draw every point it is handed, up to its drawable limit of 2^26 points. Past
it, the renderer SHALL draw none of them, allocate nothing for them, and report the point count
and the limit through the host-message channel, which the application surfaces as a "Too many
points to draw" warning. The renderer SHALL NOT draw a subset of a dataset.

#### Scenario: Every point of a dataset within the limit is drawn

- **WHEN** a dataset within the drawable limit is loaded
- **THEN** the number of points drawn equals the number of points handed to the renderer

#### Scenario: A dataset past the limit is refused with an explanation

- **WHEN** a dataset holds more points than the drawable limit
- **THEN** nothing is drawn and no point buffer is allocated
- **AND** a warning naming the point count and the limit is surfaced once, and later renders
  neither repeat it nor retry the allocation

#### Scenario: The next dataset that fits is drawn as usual

- **WHEN** a dataset within the limit is loaded after one that was refused
- **THEN** it is staged and drawn in full

## REMOVED Requirements

### Requirement: The loader and the renderer SHALL share one point cap

**Reason**: The renderer no longer clamps, so there is no cap to share. Format v3 bundles have no
row limit: their reader bounds each part's allocation by the part's byte size.

**Migration**: "A dataset past the drawable limit SHALL be refused, not truncated" replaces the
renderer side. Legacy v1/v2 bundles keep a 2,000,000-row guard (proteins x projections) as a loader
limit of their own, whose error tells the user to run `protspace convert`.
