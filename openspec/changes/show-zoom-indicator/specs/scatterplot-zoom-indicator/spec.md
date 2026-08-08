## ADDED Requirements

### Requirement: Scatterplot indicates a zoomed-in view

The scatterplot SHALL append the text `Zoomed in` to its existing visible point-count indicator whenever the active view scale is greater than the identity scale of `1` by more than the implementation's small numerical tolerance. The scatterplot SHALL NOT show that marker at identity scale, for near-identity floating-point residue, while zoomed out below identity, or for translation alone at identity scale. The point-count indicator SHALL expose its changing content as a polite status message so assistive technology can announce zoom and reset changes without moving focus.

#### Scenario: User zooms in with the wheel

- **WHEN** the user wheel-zooms the scatterplot to a scale greater than `1`
- **THEN** the point-count indicator includes `Zoomed in`

#### Scenario: User zooms out without crossing identity

- **WHEN** the user changes between two scales that are both greater than `1`
- **THEN** the point-count indicator continues to include `Zoomed in`
- **AND** the scatterplot does not schedule a new Lit update solely because the zoomed-in boolean remained true

#### Scenario: User resets the zoom

- **WHEN** the existing reset behavior returns the view to identity scale `1`
- **THEN** the point-count indicator no longer includes `Zoomed in`

#### Scenario: Symmetric wheel gesture returns near identity

- **WHEN** accumulated wheel transforms leave the scale only within the numerical tolerance above `1`
- **THEN** the point-count indicator does not include `Zoomed in`

#### Scenario: Assistive technology receives zoom-state changes

- **WHEN** the point-count indicator changes between identity and zoomed-in content
- **THEN** the updated content is exposed as a polite status message
- **AND** the change does not require focus to move to the indicator

#### Scenario: User pans or zooms out

- **WHEN** the view is translated at scale `1` or has a scale below `1`
- **THEN** the point-count indicator does not include `Zoomed in`

### Requirement: Zoom indication preserves transform rendering performance

The scatterplot MUST keep the full D3 transform non-reactive and SHALL derive a separate reactive boolean for the zoomed-in boundary. Transform updates SHALL schedule marker-related Lit rendering only when that boolean changes. Marker-only Lit updates SHALL NOT redraw WebGL content or rebuild selection overlays already handled by the imperative zoom path.

#### Scenario: Zoom gesture emits multiple zoomed-in frames

- **WHEN** consecutive transform frames all have scales greater than `1`
- **THEN** only the first frame that crosses above identity changes the reactive zoom-indicator state

#### Scenario: Reset transition reaches identity

- **WHEN** a reset transition emits zoomed-in frames followed by its final identity frame
- **THEN** the reactive zoom-indicator state changes once on the final identity frame

#### Scenario: Zoom-indicator state crosses its boundary

- **WHEN** a transform changes only the reactive zoom-indicator state
- **THEN** the status text updates without an additional WebGL redraw or selection-overlay rebuild
