## ADDED Requirements

### Requirement: Reserved EAT companions are normalized into a side-channel

The loader SHALL recognize exact `BASE__pred_value`, `BASE__pred_confidence`, and
`BASE__pred_source` companion columns, exclude reserved companions from ordinary annotations, and
expose valid transferred cells through `annotation_predicted[BASE]` in protein order. A transferred
cell SHALL contain a non-empty value and source plus a finite confidence in `[0,1]`, and SHALL exist
only when the curated base cell is missing.

#### Scenario: Valid transfer triple

- **WHEN** a protein has a missing `ec` cell and valid values in all three `ec__pred_*` companions
- **THEN** `annotation_predicted.ec` contains the value, confidence, and source at that protein index
- **AND** none of the three companion names appears in ordinary annotations

#### Scenario: Curated value takes precedence

- **WHEN** a protein has both a curated base value and populated companion values
- **THEN** the base value remains curated and the prediction side-channel is null for that cell

#### Scenario: Invalid or incomplete prediction

- **WHEN** a companion triple is incomplete, blank, non-finite, or outside the confidence range
- **THEN** the loader does not create a partial transferred cell
- **AND** it reports the affected column without failing the otherwise valid bundle

#### Scenario: Bundle without EAT companions

- **WHEN** a legacy bundle contains no recognized companion columns
- **THEN** it produces no prediction side-channel and all existing annotation behavior is unchanged

### Requirement: Confidence is exposed through a deliberate numeric annotation

For every normalized EAT base column, the system SHALL expose one synthetic selectable numeric
annotation labelled “<base label> — EAT confidence.” Its values SHALL be the raw reliability indices
for transferred cells and null for all other proteins. Raw confidence companion names and synthetic
storage keys SHALL NOT be serialized as ordinary annotations. Generated confidence annotations
SHALL carry explicit runtime identity; suffix spelling alone SHALL NOT classify a user annotation as
synthetic. When the preferred generated key collides, the loader SHALL allocate a distinct internal
key and preserve both annotations.

#### Scenario: Selecting EAT confidence

- **WHEN** a user selects the synthetic confidence annotation for `ec`
- **THEN** the existing numeric gradient path renders raw reliability-index values for transferred
  proteins and N/A for other proteins
- **AND** markers are filled numeric markers rather than EAT hollow categorical markers

#### Scenario: Confidence label and explanation

- **WHEN** the synthetic confidence annotation is displayed in the selector or legend
- **THEN** it has an EAT-specific friendly label and explains that the value is a reliability index,
  not a calibrated probability

#### Scenario: User annotation shares the preferred synthetic suffix

- **WHEN** an EAT or non-EAT v1/v2 bundle contains a real numeric or categorical annotation named
  `BASE__eat_confidence`
- **THEN** that user annotation remains ordinary data and round-trips without loss
- **AND** an EAT base uses a separately identified runtime annotation rather than overwriting or
  suppressing the user column

### Requirement: EAT overlay controls are conditional, accessible, and persisted

For datasets with normalized EAT cells, the control bar SHALL provide an EAT overlay switch beside
annotation selection and a native confidence-threshold control. The accessible fieldset SHALL
default to overlay enabled and threshold `0.50` and SHALL synchronize with the scatter plot. The
complete fieldset SHALL be absent for datasets without usable EAT cells. Optional
`eatOverlayEnabled` and `eatConfidenceThreshold` bundle settings SHALL validate, normalize, write
even when they are the only settings, and apply on dataset load.

#### Scenario: EAT-capable dataset

- **WHEN** a dataset with normalized EAT cells loads without embedded EAT settings
- **THEN** the switch is enabled and on, the threshold is `50%`, and both controls have accessible
  names and keyboard behavior
- **AND** the controls are contained by an accessible EAT-labelled group

#### Scenario: Dataset without EAT

- **WHEN** a dataset without normalized EAT cells loads
- **THEN** the complete EAT control group is absent from the rendered DOM and accessibility tree
- **AND** no empty group spacing or orphaned EAT label remains

#### Scenario: Embedded settings round-trip

- **WHEN** a bundle is exported with overlay disabled and threshold `0.75`, then reloaded
- **THEN** both the control bar and scatter plot restore disabled overlay state and threshold `0.75`

#### Scenario: Embedded settings restore from OPFS

- **WHEN** a persisted bundle with overlay disabled and threshold `0.75` is replayed from OPFS
- **THEN** its normalized embedded EAT settings override dataset-reset defaults in both the control
  bar and scatter plot
- **AND** settings absent from the bundle retain the enabled and `0.50` defaults

#### Scenario: Invalid optional setting

- **WHEN** an otherwise valid settings object contains a non-boolean overlay flag or a threshold
  outside `[0,1]`
- **THEN** normalization drops the invalid optional value and retains the valid settings object

### Requirement: Overlay coalesces categories without mutating curated data

When the overlay is enabled and an EAT base annotation is active, the effective category SHALL be
the curated value when present and otherwise the transferred value. Observed cells SHALL remain
filled. Transferred cells SHALL use the same category mapping but render as hollow, anti-aliased
markers. Disabling the overlay SHALL return transferred cells to their curated missing category.

#### Scenario: Observed and transferred category share a hue

- **WHEN** an observed protein and a transferred protein have the same effective category
- **THEN** both use the same legend category color while the observed marker is filled and the
  transferred marker is hollow

