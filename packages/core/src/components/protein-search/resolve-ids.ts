/** The most missing IDs a search report lists; "and N more" says how many it leaves out. */
export const REPORT_MISSING_LIMIT = 50;

/** A pasted list as IDs: split on whitespace, commas and semicolons, empties dropped, deduped. */
export function parsePastedIds(text: string): string[] {
  return [...new Set(text.split(/[\s,;]+/).filter(Boolean))];
}

// Keyed by the array the search was handed, so a paste at 573K proteins builds each index once
// per dataset, not once per paste; a new dataset is a new array and the old index is collected.
const exactIndexes = new WeakMap<readonly string[], ReadonlySet<string>>();
const lowerIndexes = new WeakMap<readonly string[], ReadonlyMap<string, string>>();

function exactIndex(available: readonly string[]): ReadonlySet<string> {
  let index = exactIndexes.get(available);
  if (!index) {
    index = new Set(available);
    exactIndexes.set(available, index);
  }
  return index;
}

/**
 * Lower-case spelling → the dataset's own spelling, built once per `available` array; the first
 * protein wins a collision.
 */
export function lowerCaseIndex(available: readonly string[]): ReadonlyMap<string, string> {
  let index = lowerIndexes.get(available);
  if (!index) {
    const built = new Map<string, string>();
    for (const id of available) {
      const key = id.toLowerCase();
      if (!built.has(key)) built.set(key, id);
    }
    index = built;
    lowerIndexes.set(available, index);
  }
  return index;
}

/**
 * Which of `tokens` name a protein in `available`: exact spelling first, then case-insensitively,
 * always reported in the dataset's spelling and once per protein. `found` are not selected yet,
 * `alreadySelected` are, `missing` are the tokens as pasted. The lower-case index is built only
 * when a token does not match exactly.
 */
export function resolveProteinIds(
  tokens: readonly string[],
  available: readonly string[],
  selected: readonly string[],
): { found: string[]; alreadySelected: string[]; missing: string[] } {
  const exact = exactIndex(available);
  let lower: ReadonlyMap<string, string> | undefined;
  const chosen = new Set(selected);
  const seen = new Set<string>();
  const found: string[] = [];
  const alreadySelected: string[] = [];
  const missing: string[] = [];
  for (const token of tokens) {
    let id: string | undefined = exact.has(token) ? token : undefined;
    if (id === undefined) {
      lower ??= lowerCaseIndex(available);
      id = lower.get(token.toLowerCase());
    }
    if (id === undefined) {
      missing.push(token);
      continue;
    }
    if (seen.has(id)) continue;
    seen.add(id);
    (chosen.has(id) ? alreadySelected : found).push(id);
  }
  return { found, alreadySelected, missing };
}
