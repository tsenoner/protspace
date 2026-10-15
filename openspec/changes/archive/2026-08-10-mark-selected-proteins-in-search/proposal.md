## Why

Search suggestions excluded already-selected protein IDs, so a query whose every match
was already selected produced an empty list and fell through to
`No matching protein IDs found`. With P00595-P00599 selected, searching `P0059` reported
no matches for five matching proteins. The message was false, not merely unhelpful.

An earlier attempt classified the empty state — reporting `Protein ID is already selected`
when the query exactly matched a selected ID. That covered only exact whole-ID queries
with a completely empty suggestion list, leaving partial queries still misreporting and
prefix-colliding IDs (selected `GT4` alongside unselected `GT40`-`GT46`) with no feedback
at all, because the list was non-empty.

## What Changes

- Already-selected proteins stay in the suggestion list, marked, instead of being dropped.
- Selected and selectable entries draw from independent display budgets, so addable
  proteins stay visible however many matches are already selected.
- Activating a marked suggestion removes that protein; removal preserves the query so
  several proteins can be pruned from one result set.
- Focusing an empty search input now surfaces current selections alongside selectable entries.
- The empty-state classification is removed; `No matching protein IDs found` now renders
  only when nothing matches, which also removes a per-keystroke scan from `render()`.
- Arrow-key navigation of the suggestion list now works: the highlight is no longer
  reset on every keypress, so Enter activates the row the user highlighted rather
  than always the first one.
- The keyboard-highlighted suggestion is now scrolled into view as the highlight moves,
  fixing a regression (#413) exposed by the above: past the ~8 visible rows of the
  scrollable suggestion list, the highlight moved off-screen with nothing scrolling it
  back into view.

## Impact

- Affected specs: `protein-search-feedback`
- Affected code: `packages/core/src/components/control-bar/search-suggestions.ts`,
  `search.ts`, `search.styles.ts`, `control-bar.ts`
- Verification: unit coverage in `search-suggestions.test.ts`, custom-element coverage in
  `search.component.test.ts`, plus manual browser verification against the demo dataset.
  No Playwright test is added — see `design.md` on why component-level coverage was chosen.
- Behaviour changes: pressing Enter on an already-selected ID now removes it (previously
  a no-op); focusing the empty input now lists current selections; arrow-key navigation
  now advances past the first row, and Enter activates the highlighted row rather than
  always the first. Arrow-key navigation past the visible area previously left the
  highlight off-screen with nothing indicating which row Enter would activate (#413);
  the highlighted row is now scrolled into view as it changes.
