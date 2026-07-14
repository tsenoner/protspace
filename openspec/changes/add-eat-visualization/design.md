## Context

The merged `protspace transfer` backend writes three inline companion columns for each transferred
annotation `COL`: `COL__pred_value`, `COL__pred_confidence`, and `COL__pred_source`. Query and
reference proteins already share every projection; transfer operates in the original embedding
space and never changes coordinates. The frontend currently treats all annotation-table columns as
ordinary color-by inputs, so the companions leak into selection and a transferred value has no
visual distinction from curated data.

This implementation must preserve several newer frontend invariants that post-date the issue's
concrete hooks: point opacity is centralized in `visibility-model.ts`, numeric annotations are
materialized on demand, filtered/isolation views retain global protein indices, and live WebGL and
off-screen export share one staging and shader pipeline. The application must also round-trip the
backend representation without converting display-time coalesced values into curated values.

The approved backend design, issues #277 and #300, the supplied real phosphatase bundle, and the
interactive PoC are the behavioral inputs. No external runtime dependency is needed.

## Goals / Non-Goals

**Goals:**

- Normalize EAT companions into one typed, per-protein source of truth and hide their storage names.
- Make observed and transferred values simultaneously legible, including in grayscale and exports.
- Keep confidence interpretable as the backend's reliability index rather than presenting it as a
  calibrated probability.
- Expose bidirectional provenance without degrading interaction on large datasets or high fan-out
  sources.
- Preserve old bundles, filtering/isolation semantics, settings, and lossless bundle round-trips.
- Cover numerical boundaries, rendering/staging, accessibility, real-bundle loading, and interactive
  behavior with deterministic tests.

**Non-Goals:**

- Changing EAT inference, nearest-neighbor search, metric, `k`, calibration, or backend output.
- Adding out-of-sample projection, multi-source transfer, persisted metric metadata, or a new bundle
  part/version.
- Changing the existing column-level predicted-annotation metadata badge.
- Exporting transient provenance connector lines into publication figures; hollow marker semantics
  are exported, while connectors remain an exploratory interaction overlay.

## Decisions

### D1. Normalize exact companion triples at the conversion boundary

Add `PredictedCell = { value: string; confidence: number; source: string }` and optional
`VisualizationData.annotation_predicted`, keyed by the base annotation and indexed by global protein
position. Conversion recognizes only exact `BASE__pred_(value|confidence|source)` suffixes, excludes
every recognized reserved companion from ordinary annotations, and creates a cell only when:

- the base cell is missing after standard missing-value normalization;
- value and source are non-empty strings; and
- confidence is finite and inside `[0, 1]`.

Incomplete schemas and invalid rows are ignored as predictions and reported once per column, rather
than partially displaying scientifically ambiguous records. Companion values on a curated base cell
are ignored. Old bundles produce no channel and retain current behavior.

Alternatives considered: keeping raw companions selectable was rejected because source ids are
high-cardinality provenance, not categories; parsing independently at each render site was rejected
because it would permit inconsistent validity and missing-value rules.

### D2. Provide a deliberate synthetic confidence annotation and a display-only overlay

For every normalized base column, conversion adds a numeric runtime annotation with values
`confidence | null`. It prefers the `BASE__eat_confidence` key, but allocates a distinct internal key
when that name already belongs to a user annotation. The generated `Annotation` carries explicit
runtime metadata identifying its EAT-confidence role and base annotation; serialization and display
metadata use that identity instead of suffix spelling. A real numeric or categorical column ending
in `__eat_confidence` remains an ordinary annotation and round-trips unchanged. Synthetic keys are
selectable but only explicitly marked generated entries are omitted from bundle output. Numeric
display materialization merges its derived bins into the source annotation rather than replacing
the source object, so runtime identity survives selection, `getCurrentData()`, and export.

Base categorical metadata includes the stable union of observed categories followed by any
prediction-only categories. Raw `annotation_data` remains curated. When the overlay is enabled and a
base EAT column is selected, scatter-plot materialization clones only that selected column's index
storage and replaces missing slots with predicted category indices. The result is cached by data,
annotation, overlay state, and numeric settings. The legend and styling consume this materialized
view; disabling the overlay immediately returns to curated indices.

Alternatives considered: mutating base annotation rows during conversion was rejected because the
off state and lossless export need the curated representation; teaching every consumer to coalesce
independently was rejected because it would fork legend, tooltip, visibility, and filter semantics.
Rejecting an otherwise valid EAT bundle solely because a user chose the preferred synthetic name
was also rejected; collision-safe allocation preserves both meanings without data loss.

### D3. Extend the authoritative visibility model for confidence

