## Context

`computeSearchSuggestions` dropped selected IDs from the suggestion list, so the component
could not distinguish "nothing matched" from "everything that matched is already selected".
The empty-state renderer treated both as a generic no-match.

## Goals

- A query that matches already-selected proteins never reports that nothing matched.
- Feedback works for partial queries, not only exact whole-ID queries.
- Feedback works when the suggestion list is non-empty, not only when it is empty.
- No per-keystroke work is added to `render()`.

## Non-Goals

- Substring or fuzzy matching. Suggestions remain prefix-only.
- Changes to paste handling, which routes through bulk add and only ever adds.
- Changes to structure-viewer behaviour on removal.
- Virtualised rendering of the suggestion list.

## Decisions

**Mark rather than classify.** Classifying the empty-state message requires the query to
be an exact ID _and_ the list to be empty. Both conditions are reachable-but-wrong in the
149-ID dataset from the original report. Keeping selected entries in the list removes the
distinction entirely: there is one rule, and the no-match message becomes truthful.

**Independent budgets.** Selected entries use a 10-entry budget separate from the 50-entry
selectable cap. A single shared cap would let 50+ selected matches fill the list and hide
every addable protein. The scan still exits early once the selectable budget is full and
the selected budget is either full or exhausted — exhausted meaning every selected ID has
been walked past, tracked by a `selectedSeen` counter. Requiring both budgets to be _full_
would never early-exit when fewer than ten matches are selected, so the counter is what
preserves the sub-millisecond behaviour on 573K IDs.

**Natural order, not grouped.** Entries stay in `availableProteinIds` order and are
interleaved. Grouping would reorder results relative to what users see today.

**Asymmetric query handling.** Adding clears the query; removing preserves it. After
adding you typically search for the next protein; after removing you typically prune
within the current result set. The alternative — both preserving — regresses the
single-ID search-and-add flow that this change originated from.

**Recompute changed inputs only while open.** `searchSuggestions` is computed on a debounce,
so a preserved query would leave a stale list after a removal, and an open no-match result
would stay stale when `availableProteinIds` changes. A dedicated open-state flag distinguishes
that empty result from a closed dropdown. A `willUpdate` hook recomputes when either input
changes while the dropdown is open, preserving the highlight index clamped to the new length
without reopening after add, Escape, or blur.

**Conditional suggestion flush.** `_flushSuggestions` recomputed on every Enter or arrow
keypress, resetting the highlight to 0 before the key handler read it — so arrow
navigation could not advance and Enter always activated the first row. That was merely
annoying while Enter could only add; it becomes destructive once Enter can remove. The
flush now returns early unless a suggestion debounce is actually pending, which is the
only condition it exists to settle.

**Scroll the highlight with `block: 'nearest'` (#413).** Fixing the flush bug above
exposed a follow-on problem: `.search-suggestions` is a fixed-height (`max-height: 20rem`)
scroll container fitting ~8 rows, and arrow navigation never scrolled the newly
highlighted row into view, so past the visible area the user navigated blind. An
`updated` hook scrolls the highlighted row via `scrollIntoView({ block: 'nearest' })`
rather than `'center'` or the default (`'start'`): `'nearest'` only moves the scroll
position when the row is actually outside the visible area, so the list never jumps
once the highlighted row is already visible — `'center'` or `'start'` would re-center or
re-align the list on every keypress even when no scrolling was needed.

## Testing

Component-level coverage in jsdom drives the real custom element through its input and
debounce, which is where the original bug lived. A Playwright test was considered and
rejected: the behaviour is fully determined by the component's own inputs, so a browser
test would duplicate the component test at much higher cost, and the repository's E2E
suite is label-gated and does not run on pull requests by default. The composed flow is
verified manually in the browser against the demo dataset instead.
