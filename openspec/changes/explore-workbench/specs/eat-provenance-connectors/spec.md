## MODIFIED Requirements

### Requirement: Connector state is dismissable and non-colour-dependent

Connectors SHALL use a dashed stroke plus endpoint emphasis and text status, so provenance does not
depend on color alone. Empty-space click, deselection, annotation change, overlay disable, data
replacement, Escape, and an accessible close control SHALL clear connectors and connector-owned
highlights. Escape SHALL clear the connectors only when no popover, menu or dialog takes it, and
before anything else in the page's Escape order: the selection stays, and the next Escape clears
it.

Endpoint emphasis SHALL use an unfilled halo sized from the drawn dot radius, so it localizes the
termini without covering the encoded protein markers and grows only as the dots themselves do.

#### Scenario: Empty-space dismissal

- **WHEN** the user clicks plot space without activating a point
- **THEN** all connectors, status, and connector endpoint highlights clear

#### Scenario: Keyboard dismissal

- **WHEN** connectors are active and the user presses Escape or activates the labelled close control
- **THEN** connector state clears without changing the selected annotation, the projection or the
  selection
- **AND** after Escape, a second Escape clears the selection and a third returns a selection tool
  to Move and zoom

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
