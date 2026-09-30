## MODIFIED Requirements

### Requirement: Overlay coalesces categories without mutating curated data

When the overlay is enabled and an EAT base annotation is active, the effective category SHALL be
the curated value when present and otherwise the transferred value. Observed cells SHALL remain
filled. Transferred cells SHALL use the same category mapping but render as hollow, anti-aliased
markers with a clearly legible, bounded outline that remains responsive to point size while
preserving a visible hollow interior. The interior SHALL use an opaque plot-surface knockout so
overlapping observed or transferred markers cannot fill the hollow cue by showing through it.
Multi-valued transferred cells SHALL retain every decoded label and use the existing multi-label
marker segmentation. Disabling the overlay SHALL return transferred cells to their curated missing
category.

#### Scenario: Observed and transferred category share a hue

- **WHEN** an observed protein and a transferred protein have the same effective category
- **THEN** both use the same legend category color while the observed marker is filled and the
  transferred marker is hollow

#### Scenario: Prediction-only category

- **WHEN** a transferred value is absent from all curated cells
- **THEN** the enabled overlay includes it in the effective legend and assigns it a stable category
  encoding without reordering existing observed categories

#### Scenario: Multi-valued transferred category

- **WHEN** a transferred companion cell contains two structural semicolon-separated labels
- **THEN** overlay materialization assigns both category indices to that protein
- **AND** live and exported markers use the existing multi-label segmentation with both hues

#### Scenario: Sparse multi-hit prediction at target scale

- **WHEN** a 500,000 to 1,000,000-row single-valued base has only a small number of multi-valued
  transferred cells
- **THEN** overlay materialization retains compact single-value storage and stores only those
  exceptional rows as multi-value overrides
- **AND** retained multi-value allocation grows with exceptional rows rather than total proteins

#### Scenario: Sparse multi-hit prediction disables incompatible shape selection

- **WHEN** overlay materialization stores a transferred protein with multiple category indices in a
  sparse override
- **THEN** the legend classifies the selected annotation as multi-label
- **AND** shape selection remains unavailable exactly as it does for dense multi-label annotations
- **AND** classification work scales with sparse overrides rather than total proteins

#### Scenario: Hollow outline remains legible across point sizes

- **WHEN** a user increases or decreases legend point size
- **THEN** the hollow transferred outline remains visibly thicker than the anti-alias fringe
- **AND** a visible hollow interior remains at the default and maximum supported sizes (10 and 64);
  at the smallest sizes the interior may fall below one device pixel
- **AND** its responsive thickness is bounded rather than required to scale linearly with marker
  diameter, with identical live and exported rendering at the same point scale

#### Scenario: Hollow cue survives overlapping markers

- **WHEN** a transferred marker is painted over one or more observed or transferred markers
- **THEN** its opaque plot-surface interior masks the earlier marker pixels
- **AND** the final composited live and exported marker remains visibly hollow
- **AND** the canonical painter order places transferred markers after ordinary markers within the
  same interaction tier while preserving selected points as the top tier
- **AND** transparent export keeps non-marker pixels transparent while retaining the live
  plot-surface colour inside transferred markers

#### Scenario: Overlay disabled

- **WHEN** the user disables the overlay
- **THEN** transferred proteins use their curated missing value and no point is flagged hollow by EAT

#### Scenario: Grayscale and image export

- **WHEN** the current view is rendered live, composited in grayscale, or exported to PNG
- **THEN** observed-versus-transferred distinction remains encoded by filled-versus-hollow geometry
