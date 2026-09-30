## Why

To see where one category sits in the embedding, a user today has to open the legend and hide every
other value, then undo it. Holding **Shift** while hovering a point is a quicker, non-destructive
way to answer "where else is this category?" without touching the legend, the selection or the
URL state.

The feature is already implemented in `@protspace/core` on this branch (commits "feat(core): Shift+hover focuses the
hovered point's category", "feat(core): hide the protein tooltip during Shift+hover focus" and
"fix(core): harden Shift+hover focus") without an OpenSpec change. It also contradicts the current
`point-visibility` spec, which says non-selected points fade only when `selectedProteinIds` is
non-empty and that the visibility model never recomputes during hover churn. This change records
the behavior the code has and corrects those requirements so the spec reads true.

## What Changes

- **Shift + hover focus.** While Shift is held and the cursor is on a point, every point sharing at
  least one of the hovered point's values in the selected annotation stays in focus and every
  other point fades, drawn the same way as a selection. Releasing Shift, moving off the point, or
  leaving the canvas restores the normal view.
- **Other bucket.** Hovering a point in the legend's "Other" bucket focuses the whole bucket, the
  way the legend shows it.
- **Precedence.** Hidden legend values stay hidden, highlighted proteins keep full opacity, and an
  active selection outranks focus (focus does not start, and a new selection ends it).
- **Tooltip.** The protein tooltip is hidden while focus is active, so it does not cover the
  category being inspected.
- **Robust key handling.** Window blur ends focus, every mousemove resyncs the Shift state from the
  event's modifier flag (so a lost `keyup` cannot leave focus stuck), and pressing Shift inside a
  text input, textarea or contenteditable element does not start focus.
- **Tips popover.** The Tips & Shortcuts popover gains a `Shift + Hover` row, "Focus the
  point's category".
- **Docs.** `docs/explore/scatterplot.md` and `docs/explore/index.md` document the gesture.

## Capabilities

### New Capabilities

- `category-focus`: How Shift + hover starts, derives, and ends a category focus in the
  scatterplot, how it interacts with the tooltip, selection and text inputs, and how the Tips
  popover advertises it.

### Modified Capabilities

- `point-visibility`: The visibility model gains a focus input and a focus fading tier. "Single
  source of truth for display state", "Selection fading" and "Model freshness without lifecycle
  coupling" are restated so they no longer claim that only a selection fades points or that hover
  never recomputes the model.

## Impact

- `packages/core/src/components/scatter-plot/styling/visibility-model.ts`: optional
  `focusedValues` input and the out-of-focus mask.
- `packages/core/src/components/scatter-plot/scatter-plot.ts`: `_focusedValues` state, Shift and
  window-blur listeners, `_updateFocus`, `_reconcileFocus` (run from `willUpdate`), the tooltip
  class binding, the selection-active draw path and the `NO_ADDITIONAL_RENDER_KEYS` entry.
- `packages/core/src/components/scatter-plot/tooltips/protspace-tips.ts`: the new Tips row.
- `packages/core/src/components/scatter-plot/styling/visibility-model.test.ts`: a focus test.
- `docs/explore/scatterplot.md`, `docs/explore/index.md`: user docs.
- No public API, event, persisted-state, URL-state or bundle-format changes. `protein-hover` events
  are still dispatched while focus is active.
