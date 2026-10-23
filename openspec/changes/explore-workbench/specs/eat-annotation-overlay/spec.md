## MODIFIED Requirements

### Requirement: EAT overlay controls are conditional, accessible, and persisted

For datasets with normalized EAT cells, the annotation selector SHALL mark every base annotation
that has transferred values. When one of those bases is selected, the transferred-annotation legend
SHALL provide an EAT overlay switch and native range plus numeric percentage threshold controls
beside the observed/transferred population key. The range and numeric controls SHALL represent one
value and remain synchronized. The accessible group SHALL default to overlay enabled and threshold
`0` — every prediction shown and the filter box clean — and its threshold SHALL mirror two-way with
the applied `EAT_confidence >= x or N/A` query filter (`eat-reliability-filter` states how a draft
open in the Filter panel follows it). The complete control SHALL be absent when the selected
annotation has no usable EAT cells, including confidence-view and non-EAT selections. Optional
`eatOverlayEnabled` and `eatConfidenceThreshold` bundle settings SHALL validate, normalize, write
even when they are the only settings, and on dataset load seed the slider (which derives the filter
condition only above `0`).

#### Scenario: EAT-capable dataset

- **WHEN** a dataset with normalized EAT cells loads without embedded EAT settings
- **THEN** the switch is enabled and on, the threshold is `0%`, and both controls have accessible
  names and keyboard behavior
- **AND** the controls are contained by an accessible EAT-labelled group
- **AND** the group is rendered inside the transferred-annotation legend section

#### Scenario: EAT annotations are discoverable

- **WHEN** the annotation selector opens for a dataset containing transfers for `ec` and
  `protein_families`
- **THEN** both base rows expose a text-labelled EAT marker to sighted and assistive-technology
  users
- **AND** ordinary annotations and generated confidence views do not receive that marker

#### Scenario: Range and percentage entry stay synchronized

- **WHEN** the user changes either the threshold slider or the bounded `0` to `100` percentage
  input
- **THEN** the other control reflects the same normalized threshold
- **AND** one `eat-overlay-change` contract drives the shared reliability query filter

#### Scenario: Selected annotation has no transfers

- **WHEN** an EAT-capable dataset selects a base without transferred cells or a generated
  confidence view
- **THEN** the complete EAT control group is absent without leaving responsive-grid spacing

#### Scenario: Constrained view temporarily has no transferred rows

- **WHEN** filtering or isolation reduces an EAT-capable dataset to a population with no predicted
  rows
- **THEN** capable annotation markers and selected-base EAT controls remain available from the
  stable loaded dataset
- **AND** population counts and rendering still reflect only the constrained view

#### Scenario: Dataset without EAT

- **WHEN** a dataset without normalized EAT cells loads
- **THEN** the complete EAT control group is absent from the rendered DOM and accessibility tree
- **AND** no empty group spacing or orphaned EAT label remains

#### Scenario: Embedded settings omit the optional threshold

- **WHEN** bundle settings are present but omit `eatConfidenceThreshold`
- **THEN** restore uses `DEFAULT_EAT_CONFIDENCE_THRESHOLD` rather than a separate literal fallback

#### Scenario: Embedded settings round-trip

- **WHEN** a bundle is exported with overlay disabled and threshold `0.75`, then reloaded
- **THEN** the overlay is restored disabled and the reliability slider seeds `0.75`, deriving its
  `EAT_confidence >= 0.75 or N/A` query filter

#### Scenario: Embedded settings restore from OPFS

- **WHEN** a persisted bundle with overlay disabled and threshold `0.75` is replayed from OPFS
- **THEN** its normalized embedded EAT settings override dataset-reset defaults in both the reliability
  slider and its shared query filter
- **AND** settings absent from the bundle retain the enabled and `0` defaults

#### Scenario: Invalid optional setting

- **WHEN** an otherwise valid settings object contains a non-boolean overlay flag or a threshold
  outside `[0,1]`
- **THEN** normalization drops the invalid optional value and retains the valid settings object

### Requirement: Overlay coalesces categories without mutating curated data