#### Scenario: Prediction-only category

- **WHEN** a transferred value is absent from all curated cells
- **THEN** the enabled overlay includes it in the effective legend and assigns it a stable category
  encoding without reordering existing observed categories

#### Scenario: Overlay disabled

- **WHEN** the user disables the overlay
- **THEN** transferred proteins use their curated missing value and no point is flagged hollow by EAT

#### Scenario: Grayscale and image export

- **WHEN** the current view is rendered live, composited in grayscale, or exported to PNG
- **THEN** observed-versus-transferred distinction remains encoded by filled-versus-hollow geometry

### Requirement: Confidence controls transferred opacity without hiding points

The authoritative point-visibility model SHALL map transferred confidence linearly from `0.25` at
zero confidence to `0.90` at confidence one. A transferred cell below the configured threshold SHALL
be further faded but SHALL remain visible and interactive unless hidden by an existing category
visibility rule. Existing hidden, selected, highlighted, and selection-fade precedence SHALL remain
consistent.

#### Scenario: Confidence endpoints

- **WHEN** unselected transferred cells have confidence `0` and `1` with threshold `0`
- **THEN** their base opacities are `0.25` and `0.90` respectively

#### Scenario: Below-threshold prediction

- **WHEN** a transferred cell's confidence is below the configured threshold
- **THEN** its opacity is reduced to a non-zero value rather than the point disappearing

#### Scenario: Threshold input lifecycle

- **WHEN** the user changes the confidence threshold repeatedly in the same annotation view
- **THEN** the system invalidates style and visibility state and redraws the points
- **AND** it does not rebuild plot geometry or the quadtree
- **AND** it does not request an unchanged population recount through `data-change`

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

### Requirement: Tooltip communicates per-cell EAT provenance

For an active EAT base annotation with the overlay enabled, a transferred protein tooltip SHALL show
the transferred value, confidence as a percentage, source protein id, and a compact confidence bar.
The content SHALL identify the cell as “Predicted (transferred)” and SHALL remain separate from the
column-level model-prediction badge.

#### Scenario: Transferred protein tooltip

- **WHEN** the user hovers a transferred protein while its base annotation is active
- **THEN** the tooltip shows the transferred label, “Predicted (transferred),” bounded confidence,
  source id, and confidence bar

#### Scenario: Observed protein tooltip

- **WHEN** the user hovers an observed protein
- **THEN** no per-cell EAT provenance block is shown for that annotation

### Requirement: Legend accounts for observed, transferred, and unannotated populations

For an active EAT base annotation with the overlay enabled, the legend SHALL render a distinct
“Predicted (transferred)” section with filled “Observed,” hollow “Predicted by EAT,” and explicit
“Unannotated” rows with live counts from the current filtered/isolation view. Observed plus
transferred plus unannotated SHALL equal the represented protein population. This section SHALL not
replace or reuse the column-level predicted badge.

#### Scenario: Full dataset counts

- **WHEN** an EAT base annotation is active in the full dataset
- **THEN** the legend reports observed, transferred, and unannotated counts whose sum equals the
  number of proteins represented by that annotation view

#### Scenario: Constrained-view counts

- **WHEN** filtering or isolation changes the visible protein set
- **THEN** the observed, transferred, and unannotated counts update to the constrained view
- **AND** their sum equals the constrained represented population

#### Scenario: Non-EAT or disabled view

- **WHEN** the active annotation has no prediction channel or the overlay is disabled
- **THEN** the EAT legend section is absent

### Requirement: EAT data survives slicing, hashing, and bundle round-trip

Prediction cells SHALL remain aligned when visualization data is sliced. Dataset fingerprints SHALL
change when any prediction value, confidence, or source changes. Bundle export SHALL reconstruct the
curated base cells and all three backend companion columns, even when called with an overlay-
materialized view, and SHALL omit synthetic confidence annotations.

#### Scenario: Slice alignment

- **WHEN** proteins are filtered or isolated into a reordered subset
- **THEN** each remaining protein retains its own prediction value, confidence, and source

#### Scenario: Prediction-sensitive hash

- **WHEN** two datasets have identical protein ids and curated annotations but different EAT source
  or confidence data
- **THEN** they produce different dataset hashes

#### Scenario: Lossless round-trip from enabled overlay

- **WHEN** an EAT bundle is loaded, displayed with the overlay enabled, exported, and loaded again
- **THEN** curated base cells remain missing where originally missing
- **AND** every valid prediction value, confidence, and source is preserved in its companion column
- **AND** no synthetic confidence column is written

#### Scenario: Golden v2 structural round-trip

- **WHEN** a backend-produced v2 bundle containing EAT cells, literal structural characters in
  labels, evidence suffixes, score suffixes, and multi-hit categorical cells is exported and loaded
  again
- **THEN** the annotations parquet remains stamped `protspace_format_version=2`
- **AND** every protein retains the same annotation set, evidence, and score companions
- **AND** every EAT value, confidence, and source companion is preserved

#### Scenario: Collision-safe v1 and v2 round-trip

- **WHEN** v1 or v2 data contains a legitimate annotation ending in `__eat_confidence`, with or
  without EAT companions for its base
- **THEN** export and reload preserve every user annotation value
- **AND** only explicitly generated runtime confidence annotations are omitted from storage