The visibility model receives overlay state and threshold and remains the only opacity authority.
Observed cells retain existing opacity tiers. A non-selected transferred cell uses
`lerp(0.25, 0.9, confidence)`; below the threshold, that alpha is multiplied by `0.35` with a
non-zero floor, so it fades but never disappears. Hidden categories still produce exactly zero,
and selection/highlight still wins with selected opacity. The model's memo keys include all new
inputs, preserving hidden-mask reuse and deterministic hit testing.

Confidence is displayed as a percentage but described as a reliability index/ranking. The UI does
not call it probability or accuracy.

Threshold input changes invalidate only visibility/style caches and redraw GPU alpha. Because the
contract keeps below-threshold points non-zero and interactive, threshold changes do not rebuild
plot geometry or the quadtree and do not emit the population-bearing `data-change` event consumed
by the legend.

Interactable-membership caching keys selection and highlight identities whenever any supported
observed opacity tier (`baseOpacity`, `selectedOpacity`, or `fadedOpacity`) is non-interactive
(`<= 0`). If every tier is positive, selection and highlight can only restyle points and the
default connector-highlight fast path reuses membership. EAT confidence opacity has a positive
floor, while selected EAT endpoints still follow the same selected-opacity tier.

Alternative considered: applying confidence in `style-getters.ts` was rejected because WebGL hit
testing, visible counts, depth ordering, and exports now share the visibility model by design.

### D4. Carry an explicit predicted flag through shared WebGL staging

Add `isPredicted(point)` to style getters and one float `a_predicted` attribute to the shared point
layout, staging arrays, live buffers, export buffers, and shaders. The fragment shader reuses the
existing signed-distance field: observed markers retain the filled shape, while transferred markers
discard the interior and retain an anti-aliased outline of the same category color. The flag is
active only for the selected base annotation while the overlay is enabled; the synthetic confidence
view remains a conventional filled numeric gradient.

One shared shader source continues to drive live, grayscale-composited, and PNG paths. A dedicated
attribute is preferred over overloading shape or alpha because those channels already encode
independent category and visibility semantics.

### D5. Treat EAT display settings as global bundle state

Add optional `eatOverlayEnabled` and `eatConfidenceThreshold` fields to `BundleSettings`. Defaults
are enabled and `0.50` when a dataset has predictions. Validation accepts only a boolean and a finite
number in `[0,1]`; normalization drops invalid optional values while retaining otherwise valid
settings. The writer gate recognizes EAT-only settings.

The control bar exposes a switch beside annotation selection and a native range input (`0..1`, step
`0.05`) only when the loaded dataset has at least one normalized EAT cell. A non-EAT dataset omits
the complete fieldset so it contributes no irrelevant focus targets, accessibility-tree content,
or empty responsive-grid spacing. The supported fieldset reuses the existing control-bar fieldset,
legend, label, typography, spacing, colour, and native-input patterns; it introduces no decorative
emoji. The threshold is disabled while the overlay is off. Auto-sync updates scatter state and
emits one `eat-overlay-change` contract. Loading embedded settings applies both plot and control
state; parquet export writes the current values.

Embedded EAT settings have the same precedence for direct imports and OPFS replay: normalized bundle
values are applied after dataset-reset defaults, and absent fields fall back to enabled and `0.50`.
Unlike legend customization, EAT state has no separate per-dataset browser persistence channel, so
OPFS MUST replay the embedded values rather than silently retaining reset defaults.

### D6. Keep provenance pairs as ids in a dedicated SVG controller

A `ConnectorOverlayController`, peer to the duplicate-stack controller, stores id pairs plus summary
metadata. At render time it builds a current plot id-to-slot map, resolves plane-mapped `_plotData`
coordinates through current scales, and draws dashed, round-capped, non-scaling SVG lines in a
`connector-lines-layer` child of the already transformed overlay group. Pan/zoom therefore needs no
recomputation; data, projection, plane, scale, filter, and isolation changes rerender endpoints.
Ordinary dismissal clears request/geometry while retaining the current-view index for reuse. Dataset
replacement uses a distinct cache invalidation operation that releases both the indexed `PlotData`
reference and its id-to-slot map, preventing the prior million-row view from being retained when no
new connector is created. Every overlay render observes current `PlotData` identity before its
inactive-request fast return: an exact identity match retains the stable-view index, while a
filtered, isolated, or projection-replaced identity releases the prior reference and map without
building a replacement index until a connector request needs one.

The app interaction controller caches a source-to-query index per data reference and base
annotation. Each source list is sorted once while that cached index is constructed, by descending
confidence then protein id. It also caches interactable protein-id membership by the scatter plot's
stable current-view/visibility identity, invalidating only when filtered/isolation membership or
the authoritative visibility inputs change. A predicted click creates one query-to-source pair. A
source click scans its already ordered list once, counts interactable candidates, and materializes
only the first 20 pairs; it neither re-sorts nor allocates a full filtered candidate array.
Legend-hidden and off-view endpoints produce no invalid geometry and an accessible “showing N of M”
status.
Legend-hidden and off-view endpoints produce no invalid geometry and an accessible explanatory
status.

