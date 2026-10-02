/**
 * Single source of truth for missing-value handling.
 *
 * Every NA concept — what counts as missing, the canonical internal token,
 * the default display label, the default swatch color, and the normalization
 * function that runs at the data ingestion boundary — lives here.
 *
 * Downstream code MUST NOT define its own missing-value detection. Add a
 * spelling to MISSING_VALUE_TOKENS here and every consumer picks it up.
 */

/**
 * Strings that mean "this value is missing". Compared case-insensitively.
 *
 * `__na__` is here to reserve the spelling of NA_VALUE below: the bundle writer
 * drops that token unconditionally (it is the sentinel a missing cell carries),
 * so a genuine category literally spelled `__NA__` would be silently deleted on
 * export. Normalizing it to missing at ingestion makes the two agree.
 */
export const MISSING_VALUE_TOKENS: ReadonlySet<string> = new Set([
  'na',
  'n/a',
  'nan',
  'null',
  'none',
  '__na__',
]);

/** Internal identity token for NA after ingestion. Never displayed to users. */
export const NA_VALUE = '__NA__';

/** Default display label for NA in legends and tooltips. */
export const NA_DISPLAY = 'N/A';

/** Default swatch color for NA. Override-able via persisted category color (categorical only). */
export const NA_DEFAULT_COLOR = '#DDDDDD';

/**
 * Normalize a raw cell value to JS `null` if it represents missingness.
 * Otherwise return the value unchanged.
 *
 * Runs once at the ingestion boundary in conversion.ts. After this point,
 * every consumer can use the simple test `value == null` to detect missing.
 *
 * Handles:
 *   - JS null / undefined
 *   - empty or whitespace-only strings
 *   - non-finite numbers (NaN, ±Infinity)
 *   - strings matching MISSING_VALUE_TOKENS (case-insensitive, trimmed)
 */
export function normalizeMissingValue<T>(raw: T): T | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : null;
  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    if (trimmed === '') return null;
    if (MISSING_VALUE_TOKENS.has(trimmed.toLowerCase())) return null;
    return raw;
  }
  return raw;
}

/**
 * Identity check on a *normalized* legend value.
 * Use this on values that have already passed through toInternalValue.
 */
export function isNAValue(value: string): boolean {
  return value === NA_VALUE;
}

/**
 * Convert a normalized cell value to its internal legend key.
 *
 * **Precondition:** the caller has already passed the value through
 * `normalizeMissingValue` at the ingestion boundary. This function does
 * NOT detect missing-value spellings (e.g. it will NOT map the string "NA"
 * or whitespace-only strings to NA_VALUE) — it only maps `null`/`undefined`
 * to NA_VALUE and stringifies everything else via `String()`.
 */
export function toInternalValue(value: unknown): string {
  if (value === null || value === undefined) return NA_VALUE;
  return String(value);
}
