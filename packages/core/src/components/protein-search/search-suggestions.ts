/** Hard cap on rendered selectable suggestions — prevents a 573K-node DOM explosion. */
export const MAX_SEARCH_SUGGESTIONS = 50;

/**
 * Hard cap on rendered already-selected suggestions. Budgeted separately from
 * `MAX_SEARCH_SUGGESTIONS` so that selectable entries stay visible no matter how many
 * prefix matches are already selected.
 */
export const MAX_SELECTED_SUGGESTIONS = 10;

/** One row of the suggestion dropdown. */
export interface SearchSuggestion {
  id: string;
  /** True when this protein is already in the current selection. */
  isSelected: boolean;
}

/**
 * How many marked rows this query can actually produce, capped at `cap`.
 *
 * The scan needs a target it can *reach*: `selectedLimit` alone is unreachable whenever the
 * selection is smaller than the budget, and "every selected ID walked past" is only reached
 * at the highest index any selected ID happens to occupy — which, for selections made by
 * clicking scatter-plot points, is an arbitrary position in a 573K-entry array. Either way
 * the loop would keep scanning long after it had emitted every row it can, on every
 * debounced keystroke, every Enter/Arrow flush, and every selection echo.
 *
 * Counting the matches up front is O(|selection|) and bounded by `cap`, and it leaves the
 * ordering contract alone — marked rows still come out in `availableIds` order, because the
 * scan still finds them there.
 *
 * Two assumptions about `availableIds`, both of which the caller already relies on
 * everywhere else it treats a protein ID as a key:
 * - Every selected ID appears in it. One that does not inflates the target and degrades the
 *   scan to a full pass — correct, just slow, and the two lists come from the same dataset.
 * - No ID appears twice. A duplicate of a *selected* ID is emitted once rather than once per
 *   occurrence, since the target counts distinct IDs.
 */
function countMatchingSelected(selected: Iterable<string>, q: string, cap: number): number {
  let matches = 0;
  for (const id of selected) {
    if (q && !id.toLowerCase().startsWith(q)) continue;
    if (++matches >= cap) return cap;
  }
  return matches;
}

/**
 * Compute capped autocomplete suggestions with an early-exit scan.
 * - Empty query + focused: current selections plus the first selectable IDs.
 * - Empty query + not focused: none.
 * - Non-empty query: IDs that (case-insensitively) start with the query.
 *
 * Already-selected IDs are returned marked rather than dropped, so callers can render
 * them as removable rows instead of misreporting an empty result. Selected and
 * selectable entries draw from independent budgets and are returned in natural
 * `availableIds` order — they are interleaved, not grouped.
 *
 * Stops scanning once both budgets are met, so the scan length is proportional to the
 * budgets rather than to the dataset. Meeting the selected budget is the subtle half —
 * see `countMatchingSelected`.
 */
export function computeSearchSuggestions(
  availableIds: readonly string[],
  selectedIds: Iterable<string>,
  query: string,
  isInputFocused: boolean,
  limit: number = MAX_SEARCH_SUGGESTIONS,
  selectedLimit: number = MAX_SELECTED_SUGGESTIONS,
): SearchSuggestion[] {
  const q = query.trim().toLowerCase();
  if (!q && !isInputFocused) return [];
  const selectedSet = selectedIds instanceof Set ? selectedIds : new Set(selectedIds);
  const selectedTarget = countMatchingSelected(selectedSet, q, selectedLimit);
  const out: SearchSuggestion[] = [];
  let selectableCount = 0;
  let selectedCount = 0;

  for (let i = 0; i < availableIds.length; i++) {
    if (selectableCount >= limit && selectedCount >= selectedTarget) break;
    const id = availableIds[i];
    const isSelected = selectedSet.has(id);
    // Budget before prefix test: an entry whose own budget is full is dropped either way,
    // so testing it first skips a throwaway `toLowerCase()` on every entry the scan passes
    // while waiting for the other budget to fill. The marked side tests `selectedTarget`,
    // not `selectedLimit` — once every marked row this query can produce has been emitted
    // no further selected entry can qualify, so a duplicate occurrence of an already-emitted
    // ID is skipped rather than rendered twice.
    if (isSelected ? selectedCount >= selectedTarget : selectableCount >= limit) continue;
    if (q && !id.toLowerCase().startsWith(q)) continue;

    out.push({ id, isSelected });
    if (isSelected) selectedCount++;
    else selectableCount++;
  }

  return out;
}
