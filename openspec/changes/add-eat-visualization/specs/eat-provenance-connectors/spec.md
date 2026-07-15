## ADDED Requirements

### Requirement: Predicted proteins connect to their active-column source

When the EAT overlay is enabled and an EAT base annotation is active, clicking a transferred protein
SHALL draw one dashed provenance line to that cell's source protein in the current projection and
SHALL emphasize both endpoints without changing protein selection semantics.

#### Scenario: Predicted-to-source connector

- **WHEN** a user clicks a transferred protein whose source is present in the current view
- **THEN** one dashed, non-scaling connector joins the two real projected points
- **AND** both protein ids are highlighted

#### Scenario: Active annotation determines provenance

- **WHEN** the same protein has transfers for multiple base annotations
- **THEN** clicking it uses only the source recorded for the currently active base annotation

### Requirement: Source proteins connect to a bounded query fan-out

Clicking a source protein SHALL connect it to transferred queries that name it as source for the
active base annotation. Legend-ineligible endpoints SHALL be excluded, while otherwise eligible
endpoints removed by filtering or isolation SHALL retain their bounded id pairs, remain in the
total, and contribute once to accessible unavailable status until they re-enter the view. Pairs
SHALL be ordered by descending confidence with protein id as deterministic tie-breaker and capped
at 20. Source candidates SHALL be ordered once
when their cached index is constructed; each click SHALL scan and count legend-eligible candidates while
materializing at most 20 pairs, without per-click sorting or a full filtered-candidate allocation.
The UI SHALL report the shown and total candidate counts.

#### Scenario: Source below fan-out cap

- **WHEN** a clicked source has 7 visible transferred queries
- **THEN** all 7 connectors render and the status reports 7 of 7

#### Scenario: Source above fan-out cap

- **WHEN** a clicked source has 63 visible transferred queries
- **THEN** connectors render for the 20 highest-confidence queries
- **AND** the status reports “showing 20 of 63”

#### Scenario: Deterministic confidence tie

- **WHEN** multiple candidates at the cap boundary have equal confidence
- **THEN** their protein ids determine a stable ascending order

#### Scenario: Repeated high-fan-out source click

- **WHEN** a source with a large candidate list is clicked repeatedly in one stable data and
  annotation view
- **THEN** the cached deterministic ordering is reused without another sort
- **AND** each resolution allocates only the bounded connector result while still counting all
  visible candidates

#### Scenario: Legend-hidden endpoint

- **WHEN** either the source or predicted target has zero opacity because its effective legend
  category is hidden
- **THEN** no provenance pair is created for that endpoint in either click direction

### Requirement: Connectors track view geometry without zoom-time rebuilds

Connector endpoints SHALL be resolved from the current plot's id-index mapping and plane-mapped
projection coordinates. Projection, plane, data, filter, isolation, or scale changes SHALL rerender
geometry. Pan and zoom SHALL move connectors through the existing SVG group transform without
rebuilding their data join.

#### Scenario: Pan and zoom

- **WHEN** the user pans or zooms with connectors active
- **THEN** lines remain attached to both endpoints and retain a constant screen-space stroke width

#### Scenario: Projection or 3-D plane change

- **WHEN** the selected projection or `xy`/`xz`/`yz` plane changes
- **THEN** every active connector recomputes both endpoints from the new two-axis mapping

#### Scenario: Endpoint outside current view

- **WHEN** filtering or isolation removes one endpoint
- **THEN** no invalid or stale line is drawn for that pair and accessible status explains that the
  endpoint is outside the current view
- **AND** the unavailable candidate remains in the total in either click direction, including when
  zero lines can be drawn
- **AND** its retained id pair resolves into a line without another click if filtering or isolation
  later restores the endpoint, in either click direction

#### Scenario: Filtered point retains global identity

- **WHEN** a clicked filtered-view point's local rendered position differs from its global protein
  index
- **THEN** provenance reads the prediction cell using `detail.point.originalIndex`
- **AND** no dataset-wide protein-id-to-index map is allocated on first click

### Requirement: Connector state is dismissable and non-colour-dependent

Connectors SHALL use a dashed stroke plus endpoint emphasis and text status, so provenance does not
depend on color alone. Empty-space click, deselection, annotation change, overlay disable, data
replacement, Escape, and an accessible close control SHALL clear connectors and connector-owned
highlights.

#### Scenario: Empty-space dismissal

- **WHEN** the user clicks plot space without activating a point
- **THEN** all connectors, status, and connector endpoint highlights clear

#### Scenario: Keyboard dismissal

- **WHEN** connectors are active and the user presses Escape or activates the labelled close control
- **THEN** connector state clears without changing the selected annotation or projection

#### Scenario: Context change dismissal

- **WHEN** the active annotation changes, the overlay turns off, the dataset is replaced, or protein
  selection becomes empty
- **THEN** stale connector state and connector-owned highlights clear

#### Scenario: Endpoint category becomes hidden

- **WHEN** an active pair's source or target category becomes legend-hidden
- **THEN** the active connector request and connector-owned highlights clear immediately

#### Scenario: Connector highlight makes an endpoint non-interactable

- **WHEN** connector-owned highlighting applies a configured zero selected-opacity tier to a
  previously interactable source or target
- **THEN** the pair is suppressed after post-highlight authoritative revalidation
- **AND** no connector geometry, status, or connector-owned highlight remains for an empty request

### Requirement: Connector lookup scales with repeated interaction

The application SHALL build the source-to-query lookup at most once per visualization-data reference
and active base annotation. It SHALL cache authoritative interactable-view membership by stable view
and visibility identity and reuse both caches for subsequent clicks until their respective inputs
change.

#### Scenario: Repeated source clicks

- **WHEN** several sources are clicked under the same data and annotation
- **THEN** the application reuses the existing source index rather than rescanning all prediction
  cells for every click
- **AND** it reuses interactable membership rather than rereading every protein id in the unchanged
  view

#### Scenario: View membership invalidation

- **WHEN** filtering, isolation, annotation, legend visibility, or another authoritative
  interactivity input changes
- **THEN** the next provenance click rebuilds interactable membership for the new view exactly once

#### Scenario: Dataset lookup cache invalidation

- **WHEN** the scatter plot replaces its dataset and clears connector context
- **THEN** the connector controller releases both the prior `PlotData` reference and its id-to-slot
  membership map
- **AND** ordinary dismissal within a stable view retains the lookup for repeated-click reuse

#### Scenario: Inactive rendered view replacement

- **WHEN** a connector index is built and dismissed, then filtering, isolation, or projection
  replacement causes an inactive render with a different `PlotData` identity
- **THEN** the controller releases the prior plot reference and id-to-slot membership map
- **AND** it does not build the replacement index until another connector request is activated
- **AND** an inactive render of the exact same stable view retains the reusable index
