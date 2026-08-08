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
 * Stops scanning once the selectable budget is full AND the selected budget is either
 * full or exhausted (every selected ID has been walked past, tracked by `selectedSeen`).
 *
 * With no selection that is sub-ms even at 573K. With one, the exhausted clause can only
 * fire after the loop passes the *highest index* of any selected ID — and since selections
 * come from clicking scatter-plot points, those indices are arbitrary, so the expected scan
 * length for k selections is `N·k/(k+1)`: half the array for one selection, 90% for three.
 * Measured at 573K that is ~4 ms for one selection and ~9-10 ms for three or more, per
 * debounced keystroke plus every Enter/Arrow flush and every selection echo. That is the
 * typical cost of having a selection, not a worst case.
 *
 * Bounding it properly means breaking on the selectable budget alone and topping the
 * selected budget up from `selectedIds` directly — O(50 + |selection|), ~0.2 ms — at the
 * price of ordering overflow marked rows by selection rather than by `availableIds` index.
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
  const out: SearchSuggestion[] = [];
  let selectableCount = 0;
  let selectedCount = 0;
  let selectedSeen = 0;

  for (let i = 0; i < availableIds.length; i++) {
    // The selected budget is done when it is full OR when every selected ID has been
    // passed — without the second clause a selection smaller than `selectedLimit` would
    // keep this loop scanning to the end of a 573K-entry array on every recompute.
    if (
      selectableCount >= limit &&
      (selectedCount >= selectedLimit || selectedSeen >= selectedSet.size)
    ) {
      break;
    }
    const id = availableIds[i];
    const isSelected = selectedSet.has(id);
    if (isSelected) selectedSeen++;
    if (q && !id.toLowerCase().startsWith(q)) continue;

    if (isSelected) {
      if (selectedCount >= selectedLimit) continue;
      out.push({ id, isSelected: true });
      selectedCount++;
    } else {
      if (selectableCount >= limit) continue;
      out.push({ id, isSelected: false });
      selectableCount++;
    }
  }

  return out;
}
