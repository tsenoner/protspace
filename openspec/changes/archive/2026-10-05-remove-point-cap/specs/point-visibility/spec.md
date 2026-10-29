## MODIFIED Requirements

### Requirement: Hidden points have exactly zero opacity

The system SHALL assign opacity exactly `0` (not merely a small value) to
annotation-hidden points: consumers gate with a mix of comparisons (`=== 0` at export
culling and hover/click, `> 0` at the drawn count and the quadtree, `< 0.001` at the shader
discard) that agree on "invisible and non-interactive" only at exactly `0`.

#### Scenario: Hidden value yields exact zero

- **WHEN** every annotation value of a point is in the hidden set (after normalization)
  and not all values of the selected annotation are hidden
- **THEN** the model's opacity for that point is exactly `0`

### Requirement: Interactivity is numeric opacity, evaluated at event time

The system SHALL define interactivity as `opacity > 0` using the configured opacity
values (a `fadedOpacity` of `0` makes faded points non-interactive), and SHALL evaluate
it against current inputs at event time so hit-testing is correct even while the
quadtree rebuild is rAF-deferred.

#### Scenario: Faded points are clickable under default config

- **WHEN** a selection is active and `fadedOpacity` is the default `0.15`
- **THEN** faded points respond to hover, click, brush, and lasso

#### Scenario: Hidden points are not clickable

- **WHEN** a point's opacity is `0`
- **THEN** it is excluded from the quadtree and rejected by hover/click/brush/lasso even
  during the one-frame quadtree staleness window

### Requirement: Rendered slice count is bounded by renderer capability, not by visibility

The display-state model SHALL NOT account for how many colour segments a multi-value point is drawn
with: segment count is `min(distinct visible colours, effective atlas stride)` and is a renderer
capability constraint, evaluated in the renderer. A
reduction in segment count SHALL NOT change any point's opacity, interactivity, or membership in
plot data, and SHALL NOT cause axes to re-fit.

#### Scenario: A fidelity reduction does not change visibility

- **WHEN** the renderer reduces the label atlas stride to fit a device limit
- **THEN** every point keeps the opacity and interactivity the model assigns it
- **AND** plot data and the scale domains are unchanged

#### Scenario: The multilabel hidden rule is evaluated before the stride bound

- **WHEN** a point has values A and B, only A is hidden, and the effective stride is two
- **THEN** the point remains visible with B's colour, exactly as at full stride