When the overlay is enabled and an EAT base annotation is active, the effective category SHALL be
the curated value when present and otherwise the transferred value. Observed cells SHALL remain
filled. Transferred cells SHALL use the same category mapping but render as hollow, anti-aliased
markers with a clearly legible, bounded outline that remains responsive to point size while
preserving a visible hollow interior. The interior SHALL use an opaque plot-surface knockout so
overlapping observed or transferred markers cannot fill the hollow cue by showing through it. The
knockout SHALL be the plot's background on screen, which follows the theme, and white in every
export, since exports are always light.
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
- **AND** a visible hollow interior remains at shape sizes 10 and 64, the default for datasets of up
  to 10,000 proteins and the maximum; at the smallest sizes, the default on the largest datasets,
  the interior may fall below one device pixel
- **AND** its responsive thickness is bounded rather than required to scale linearly with marker
  diameter, with identical live and exported rendering at the same point scale

#### Scenario: Hollow cue survives overlapping markers

- **WHEN** a transferred marker is painted over one or more observed or transferred markers
- **THEN** its opaque plot-surface interior masks the earlier marker pixels
- **AND** the final composited live and exported marker remains visibly hollow
- **AND** the canonical painter order places transferred markers after ordinary markers within the
  same interaction tier while preserving selected points as the top tier
- **AND** transparent export keeps non-marker pixels transparent while filling transferred markers'
  interiors with white, the light plot surface every export uses

#### Scenario: Overlay disabled

- **WHEN** the user disables the overlay
- **THEN** transferred proteins use their curated missing value and no point is flagged hollow by EAT

#### Scenario: Grayscale and image export

- **WHEN** the current view is rendered live, composited in grayscale, or exported to PNG
- **THEN** observed-versus-transferred distinction remains encoded by filled-versus-hollow geometry

### Requirement: Reliability threshold filters sub-threshold predictions

The reliability threshold SHALL hide predictions whose transferred confidence is below its position
by driving a shared `EAT_confidence >= x or N/A` query-filter condition, not by dimming points.
Transferred predictions render at full opacity while visible. Curated (non-transferred) points, which
carry no confidence, SHALL always remain visible regardless of the threshold. At position `0` the
threshold SHALL create no condition, so every point is shown and the filter box stays clean. The
slider and the applied query filter SHALL mirror two-way: moving the slider upserts or removes the
condition in the applied filter at once, applying an edit of that condition in the Filter panel
moves the slider, and each direction guards on the threshold value so they do not oscillate.
Existing hidden, selected, highlighted, and selection-fade precedence SHALL remain consistent for
the points that stay visible.

#### Scenario: Default shows every prediction

- **WHEN** the reliability threshold is at its default position `0`
- **THEN** no reliability condition exists and every transferred and curated point is visible

#### Scenario: Sub-threshold predictions are filtered out

- **WHEN** the threshold is raised above `0`
- **THEN** an `EAT_confidence >= x or N/A` condition is applied and predictions with confidence below `x`
  are removed from the visible set
- **AND** curated points, which have no confidence, remain visible

#### Scenario: Slider and filter mirror two-way

- **WHEN** the user moves the slider, or edits the equivalent `EAT_confidence >= x or N/A` condition
  in the Filter panel and applies it
- **THEN** the other control reflects the same normalized threshold without oscillating
- **AND** an edit of the condition that is not applied leaves the slider where it was

#### Scenario: Hidden category wins

- **WHEN** a transferred point's effective category is hidden in the legend
- **THEN** its opacity and interactivity are exactly zero regardless of confidence or highlight

#### Scenario: Connector highlight wins

- **WHEN** a transferred point is highlighted as a connector endpoint
- **THEN** it receives selected opacity while retaining hollow geometry

#### Scenario: Opacity-tier membership invalidation

- **WHEN** `baseOpacity`, `selectedOpacity`, or `fadedOpacity` is configured at zero and selection
  or highlight changes which opacity tier applies to a point
- **THEN** cached interactable membership is recomputed and reflects the new zero/non-zero state
- **AND** when all tiers are positive, highlight-only changes reuse the default membership cache
