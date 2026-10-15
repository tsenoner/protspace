## ADDED Requirements

### Requirement: The renderer SHALL measure the device texture limit rather than assume it

The renderer SHALL query `gl.MAX_TEXTURE_SIZE` once per WebGL context and SHALL size every
capacity-derived texture within the reported limit. It SHALL NOT query it per frame or per
populate. When the query returns a value that is not a finite positive number, the renderer SHALL
fall back to the WebGL2 specification floor of 2048 rather than proceeding unbounded.

#### Scenario: A device reporting the specification floor loads the shipped bundle

- **WHEN** a device reports `MAX_TEXTURE_SIZE` of 2048 and a 573,649-protein bundle is loaded with a
  multi-label annotation selected
- **THEN** the label atlas is allocated within 2048 in both dimensions
- **AND** no `INVALID_VALUE` or `INVALID_OPERATION` is raised

#### Scenario: A device with ample limits keeps its existing layout

- **WHEN** a device reports `MAX_TEXTURE_SIZE` of 4096 or more and the same bundle is loaded
- **THEN** the atlas geometry is unchanged from the geometry that device allocated before this
  requirement existed

#### Scenario: The limit is read once per context

- **WHEN** a scatter-plot renders repeatedly against one WebGL context
- **THEN** the device limit is queried once, at context acquisition, and not during rendering

### Requirement: Buffer capacity SHALL be bounded by the renderer's own point cap

The renderer SHALL bound planned buffer capacity by its maximum drawable point count, so that
geometric growth across reloads within a session cannot allocate for more points than the renderer
will ever draw. The bound SHALL NOT reduce capacity below the amount a single load actually
requires.

#### Scenario: Geometric growth cannot overshoot the cap

- **WHEN** a session loads a dataset just under the cap and then another slightly larger one, so
  that 1.5x growth would exceed the cap
- **THEN** planned capacity is bounded at the cap rounded up to allocation granularity

#### Scenario: A load larger than the cap is not starved

- **WHEN** capacity is planned for a point count above the cap
- **THEN** the planner returns enough capacity for that point count rather than the cap

### Requirement: The renderer SHALL reduce marker fidelity rather than point coverage

The renderer SHALL reduce the number of label slices per point, and SHALL NOT reduce the number of
points drawn, hoverable or exported, when the label atlas cannot be allocated at full fidelity
within the device limit. Slice count SHALL NOT fall below two, so a two-label point always renders
both of its hues.

#### Scenario: A constrained device draws every point

- **WHEN** the atlas must be planned at reduced stride to fit the device limit
- **THEN** every point in the dataset is still staged, drawn, hit-testable and exported

#### Scenario: A two-label point keeps both hues

- **WHEN** a point carries exactly two annotation values on a device at the reduced-fidelity floor
- **THEN** the point renders as a two-segment marker with both colours

#### Scenario: Fidelity is never reduced on a device that does not require it

- **WHEN** the atlas fits at full stride within the device limit
- **THEN** the full slice count is used and no reduction is reported

### Requirement: A point SHALL NOT render in a colour that is not its own

The renderer SHALL render a multi-label point in its dominant colour whenever the label atlas is
absent, incomplete, or does not cover that point's index, and SHALL NOT sample atlas storage
outside the region staged for that point. A point's staged label count SHALL NOT exceed the
effective slice stride, and the shader SHALL clamp the computed slice index to the last slice of
that point.

#### Scenario: No atlas is available

- **WHEN** the atlas could not be allocated and a multi-label annotation is selected
- **THEN** each affected point renders in its dominant colour rather than black or an unrelated
  colour

#### Scenario: A point carries more values than the stride

- **WHEN** a point has more distinct colours than the effective stride
- **THEN** it renders exactly `stride` segments drawn from its own colours, and never reads another
  point's storage

#### Scenario: The angular boundary of the marker

- **WHEN** a fragment falls exactly on the angle where the normalised sweep reaches its upper bound
- **THEN** it samples the point's last slice rather than the following point's first

### Requirement: A failed GPU allocation SHALL be detected and SHALL NOT be latched as success

The renderer SHALL check `gl.getError()` after each allocating GPU upload — once per capacity
change, never per frame — and SHALL record an upload as initialised only when the check reports no
error. After a failed texture allocation it SHALL install a minimal placeholder that leaves the
sampler complete, and after a failed buffer allocation it SHALL leave the buffers uninitialised so
the next populate reallocates rather than writing into storage that does not exist.

#### Scenario: An over-size texture allocation

- **WHEN** a texture allocation exceeds what the driver accepts
- **THEN** the renderer does not mark the texture initialised, does not issue a partial update
  against it on any later populate, and reports the degradation

#### Scenario: A failed buffer allocation is retried, not compounded

- **WHEN** an allocating buffer upload reports an error
- **THEN** the renderer leaves the buffer set uninitialised so the next populate reallocates it

#### Scenario: The check does not run on the per-frame path

- **WHEN** a populate updates existing buffers without changing capacity
- **THEN** no error query is issued

### Requirement: A capability reduction SHALL reach the user, not only the console

The renderer SHALL emit a host message when rendering capability is reduced or unavailable,
carrying the reason and the measured device limit, and the application SHALL surface it as a
warning. Each distinct reason SHALL be reported at most once per renderer instance.

#### Scenario: Reduced marker fidelity is announced

- **WHEN** the atlas is planned at reduced stride
- **THEN** a warning naming the device limit is surfaced once, and repeated renders do not repeat it

#### Scenario: The gamma-pipeline fallback is announced on the same channel

- **WHEN** the gamma-correct pipeline is unavailable and the renderer falls back to direct
  rendering
- **THEN** the fallback is reported through the same host-message channel rather than only to the
  console

### Requirement: Exported images SHALL use the same marker fidelity as the live view

The export renderer SHALL query its own context's texture limit and SHALL use a slice stride no
greater than the live renderer's, so an exported figure carries the same marker segmentation the
user saw on screen. Its declared maximum output dimension SHALL be the smaller of its own limit and
its configured maximum.

#### Scenario: A figure matches the screen

- **WHEN** the live view is rendering at reduced stride and the user exports an image
- **THEN** the exported markers use the same stride

#### Scenario: The live view has no atlas

- **WHEN** the live renderer has no label atlas
- **THEN** the export allocates none either and renders dominant colours

#### Scenario: The declared export dimension limit is truthful

- **WHEN** a device reports a texture limit below the configured maximum export dimension
- **THEN** the export's enforced maximum is the device's limit, and its rejection message names the
  limit actually enforced
