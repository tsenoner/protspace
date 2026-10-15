## Context

`computeVisibilityModel` (`styling/visibility-model.ts`) is the single authority for per-point
opacity, base opacity (which drives depth) and interactivity. Selection fading is expressed there
as a tier: selected and highlighted points get `opacities.selected`, everything else
`opacities.faded`, and the WebGL renderer switches to a two-pass "selection active" draw (faded
points flat with blending off, then the selected tier blended on top) whenever
`setSelectionActive(true)` is set.

Shift + hover focus needs the same visual result, "this group on top, everything else faded", but
keyed on annotation values of the hovered point instead of protein IDs, and it must turn on and off
at hover speed without disturbing selection, legend-hide or URL state.

## Goals / Non-Goals

**Goals:**

- Fade everything outside the hovered point's category while Shift is held, reusing the selection
  rendering path.
- Keep hidden, highlighted and selected semantics unchanged.
- Never leave focus stuck on after Shift is released, the window loses focus, or the data changes.
- Keep the cost bounded to one O(N) pass per change of the focused category, not per hover frame.

**Non-Goals:**

- Persisting focus, exposing it as a public property or event, or syncing it to the URL.
- Focusing by keyboard alone (focus always follows a hovered point).
- Pausing the landing page's annotation auto-cycle while focused (it is fine for the view to keep
  changing under the cursor).

## Decisions

### Focus renders like a selection tier

`VisibilityInputs` gains an optional `focusedValues: string[] | null` (internal keys). When it is
non-null, the model builds an out-of-focus mask by running the existing `buildHiddenMask` pass with
every annotation value except the focused ones (plus `NA_VALUE` unless N/A is focused) treated as
"hidden". A point is out of focus iff none of its values is focused, which is exactly the
multi-label rule the hidden mask already implements. `baseOpacityOf` then returns
`opacities.faded` for out-of-focus points and `opacities.selected` for in-focus points, and the
scatterplot passes `_focusedValues !== null` into `setSelectionActive`, so focus gets the flat
two-pass draw and the depth ordering a selection gets. Reusing the hidden-mask pass avoids a second
per-point walk implementation and keeps the multi-label, sparse and Int32Array layouts consistent.

A zero-value point (empty row or negative sentinel) is always out of focus, and hovering one
starts no focus, because it has no category to focus.

### Precedence: hidden, then selection/highlight, then focus

`opacityOf` still checks hidden first, so a hidden point stays at exactly `0` whatever the focus.
`baseOpacityOf` checks selected/highlighted before focus, so a highlighted protein keeps
`opacities.selected` even when out of focus, and any non-empty selection returns
`opacities.faded` for non-selected points before focus is consulted. On top of that the
scatterplot skips deriving a focus at all while `selectedProteinIds` is non-empty, so the O(N) mask
is never built when it could not change the picture, and a selection arriving while focused ends
the focus.

### The Other bucket focuses the whole bucket

The legend groups low-frequency values into one "Other" entry (`otherAnnotationValues`). Focusing
only the hovered point's literal value would highlight a subset the legend never shows as a group,
so when any of the hovered point's values is in the Other bucket the focus is the point's values
plus every Other value.

### Tooltip hidden while focused

The tooltip is still rendered (so its measurement and `protein-hover` dispatch are unchanged) but
loses its `visible` class while `_focusedValues` is non-null. The user is looking at a whole
category; a per-protein card on top of it hides the very points they are inspecting.
The `eat-annotation-overlay` tooltip requirements govern the tooltip's content, so they still
hold whenever it is shown and need no change.

### Shift state: keyboard events plus mouse-event resync

`_handleShiftKey` listens on `window` for `keydown`/`keyup` of `Shift` and re-derives focus
immediately, so pressing or releasing Shift over a still cursor works. Keyboard events alone are
not reliable: a `keyup` can be swallowed by an iframe, a devtools pane or a handler that stops
propagation. Every canvas `mousemove` therefore resets `_shiftDown` from `event.shiftKey`, which
carries the real modifier state, and the rAF-coalesced hover reads only `_shiftDown`. A
`window` `blur` clears Shift and focus outright.

The hover deliberately does not read the pending mousemove's `event.shiftKey`: if Shift is
released (or the window blurs) between a mousemove that reported `shiftKey: true` and its frame,
that value is stale and would restart the focus the `keyup` just ended, leaving it on until the
next mousemove. `_shiftDown` is always at least as fresh as `event.shiftKey` (the mousemove sets
it, later key and blur events overwrite it), so it also covers a Shift press between the
mousemove and its frame (task 2.10).

### Text inputs are excluded

A Shift `keydown` whose composed-path target is inside `input`, `textarea` or
`[contenteditable="true"]` does not start focus, so typing a capital letter in the search box does
not flash the plot. The key state is still recorded, and a later mousemove with Shift held over a
point does start focus, because that is a deliberate gesture on the plot.

### Derive focus in `willUpdate`

A focus is a function of the hovered point, `data`, `selectedAnnotation`, `otherAnnotationValues`,
`numericAnnotationSettings`, `eatOverlayEnabled` and `selectedProteinIds`. When any of those change
under a still cursor, `_reconcileFocus` runs from `willUpdate`, before `updated()` rebuilds the
style getters, so the same render already uses the re-derived focus: an annotation switch never
paints one frame with the previous annotation's focus and never queues a second update. A `data`
change also drops the hovered point (its index may no longer mean the same protein), which ends
focus. The values are read from the materialized data, because numeric bins and EAT predictions
exist only there.

### Cost: O(N) per focused-category change, not per hover frame

`_updateFocus` assigns `_focusedValues` only when the new list differs by content (a
`\u0000`-joined comparison), so moving between points of the same category keeps the same array
reference, schedules no Lit update and hits the visibility-model memo. The O(N) out-of-focus mask
runs only when the focused value list actually changes (entering focus, crossing into another
category, or an input change that re-derives it). The materialized-data lookup is skipped entirely
on plain hovers without Shift. `_focusedValues` is in `NO_ADDITIONAL_RENDER_KEYS`: the selection
reconcile block already refreshes overlays, invalidates the style cache and redraws once, so a
focus-only update does not trigger the catch-all second redraw.

## Risks / Trade-offs

- **Hover-speed O(N) passes on huge datasets** → bounded to category changes; within a category no
  work is done. Shift-dragging across many small categories on a 570K-point bundle does run one
  pass per crossing.
- **Focus mask is not cached across unrelated model recomputes** (for example a highlight change
  while focused rebuilds it) → rare, and the pass is the same allocation-free walk as the hidden
  mask.
- **Missed Shift `keyup`** (swallowed by an iframe, a devtools pane or a handler that stops
  propagation) → focus can stay on over a still cursor until the next mousemove resyncs
  `_shiftDown` from `event.shiftKey`; see "Shift state" above.
- **Shift is also a modifier elsewhere** (for example `protein-click` reports `shift`) → focus is
  purely visual and does not alter click, brush or lasso behavior.

## Migration Plan

None. The change is additive, internal to `@protspace/core`, and has no persisted state.
