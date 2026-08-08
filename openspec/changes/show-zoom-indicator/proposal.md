## Why

The scatterplot can be zoomed substantially without any persistent UI signal that the current view differs from the fitted identity view. This makes a zoomed subset easy to mistake for the complete dataset view and leaves users without visible confirmation that double-click reset is applicable.

## What Changes

- Show a concise `Zoomed in` marker inside the existing point-count chip whenever the scatterplot scale is greater than the identity scale.
- Remove the marker when the view returns to identity, including after the existing double-click and programmatic reset paths complete.
- Update the marker only when zoom state crosses the identity boundary so ordinary zoom frames do not trigger unnecessary Lit renders.
- Add focused component and browser regression coverage for the zoomed and reset states.

## Capabilities

### New Capabilities

- `scatterplot-zoom-indicator`: Defines how the scatterplot exposes zoomed-versus-identity view state in its existing point-count indicator.

### Modified Capabilities

None.

## Impact

- `packages/core/src/components/scatter-plot/scatter-plot.ts`: track the zoom-state boundary and render the conditional marker.
- `packages/core/src/components/scatter-plot/interaction/plot-interaction-controller.test.ts` and/or a focused scatterplot render test: cover transform propagation and rendered state without mocking the behavior under test.
- `apps/web/tests/`: cover the user-visible wheel-zoom and reset journey in the real Explore page.
- No public API, dependency, persisted-data, or bundle-format changes.
