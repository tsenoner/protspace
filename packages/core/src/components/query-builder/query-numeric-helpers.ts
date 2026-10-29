import type { ProtspaceData } from './types';
import type { NumericCondition } from './query-types';
import { ANY_VALUE } from './query-types';
import { NA_VALUE, readNumericValue } from '@protspace/utils';

/**
 * Shared empty result for `presenceOf`, which runs once per protein row.
 * Frozen because it is handed out to every chip-less condition: one stray
 * mutation through a cast would give them all a presence chip.
 */
const NO_PRESENCE: readonly string[] = Object.freeze([]);

/** The condition's presence chips, normalized to an array. */
export function presenceOf(condition: NumericCondition): readonly string[] {
  return condition.presence ?? NO_PRESENCE;
}

/** True when the range has at least one end; the other may be open. */
function hasNumericBounds(condition: NumericCondition): boolean {
  return condition.min !== null || condition.max !== null;
}

/**
 * True when the condition constrains anything at all: its range has an end, OR it
 * carries `ANY_VALUE` ("has a value": the full range with N/A left out). With no end
 * and no `ANY_VALUE` it is the full range with N/A included, a match-all no-op: a
 * fresh card, or an older "has no value" query (`presence: [NA_VALUE]`, no bounds),
 * which loads as that full range because a card can no longer keep only the N/A rows.
 */
export function isNumericConditionReady(condition: NumericCondition): boolean {
  return hasNumericBounds(condition) || presenceOf(condition).includes(ANY_VALUE);
}

/** What a numeric card edits: the range's ends (null: no limit) and whether N/A is kept. */
export interface NumericRangeEdit {
  min: number | null;
  max: number | null;
  na: boolean;
}

/**
 * The condition as its card shows it. Agrees with the evaluator on every stored form: no end
 * keeps N/A unless `ANY_VALUE` leaves it out, and `ANY_VALUE` (an older "has any value") reads as
 * the full range whatever ends it carries, since it matched every value.
 */
export function readRange(condition: NumericCondition): NumericRangeEdit {
  const presence = presenceOf(condition);
  if (presence.includes(ANY_VALUE))
    return { min: null, max: null, na: presence.includes(NA_VALUE) };
  const { min, max } = condition;
  return { min, max, na: presence.includes(NA_VALUE) || (min === null && max === null) };
}

/**
 * The condition holding `edit`, in its one stored form: the full range with N/A kept stores no
 * presence (the untouched no-op), without N/A stores `ANY_VALUE`; a narrowed range stores
 * `NA_VALUE` when it keeps N/A.
 */
export function writeRange(condition: NumericCondition, edit: NumericRangeEdit): NumericCondition {
  const full = edit.min === null && edit.max === null;
  const presence = full ? (edit.na ? [] : [ANY_VALUE]) : edit.na ? [NA_VALUE] : [];
  return { ...condition, min: edit.min, max: edit.max, presence };
}

/**
 * Test a single raw numeric value against the condition's range, `min <= value <= max`, a null
 * end open.
 *
 * Null (missing) values are matched ONLY by an explicit `NA_VALUE` presence
 * chip — no range ever matches a null, since a missing value sits outside the
 * numeric domain. `ANY_VALUE` conversely matches every non-null value regardless
 * of the range. Presence chips are unioned with the range, so `min: 0.5` plus an
 * N/A chip reads "at least 0.5, or no value at all".
 *
 * This is what the `__eat_confidence` reliability filter uses: curated points
 * carry no confidence score (null), so the slider synthesizes
 * `>= X` + N/A chip to hide sub-threshold predictions while keeping curated
 * points visible. It states that intent directly rather than relying on `NOT`
 * to sweep nulls back in via an index complement — `NOT` now means "has a
 * value AND does not match", so it excludes nulls (see query-evaluate.ts).
 */
export function matchesNumericValue(value: number | null, condition: NumericCondition): boolean {
  const presence = presenceOf(condition);

  if (value === null) return presence.includes(NA_VALUE);
  if (presence.includes(ANY_VALUE)) return true;

  const { min, max } = condition;
  if (min === null && max === null) return false;
  return (min === null || value >= min) && (max === null || value <= max);
}

/**
 * Count how many proteins match a numeric condition on its own.
 * Returns 0 for an unready condition or a missing annotation.
 *
 * Walks the protein count (not the value array's length) and normalizes a
 * missing slot to null, exactly like `evaluateNumericCondition` — otherwise a
 * short/sparse column would leave rows uncounted that the filter itself matches
 * via an N/A presence chip, and the live preview would undershoot the result.
 *
 * `protein_ids` is the sole source of the row count, down to the `?? 0` that
 * makes a dataset without it count nothing: `evaluateQuery` returns ∅ for that
 * same data, and a preview that disagreed with the result would reopen the very
 * gap this walk exists to close.
 */
export function countNumericMatches(condition: NumericCondition, data: ProtspaceData): number {
  if (!isNumericConditionReady(condition)) return 0;
  const values = data.numeric_annotation_data?.[condition.annotation];
  if (!values) return 0;
  const numProteins = data.protein_ids?.length ?? 0;
  let count = 0;
  for (let i = 0; i < numProteins; i++) {
    if (matchesNumericValue(readNumericValue(values, i), condition)) count++;
  }
  return count;
}

/**
 * A numeric bound as the card says it: grouped digits and at most 3 decimals, except below 1,
 * where 3 significant digits keep a small bound (0.0004) from reading as 0.
 */
export function formatBound(value: number): string {
  const small = value !== 0 && Math.abs(value) < 1;
  return value.toLocaleString(
    'en-US',
    small ? { maximumSignificantDigits: 3 } : { maximumFractionDigits: 3 },
  );
}
