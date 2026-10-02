# renderer-capability-limits Specification

## Purpose

What the WebGL renderer guarantees about the limits of the device it is running on: that it
measures them rather than assuming them, that it detects an allocation the driver refuses instead
of latching it as success, that it degrades marker fidelity rather than point coverage when a
resource will not fit, that a point is never drawn in a colour that is not its own, and that a
capability reduction reaches the user rather than only the console.

The concern is distinct from `point-visibility`, which governs what the data says should be shown.
This capability governs what the hardware can actually deliver, and how the gap is handled.

## Requirements

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

Whether an atlas is wanted at all SHALL be decided from the same styling authority the export stages
its colours through, and SHALL NOT be inferred from whichever atlas the last completed render left
behind — nothing forces a render before an export, so that allocation is stale in both directions. A
live plan, where one exists, still caps the stride.

#### Scenario: A figure matches the screen

- **WHEN** the live view is rendering at reduced stride and the user exports an image
- **THEN** the exported markers use the same stride

#### Scenario: The device cannot hold an atlas

- **WHEN** the live renderer has permanently disabled its atlas because no layout fits the device
- **THEN** the export allocates none either and renders dominant colours

#### Scenario: A single-value annotation is selected

- **WHEN** the selected annotation stores one value per protein
- **THEN** the export allocates no atlas, whether or not the live renderer still holds one staged
  for an earlier annotation

#### Scenario: A multi-value annotation has not been staged yet

- **WHEN** a multi-value annotation is selected and no frame has been rendered since
- **THEN** the export still allocates an atlas and renders multi-segment markers, planned at full
  fidelity against its own context's limit, because no live plan exists to cap it

#### Scenario: The declared export dimension limit is truthful

- **WHEN** a device reports a texture limit below the configured maximum export dimension
- **THEN** the export's enforced maximum is the device's limit, and its rejection message names the
  limit actually enforced

### Requirement: Camera motion SHALL NOT rebuild GPU buffers

The renderer SHALL apply pan and zoom by uniform update alone, at every dataset size, and SHALL NOT
re-stage points, re-sort them, or upload buffer or texture data in response to a camera transform
change. The set of points handed to the renderer SHALL be referentially stable across camera moves,
so that no dirty check can be tripped by motion alone.

#### Scenario: A pan or zoom at any size

- **WHEN** the user pans or zooms, at any dataset size the loader admits
- **THEN** zero bytes are uploaded to the GPU for that render pass

#### Scenario: The cost of camera motion does not depend on dataset size

- **WHEN** the same gesture is applied to a small dataset and to one an order of magnitude larger
- **THEN** neither pass re-stages points, and the work per pass is independent of the point count

#### Scenario: Restaging still happens when the data or the styling changes

- **WHEN** the selected annotation, the colour mapping, the projection, or the dataset changes
- **THEN** the renderer re-stages as before — this requirement constrains camera motion only

### Requirement: The loader and the renderer SHALL share one point cap

The loader's row limit and the renderer's staging clamp SHALL derive from a single constant, so a
dataset the loader admits is always drawn in full. The relationship SHALL be pinned by a test rather
than by a comment. The renderer SHALL NOT silently discard points: any clamp it retains SHALL be
unreachable through the loader.

#### Scenario: A dataset at the limit is fully drawn

- **WHEN** a single-projection bundle at the maximum admitted size is loaded
- **THEN** the number of points drawn equals the number of proteins reported

#### Scenario: A dataset over the limit is refused with an explanation

- **WHEN** a bundle exceeds the limit
- **THEN** the load fails with a message naming the limit, what it counts, and what to do about it
- **AND** no partial dataset is displayed

#### Scenario: Multiple projections are counted correctly

- **WHEN** a bundle carries more than one projection
- **THEN** the row limit accounts for proteins multiplied by projections, so proteins per projection
  can never exceed what the renderer draws

### Requirement: The drawn point count SHALL be observable

The renderer SHALL expose the number of points its last stage actually drew, and the number of bytes
it has uploaded to the GPU, so that truncation and unnecessary re-staging are measurable rather than
assumed. The performance harness SHALL record both per render pass.

#### Scenario: A render pass reports what it drew

- **WHEN** the harness records a render pass
- **THEN** the pass carries both the count handed to the renderer and the count actually drawn

#### Scenario: Truncation is visible in a recorded run

- **WHEN** the drawn count is lower than the count handed to the renderer
- **THEN** the difference is present in the recorded results rather than being silent

### Requirement: Resources for an unused feature SHALL NOT be allocated

The renderer SHALL allocate the multi-label colour atlas only while the selected annotation actually
stores more than one value for some protein, and SHALL release it when that ceases to be true. It
SHALL re-stage on either transition, because the change alters every point's slice count without
necessarily altering any sampled style value.

#### Scenario: A single-value annotation costs nothing

- **WHEN** a dataset is rendered with an annotation whose every protein has one value
- **THEN** no capacity-sized colour atlas is allocated on the CPU or the GPU
- **AND** markers render exactly as they did when the atlas was allocated unconditionally

#### Scenario: Switching to a multi-value annotation mid-session

- **WHEN** the user selects a multi-value annotation after a single-value one
- **THEN** the atlas is allocated once and the points are re-staged with their slice counts
- **AND** switching back releases it

#### Scenario: The gate does not depend on what is currently visible

- **WHEN** hidden values reduce every point to a single rendered colour
- **THEN** the annotation is still treated as multi-value and the atlas is retained, so restoring a
  hidden value needs no reallocation
