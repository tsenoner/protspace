## MODIFIED Requirements

### Requirement: A capability reduction SHALL reach the user, not only the console

The renderer SHALL emit a host message when rendering capability is reduced or unavailable,
carrying the reason and the measured device limit, and the application SHALL surface it as a
warning. Each distinct reason SHALL be reported at most once per renderer instance.

A gamma-correct pipeline that the context supports but that is lost at runtime SHALL be reported
as `gamma-pipeline-unavailable` through the same channel. Runtime losses include a gamma shader that
fails to initialise, a linear framebuffer that is incomplete at init or after a resize, and a
pipeline that becomes unavailable during a render. A context that never provides the float
extensions the pipeline requires (`EXT_color_buffer_float` and `EXT_float_blend`) SHALL NOT raise
`gamma-pipeline-unavailable`. Nothing changes in front of the user on such a device, and the notice
gives them nothing to act on. The one visible consequence, contours that cannot draw, SHALL be
reported as `density-unavailable` when contours are requested.

#### Scenario: Reduced marker fidelity is announced

- **WHEN** the atlas is planned at reduced stride
- **THEN** a warning naming the device limit is surfaced once, and repeated renders do not repeat it

#### Scenario: A gamma pipeline lost at runtime is announced on the same channel

- **WHEN** the context provides the required float extensions, but the gamma-correct pipeline is
  lost at runtime and the renderer falls back to direct rendering
- **THEN** the fallback is reported once as `gamma-pipeline-unavailable` through the same
  host-message channel rather than only to the console

#### Scenario: A context without the float extensions raises no gamma notice

- **WHEN** a context without `EXT_color_buffer_float` or `EXT_float_blend`, such as iPhone or iPad
  WebKit, renders points with contours off
- **THEN** the renderer draws directly and emits no `gamma-pipeline-unavailable` and no other
  renderer-degraded message

#### Scenario: The missing extensions surface through the feature that needs them

- **WHEN** the same context renders points with contours requested
- **THEN** a single `density-unavailable` notice names the missing extension, and no
  `gamma-pipeline-unavailable` notice accompanies it
