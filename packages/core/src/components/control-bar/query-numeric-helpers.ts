import type { ProtspaceData } from './types';
import type { NumericCondition, NumericOperator } from './query-types';
import { ANY_VALUE } from './query-types';
import { NA_VALUE } from '@protspace/utils';

/**
 * Which value fields a numeric operator needs:
 * `gt`/`gte` use `min`, `lt`/`lte` use `max`, `between` uses both.
 */
export function numericFieldsFor(operator: NumericOperator): {
  min: boolean;
  max: boolean;
} {
  switch (operator) {
    case 'gt':
    case 'gte':
      return { min: true, max: false };
    case 'lt':
    case 'lte':
      return { min: false, max: true };
    case 'between':
      return { min: true, max: true };
  }
}

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

/**
 * True when the condition's comparison has every bound its operator requires.
 * Derived from `numericFieldsFor` so the operator → required-bounds table is
 * stated once; a new operator only has to be added there.
 * A condition can still be usable without bounds if it carries a presence
 * chip — see `isNumericConditionReady`.
 */
function hasNumericBounds(condition: NumericCondition): boolean {
  const fields = numericFieldsFor(condition.operator);
  return (!fields.min || condition.min !== null) && (!fields.max || condition.max !== null);
}

/**
 * True when the condition constrains anything at all: it has the bounds its
 * operator requires, OR it carries a presence chip (`is N/A` / `has any
 * value`), which is meaningful on its own. This is the single readiness rule,
 * matching the categorical side where any selected value counts.
 * An unready condition is a match-all no-op.
 */
export function isNumericConditionReady(condition: NumericCondition): boolean {
  return hasNumericBounds(condition) || presenceOf(condition).length > 0;
}

/**
 * Test a single raw numeric value against the condition.
 * `>` and `<` are exclusive; `>=`, `<=` and `between` are inclusive.
 *
 * Null (missing) values are matched ONLY by an explicit `NA_VALUE` presence
 * chip — no comparison operator ever matches a null, since a missing value
 * sits outside the numeric domain. `ANY_VALUE` conversely matches every
 * non-null value regardless of the comparison. Presence chips are unioned with
 * the comparison, so `>= 0.5` plus an N/A chip reads "at least 0.5, or no
 * value at all".
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

  // No explicit bounds guard: every case below already returns false when the
  // bound its operator needs is null, which is exactly `!hasNumericBounds`.
  const { operator, min, max } = condition;
  switch (operator) {
    case 'gt':
      return min !== null && value > min;
    case 'gte':
      return min !== null && value >= min;
    case 'lt':
      return max !== null && value < max;
    case 'lte':
      return max !== null && value <= max;
    case 'between':
      return min !== null && max !== null && value >= min && value <= max;
  }
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
    if (matchesNumericValue(values[i] ?? null, condition)) count++;
  }
  return count;
}
