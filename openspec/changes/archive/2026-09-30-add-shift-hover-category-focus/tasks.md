## 1. Visibility model

- [x] 1.1 Add an optional `focusedValues` input to `VisibilityInputs`.
- [x] 1.2 Build the out-of-focus mask with the existing hidden-mask pass (every non-focused value,
      plus `NA_VALUE` unless N/A is focused) and use it in `baseOpacityOf` after the
      selected/highlighted and selection checks.
- [x] 1.3 Add a unit test: a point with the focused value and a multi-label point with it stay in
      focus, a highlighted out-of-focus point keeps selected opacity, and a zero-value point's
      base opacity is the faded opacity.
- [x] 1.4 Extend the unit test to what its title and the spec claim but it does not assert: a
      plain (non-highlighted) out-of-focus point fades, a non-empty selection outranks focus,
      hidden beats focus, and focusing `__NA__` keeps `null` points in focus.

## 2. Scatterplot wiring

- [x] 2.1 Add the reactive `_focusedValues` state, the `_hoveredPoint` and `_shiftDown` fields, and
      include `focusedValues` in the visibility-model memo key and the visible-point-count key.
- [x] 2.2 Implement `_updateFocus`: derive the hovered point's values from the materialized data,
      expand to the whole Other bucket, skip while a selection is active, and assign only on a
      content change.
- [x] 2.3 Register `keydown`/`keyup` (`_handleShiftKey`) and `blur` (`_handleWindowBlur`) on
      `window`, remove them and reset focus state on disconnect.
- [x] 2.4 Ignore a Shift `keydown` targeted at `input`, `textarea` or `[contenteditable="true"]`.
- [x] 2.5 Resync `_shiftDown` from `event.shiftKey` on every canvas mousemove.
- [x] 2.6 Clear focus with the hover state (leaving a point or the canvas).
- [x] 2.7 Re-derive focus in `willUpdate` via `_reconcileFocus` on data, annotation, Other bucket,
      numeric settings, EAT overlay and selection changes; drop the hovered point on a data swap.
- [x] 2.8 Treat an active focus as selection-active for the WebGL draw, refresh overlays and style
      cache on `_focusedValues` changes, and add `_focusedValues` to `NO_ADDITIONAL_RENDER_KEYS`.
- [x] 2.9 Hide the protein tooltip (drop its `visible` class) while focus is active.
- [x] 2.10 In `_handleMouseOver`, call `_updateFocus(this._shiftDown)` instead of
      `event.shiftKey || this._shiftDown`, so a Shift release between a mousemove and its hover
      frame cannot restart the focus the `keyup` ended; cover the keyup, blur and keydown gaps in
      `scatter-plot.shift-focus.test.ts`.

## 3. Tips and docs

- [x] 3.1 Add the `Shift + Hover — Focus the point's category` row to the Tips & Shortcuts popover.
- [x] 3.2 Document Shift + hover in the quick-reference table and a new "Focusing a Category"
      section of `docs/explore/scatterplot.md`.
- [x] 3.3 Mention Shift + hover in the Tips popover summary in `docs/explore/index.md`.

## 4. Specs

- [x] 4.1 Restate the `point-visibility` requirements that assumed only a selection fades points and
      that hover never recomputes the model.
- [x] 4.2 Add the `category-focus` capability and the focus fading tier requirement.
- [x] 4.3 Run `openspec validate add-shift-hover-category-focus --strict`.
