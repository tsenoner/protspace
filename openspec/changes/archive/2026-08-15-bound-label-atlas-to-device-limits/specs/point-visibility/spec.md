## ADDED Requirements

### Requirement: Rendered slice count is bounded by renderer capability, not by visibility

The display-state model SHALL NOT account for how many colour segments a multi-value point is drawn
with: segment count is `min(distinct visible colours, effective atlas stride)` and is a renderer
capability constraint, evaluated in the renderer, in the same class as `isPointRendered`. A
reduction in segment count SHALL NOT change any point's opacity, interactivity, or membership in
plot data, and SHALL NOT cause axes to re-fit.

#### Scenario: A fidelity reduction does not change visibility

- **WHEN** the renderer reduces the label atlas stride to fit a device limit
- **THEN** every point keeps the opacity and interactivity the model assigns it
- **AND** plot data and the scale domains are unchanged

#### Scenario: The multilabel hidden rule is evaluated before the stride bound

- **WHEN** a point has values A and B, only A is hidden, and the effective stride is two
- **THEN** the point remains visible with B's colour, exactly as at full stride

### Requirement: The multi-label allocation gate is storage-shaped, not colour-shaped

Any decision about whether multi-label rendering resources are required SHALL be derived from the
annotation's stored value cardinality, not from the colours a point currently resolves to. Deriving
it from post-hide colours would let the all-but-one-hidden case (where every multi-value point
resolves to a single colour) retract resources that a subsequent un-hide needs immediately.

#### Scenario: Hiding all but one value does not retract multi-label resources

- **WHEN** every value but one of a multi-label annotation is hidden, so no point resolves to more
  than one colour
- **THEN** the annotation is still classified as multi-label
- **AND** un-hiding a value renders segmented markers without a resource rebuild
