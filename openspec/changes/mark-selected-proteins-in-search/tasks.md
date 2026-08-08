## 1. Suggestion Computation

- [x] 1.1 Return `{ id, isSelected }` entries instead of dropping selected IDs.
- [x] 1.2 Budget selected and selectable entries independently, preserving the early exit.
- [x] 1.3 Rewrite the unit suite, inverting the assertions that encoded the old exclusion.

## 2. Component Rendering

- [x] 2.1 Render marked rows with `aria-selected` and a remove title.
- [x] 2.2 Delete the empty-state classification and its render-time scan.
- [x] 2.3 Cover the partial-query, prefix-collision, and empty-focus cases in jsdom.

## 3. Toggle To Remove

- [x] 3.1 Emit `remove-selection` when a marked suggestion is activated.
- [x] 3.2 Recompute suggestions on selection change, preserving the clamped highlight.
- [x] 3.3 Handle `remove-selection` in the control bar, mirroring `add-selection`.
- [x] 3.4 Scroll the keyboard-highlighted suggestion into view with `block: 'nearest'`
      as it changes, fixing the off-screen highlight past the visible area (#413).
- [x] 3.5 Wire the input as a combobox owning the listbox, so the keyboard cursor is
      announced via `aria-activedescendant` — the screen-reader half of #413 — and
      `aria-selected` keeps its multi-select listbox meaning.

## 4. Verification

- [x] 4.1 Run `openspec validate mark-selected-proteins-in-search --strict`.
- [x] 4.2 Run the full JS suite, `pnpm format:check`, and `pnpm precommit`.
- [x] 4.3 Reproduce the original demo-dataset flow in the browser and check console health.
