> Retroactive change: the presentation and a11y work shipped as #417 before this OpenSpec entry
> existed, and the `/simplify` and `/code-review` passes that followed are recorded here too.

## 1. Reach the design system (#417)

- [x] 1.1 Compose `queryBuilderStyles` as `[tokens, buttonMixin, inputMixin, dropdownMixin, css…]`
      so the mixins' component classes reach the row and picker shadow roots, not just their
      inherited custom properties.
- [x] 1.2 Fix the reported bug: the operator `<select>` had no `:focus` rule and fell back to the UA
      ring (macOS accent → orange). `inputMixin`'s `select:focus` now supplies it.
- [x] 1.3 Write the chevron data URI once for both selects, and let the logical-op select size to
      its widest option instead of a hardcoded width that could clip.
- [x] 1.4 Keep both `<select>`s native — record the reasoning rather than converting them.

## 2. Picker keyboard and ARIA (#417)

- [x] 2.1 Arrow-key navigation over the filtered list in both pickers, clamped without wrapping.
- [x] 2.2 Enter commits; Escape closes via `handleDropdownEscape` so the surrounding modal survives.
- [x] 2.3 Enter/Space on a closed trigger opens the picker, with `preventDefault` so the native
      button activation does not toggle it straight back shut.
- [x] 2.4 `role="listbox"` on the option container rather than the popover — the popover also holds
      the search input, and a textbox is not a valid listbox child.
- [x] 2.5 `role="option"` + `aria-selected` on entries, `role="presentation"` on category headers,
      `aria-expanded` + `aria-haspopup="listbox"` on triggers, accessible names on search inputs.
- [x] 2.6 `aria-activedescendant` tracks the cursor, and the keyboard honours the `ANY_VALUE`
      exclusivity lock already specified in `filter-query-semantics`.
- [x] 2.7 28 keyboard/ARIA tests across the two components.

## 3. Stop mirroring what the design system already provides (`/simplify`)

- [x] 3.1 Replace two hand-rolled scroll-into-view methods with `scrollHighlightedIntoView`, which
      both files' existing import already reached. The copies had diverged: one had dropped the
      jsdom guard the helper documents.
- [x] 3.2 Adopt `.dropdown-item` on both option lists and delete the byte-identical local mirror,
      keeping the existing class alongside so every selector still resolves.
- [x] 3.3 Add `type="text"` to the picker search inputs and `.input-base` to the numeric fields so
      `inputMixin` reaches them; delete ~28 mirrored declarations.
- [x] 3.4 Delete the `:focus-visible` rule on options that carry no tabindex by design, and a `mark`
      selector with no matching markup.
- [x] 3.5 Drop `_navigableValues`, a non-reactive field written from inside `render()` whose stated
      justification did not hold — the highlight is `@state`, so every arrow key re-renders anyway.
- [x] 3.6 Stamp each filtered annotation's flat index in the helper instead of threading a mutable
      counter through a nested `map` in the template.
- [x] 3.7 Restore the save/delete dance around the `Element.prototype.scrollIntoView` stub, which
      was assigned with no restore.

## 4. Correctness pass (`/code-review`)

- [x] 4.1 Fix the cascade regression: list `queryBuilderStyles` before `iconMixin`/`layoutStyles`,
      because Lit keeps each sheet's LAST position when deduplicating a flattened array, and nesting
      the four foundation sheets had moved them after the sheets that override them. Document the
      constraint where it is depended on.
- [x] 4.2 Extract `handleListboxKeydown` into `dropdown-helpers` and delegate all three searchable
      listboxes to it (~130 duplicated lines → ~45), fixing the truthy hover check that made an
      empty-string annotation name select the highlighted row instead of the hovered one.
- [x] 4.3 Clamp the highlight index against the current list on every use, so a multi-add selection
      cannot leave `aria-activedescendant` pointing at an unrendered id.
- [x] 4.4 Move the value picker's open/close reset from `updated()` to `willUpdate()` — reactive
      state assigned after an update completed schedules a second render and trips Lit's
      change-in-update warning.
- [x] 4.5 Clear the value picker's search query on open/close; reopening silently re-applied it.
- [x] 4.6 Give the annotation picker's search input `role="combobox"`/`aria-expanded`/
      `aria-haspopup`, matching the value picker.
- [x] 4.7 Make `ListboxKeyboardOptions` module-private — knip fails on an exported type nothing
      imports.

## 5. Verification

- [x] 5.1 `pnpm test:ci --force`: 1628 core / 371 utils / 165 app.
- [x] 5.2 `pnpm type-check`, `pnpm knip`, `pnpm lint` (0 errors), `pnpm format:check` clean.
- [x] 5.3 Playwright `e2e.yml` dispatched against the branch — the assertion that matters for a
      restyle, since it proves the class changes did not break click targets. #417 is merged, so
      pushes to the branch trigger no PR CI and the run has to be dispatched explicitly.
- [x] 5.4 Archive this change before the merge, as the last commit on the branch.
