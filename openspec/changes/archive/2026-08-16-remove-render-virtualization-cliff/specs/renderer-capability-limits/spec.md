## ADDED Requirements

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