Connector endpoints replace `highlightedProteinIds` while active. Empty-space click, annotation or
overlay changes, data replacement, deselection, authoritative category-interactivity changes,
Escape, and an accessible close button clear both lines and connector highlights. Clearing on
legend visibility change prevents a previously valid pair from remaining stale after either its
source or target becomes hidden. Because connector-owned highlighting applies the selected-opacity
tier, the scatter plot revalidates candidate endpoints after installing those highlights; if the
configured selected opacity makes either endpoint non-interactable, that pair is suppressed and an
empty request clears the highlight/status instead of drawing to invisible points. Dashed stroke,
endpoint emphasis, text status, and keyboard dismissal make the feature non-colour-dependent.

Alternative considered: drawing connectors in WebGL was rejected because SVG already owns
interaction overlays and supplies zoom transforms, vector strokes, DOM accessibility, and simpler
deterministic tests.

### D7. Reconstruct v2 storage on bundle export and fingerprint the side-channel

The bundle writer skips synthetic confidence annotations. It serializes every categorical column
with the v2 codec: labels percent-encode structural `%`, `;`, and `|` characters; positional
evidence or numeric-score suffixes are reconstructed; multi-hit values use structural semicolons;
and the annotations parquet footer is stamped `protspace_format_version=2`. Runtime identity remains
attached when a selected numeric confidence view is materialized, so writer omission does not depend
on whether export receives raw or display-materialized data. For each EAT base,
predicted positions are serialized as missing in `BASE`, then the writer reconstructs all three EAT
companion columns from `annotation_predicted`. This remains correct even if the caller passes
display-materialized data. A golden backend-produced v2 fixture write/reload regression compares
per-protein annotation sets, evidence, scores, and every prediction companion.

Slicing copies `annotation_predicted` in protein order. Dataset hashing includes sorted
base/protein/value/confidence/source tuples so bundles with identical curated annotations but
different transfers cannot share persisted settings. Filtering/isolation retains global lookup
correctness and display-local connector visibility.

### D8. Validate in vertical slices and with the real bundle

Tests cover companion recognition and invalid data, optimized and small conversion paths, synthetic
confidence, slicing/hash/export/settings, visibility precedence and threshold boundaries, WebGL
attribute/staging/shader behavior, tooltip and legend output, connector geometry and fan-out, and
control accessibility. The exact 832-protein phosphatase asset linked from issue #277 comment
4902936797 is the checked-in browser fixture: its source ZIP SHA-256 is
`b302a3c81f898c789f201ed0bc3c614ebd24c01db237f749f0a983ccd9954080`, and the contained/check-in
bundle SHA-256 is `06bacd7a1f862bdea4a9bf2e81037a4a7d772636704c74e3f2806958f3b9ba33`.
The browser flow verifies the accessible supported controls, transfer counts and hollow staging,
toggle/threshold behavior, tooltip provenance, both connector directions, projection recomputation,
dismissal, responsive layout, and encoded PNG/export. Full precommit and relevant E2E tests run
before every commit.

## Risks / Trade-offs

- **Additional per-protein arrays increase memory for EAT bundles** → Allocate channels only for
  detected base columns, materialize only the selected base column, and cache by stable references.
- **Invalid companion data could disappear silently** → Enforce one validity rule, warn once with
  counts, and test incomplete/out-of-range cases.
- **Overlay or numeric materialization could contaminate export** → Reconstruct curated bases and
  companions from `annotation_predicted`, preserve runtime annotation identity through derived
  numeric bins, and test export from raw, overlay-materialized, and selected-confidence views.
- **A popular source could create DOM or visual overload** → Cache authoritative interactable-view
  membership, pre-order each cached source list once, scan with bounded result allocation, filter
  both endpoints, and cap deterministically at 20 highest-confidence links with an explicit N-of-M
  status.
- **Hollow glyphs can become illegible at small point sizes** → Use the shader's derivative-based
  signed-distance anti-aliasing, retain a minimum ring width, and assert live/export shader parity.
- **Confidence could be misread as calibrated probability** → Use “reliability index” language and
  percentage formatting only as a bounded display representation.
- **Existing selection/highlight behavior could conflict with connectors** → Connector highlights
  use the currently unused highlight channel, never mutate selection, are cleared independently,
  and are followed by an authoritative endpoint-validity check.

## Migration Plan

The change is additive and frontend-only. Old bundles load with no EAT controls or altered render.
New EAT fields in settings are optional, so older settings normalize to defaults. Deploy can be
rolled back without data migration because bundles keep the backend's existing three companion
columns. The OpenSpec change is archived only after the PR is green and review feedback is resolved.

## Open Questions

None. Product and numerical defaults are fixed above; implementation findings that invalidate an
assumption require updating this design before continuing.
