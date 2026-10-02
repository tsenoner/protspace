## Why

The query builder's two dropdowns are hand-rolled clones of `<protspace-annotation-select>` that
inherited its look and none of its behaviour: no arrow-key navigation, no listbox roles, Escape the
only key they answered. They also could not reach the design system — `query-builder.styles.ts` was
a bare `css` block, so it worked in the control bar's shadow root (where the parent pulls the mixins
in) but the row and picker components have their own, and inherited the custom properties without
the component classes. The reported symptom: the operator `<select>` had no `:focus` rule and fell
back to Chrome's UA ring, which on macOS follows the system accent — an orange border in a blue UI.

Composing the mixins is the fix, but it also makes the sheet an array, and Lit dedupes such arrays
keeping each sheet's _last_ position — silently reordering the control bar's cascade.

Retroactive like `add-filter-presence-semantics`: this shipped as #417, and `openspec/specs/`
describes none of it.

## What Changes

- The query builder's stylesheet composes the design system (`tokens` + the button, input and
  dropdown mixins) instead of restating it, so its controls carry the app's focus indicator rather
  than the browser's.
- Both pickers gain the full listbox keyboard contract: arrows walk the filtered list clamped
  without wrapping, Enter commits, Escape closes the dropdown without closing the modal around it.
- Both pickers are announced as listboxes — `role="listbox"` on the option container (not the
  popover, which also holds the search input), `role="option"` on entries, `aria-activedescendant`
  tracking the cursor, `aria-expanded`/`aria-haspopup` on triggers.
- The keyboard contract is **stated once**, in `dropdown-helpers`, and the three components that
  implement a searchable listbox all delegate to it.
- Pointer hover does **not** move the keyboard cursor; `:hover` styling comes from CSS and Enter
  resolves against the hovered row first.
- The stored highlight is clamped against the list on every use, because the list can shrink under
  it (a search, a multi-add selection, a dataset change).
- **The order of `controlBarStyles` is load-bearing** and must stay so: sheets that override the
  foundation mixins have to keep their position after them.
- The operator and logical-operator controls stay native `<select>` elements.

## Capabilities

### New Capabilities

- `query-builder-controls`: how the query builder's controls are styled, focused, navigated by
  keyboard and announced to assistive technology.

### Modified Capabilities

<!-- `filter-query-semantics` already states the ANY_VALUE exclusivity lock, including that the
     picker refuses selection "by pointer or keyboard". This change implements the keyboard half
     but does not alter that requirement, so there is no delta. -->

## Impact

- **Styles:** `packages/core/src/components/control-bar/query-builder.styles.ts` (composes the
  mixins, drops the mirrors), `control-bar.styles.ts` (sheet order).
- **Behaviour:** `query-condition-row.ts`, `query-value-picker.ts`, `annotation-select.ts` — all
  three now delegate to `handleListboxKeydown` in `packages/core/src/utils/dropdown-helpers.ts`.
- **Markup:** `type="text"` on the two picker search inputs and `.input-base` on the numeric fields,
  which is what lets `inputMixin` reach them; `.dropdown-item` on both option lists. Existing class
  names are kept alongside, so every unit and Playwright selector still resolves.
- **Not included:** returning focus to the trigger when a picker closes (needs the same treatment in
  `annotation-select` and a parent-side change for the value picker); replacing the
  `role="presentation"` category headers with APG's `role="group"` wrappers; a `.dropdown-menu`
  modifier so the fixed-position popovers can stop mirroring its surface; and repositioning the
  popovers on scroll, which `info-popover` does and these do not.
