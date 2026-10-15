## MODIFIED Requirements

### Requirement: Connectors track view geometry without zoom-time rebuilds

Connector endpoints SHALL be resolved from the current plot's id-index mapping and plane-mapped
projection coordinates. Projection, plane, data, filter, isolation, or scale changes SHALL rerender
geometry. Pan and zoom SHALL move connectors through the existing SVG group transform without
rebuilding their data join. Halo radius and stroke width SHALL be sized from the drawn dot radius
`r` in CSS px, which includes the zoom and plot-area point scale: a halo radius of `max(4, r + 2)`
and a stroke width of `max(1, 0.3 r)`, updated in place on every zoom.

#### Scenario: Pan and zoom

- **WHEN** the user pans or zooms with connectors active
- **THEN** lines remain attached to both endpoints, and their stroke width tracks the drawn dot
  radius rather than the zoom factor, keeping a constant screen-space dash cadence
- **AND** endpoint halos keep 2 px of clearance around the drawn dot, at least a 4 px radius, while
  their centres track the transformed source and target coordinates
- **AND** at 16× zoom, where dots are twice their zoom-1 radius, halos and strokes have grown with
  them without rebuilding the connector join

#### Scenario: Projection or 3-D plane change

- **WHEN** the selected projection or `xy`/`xz`/`yz` plane changes
- **THEN** every active connector recomputes both endpoints from the new two-axis mapping

#### Scenario: Endpoint outside current view

- **WHEN** filtering or isolation removes one endpoint
- **THEN** no invalid or stale line is drawn for that pair and accessible status explains that the
  endpoint is outside the current view
- **AND** the unavailable candidate remains in the total in either click direction, including when
  zero lines can be drawn
- **AND** the retained semantic click re-resolves into a line without another click if filtering or
  isolation later restores the endpoint, in either click direction

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

Endpoint emphasis SHALL use an unfilled halo sized from the drawn dot radius, so it localizes the
termini without covering the encoded protein markers and grows only as the dots themselves do.

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
