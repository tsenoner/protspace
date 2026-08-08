## Context

`PlotInteractionController.applyZoom()` forwards every D3 transform through the scatterplot host's `onTransform` callback. The host deliberately stores `_transform` as a plain field because making the full transform reactive caused an unnecessary Lit update and WebGL render on every gesture frame (the F-48 invariant). The existing bottom-left `.plot-indicator` renders the visible point count and is already the established persistent status surface for the plot.

Issue #343 requires a visible signal specifically for zooming in. The current `zoomExtent` also permits zooming out, so the indicator must distinguish `k > 1` from both identity (`k === 1`) and zoomed-out (`k < 1`) views.

## Goals / Non-Goals

**Goals:**

- Show `Zoomed in` next to the existing point count while the active D3 scale is meaningfully greater than `1`, ignoring near-identity floating-point residue from symmetric wheel gestures.
- Remove the marker once reset reaches identity.
- Announce zoom and reset status changes to assistive technology without moving focus.
- Preserve the non-reactive `_transform` performance invariant by scheduling Lit updates only when the boolean zoomed-in state changes.
- Cover the boundary in component tests and the real wheel/reset interaction in the Explore app.

**Non-Goals:**

- Add a new reset button, change the existing double-click reset gesture, or display a numeric zoom percentage.
- Show an indicator for panning at identity scale or for zooming out below identity.
- Refactor the interaction controller, point-count computation, or overlay layout.

## Decisions

### Reuse the existing point-count chip

The marker will render as the single text run `N points · Zoomed in` inside the existing bottom-left `.plot-indicator`. The chip reuses the component's established `role="status" aria-live="polite"` pattern so its changing content is announced without focus movement. A separate overlay was rejected because it would need new collision rules for no additional user value.

### Store only a reactive boolean boundary

The scatterplot will add a reactive `_isZoomedIn` boolean. The host callback will continue assigning every transform to the plain `_transform` field, then compare the scale against identity plus a small fixed tolerance before assigning the boolean. The tolerance treats multiplicative wheel round-trip residue as identity without suppressing a perceptible zoom. Lit's default change detection ignores equal boolean values, so it enqueues a template render once when zoom crosses above identity and once when reset reaches identity, rather than once per D3 frame. Because the marker is light-DOM text and the controller already renders transformed plot content imperatively, marker-only updates will be excluded from the `updated()` path that redraws WebGL and rebuilds selection overlays.

Keeping the boolean on the scatterplot host, rather than the interaction controller, preserves the controller's role as a generic transform dispatcher and keeps rendering state beside the template that consumes it.

### Verify both state propagation and user-visible behavior

A focused jsdom test will drive the real host bridge, assert the exact count/marker text renders as a polite status, observe `isUpdatePending` across repeated same-side transforms, verify marker-only state changes do not redraw WebGL, and cover near-identity wheel residue. A Playwright regression will locate the chip by its status role, wheel over the real Explore scatterplot, verify the complete `N points · Zoomed in` presentation, double-click reset, and assert the status returns to the point count alone.

## Risks / Trade-offs

- **Multiplicative wheel accumulation can finish a symmetric gesture a few ULPs above `1`** → Treat scales within a small fixed tolerance of identity as identity; the exact reset transform remains covered as well.
- **A marker appended to the count chip is less prominent than a dedicated badge** → The count chip is persistent, unobtrusive, and has no collision risk; the text remains visible throughout the zoomed state.
- **Reactive state could regress zoom performance** → Exercise consecutive same-side transforms through Lit's scheduling signal and independently assert that marker-only updates do not enter the WebGL/overlay redraw path.

## Migration Plan

No migration is required. The change is additive UI behavior with no public API or persisted state. Rollback consists of removing the boolean derivation and conditional template text.

## Open Questions

None. The count-chip presentation and non-interactive scope were approved before implementation.
