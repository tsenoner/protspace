## Why

The `renderer-capability-limits` scenario "The gamma-pipeline fallback is announced on the same channel" says every gamma fallback is reported. The renderer does not do that on a context that never had the float extensions. On iPhone and iPad WebKit, which has no `EXT_float_blend`, `ensureGL` sets `gammaPipelineAvailable = false` before it calls `handleGammaFallback('required extensions missing')`, and that method's early-return guard skips both the console warning and `reportDegraded('gamma-pipeline-unavailable')`.

That silence is the right behaviour, and the spec should say so:

- The gamma notice says "Colour blending is running in sRGB rather than linear light, so overlapping points may look slightly darker than intended." On a device that never had linear-light blending, nothing changed and the user can do nothing about it. Every iPhone and iPad visitor would get the notice on every load, contours on or off.
- The one visible consequence, contours that cannot draw, is already reported as `density-unavailable` when the user asks for contours. The `density-contours` scenarios "iPhone or iPad" (a single `density-unavailable` notice) and "Contours off" (no notice) already describe this.
- A pipeline lost at runtime is different. The user had linear-light blending, so the appearance changes in front of them, and the notice explains why.

## What Changes

- The `renderer-capability-limits` requirement "A capability reduction SHALL reach the user, not only the console" now separates the two cases. A gamma pipeline lost at runtime (gamma shader init failure, an incomplete linear framebuffer at init or after a resize, or loss during a render) SHALL be reported as `gamma-pipeline-unavailable`. A context that never provides the required float extensions SHALL NOT raise that notice; its user-visible consequence is reported as `density-unavailable` when contours are requested.
- The renderer tests pin both halves as intended behaviour. They replace a comment that called the silent path an open decision.
- No production code changes.

## Capabilities

### Modified Capabilities

- `renderer-capability-limits`: "A capability reduction SHALL reach the user, not only the console" separates a gamma pipeline lost at runtime from one the context never had.

## Impact

- `openspec/specs/renderer-capability-limits/spec.md` (via archive).
- `packages/core/src/components/scatter-plot/webgl/renderer/webgl-renderer.context-loss.test.ts` and `webgl-renderer.density.test.ts`: tests and comments only.
