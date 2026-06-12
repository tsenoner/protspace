/** Hard cap on rendered search suggestions — prevents a 573K-node DOM explosion. */
export const MAX_SEARCH_SUGGESTIONS = 50;

/**
 * Compute capped autocomplete suggestions with an early-exit scan.
 * - Empty query + focused: first `limit` available IDs not already selected.
 * - Empty query + not focused: none.
 * - Non-empty query: first `limit` available IDs that (case-insensitively) start with the
 *   query and are not already selected.
 * Stops scanning as soon as `limit` matches are found (sub-ms even at 573K).
 */
export function computeSearchSuggestions(
  availableIds: readonly string[],
  selectedIds: Iterable<string>,
  query: string,
  isInputFocused: boolean,
  limit: number = MAX_SEARCH_SUGGESTIONS,
): string[] {
  const q = query.trim().toLowerCase();
  if (!q && !isInputFocused) return [];
  const selectedSet = selectedIds instanceof Set ? selectedIds : new Set(selectedIds);
  const out: string[] = [];
  for (let i = 0; i < availableIds.length; i++) {
    if (out.length >= limit) break;
    const id = availableIds[i];
    if (selectedSet.has(id)) continue;
    if (q && !id.toLowerCase().startsWith(q)) continue;
    out.push(id);
  }
  return out;
}
