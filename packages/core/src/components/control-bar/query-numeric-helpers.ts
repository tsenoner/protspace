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

/** The condition's presence chips, normalized to an array. */
export function presenceOf(condition: NumericCondition): string[] {
  return condition.presence ?? [];
}

/**
 * True when the condition's comparison has every bound its operator requires.
 * A condition can still be usable without bounds if it carries a presence
 * chip — see `isNumericConditionReady`.
 */
function hasNumericBounds(condition: NumericCondition): boolean {
  switch (condition.operator) {
    case 'gt':
    case 'gte':
      return condition.min !== null;
    case 'lt':
    case 'lte':
      return condition.max !== null;
    case 'between':
      return condition.min !== null && condition.max !== null;
  }
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
  if (!hasNumericBounds(condition)) return false;

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
 */
export function countNumericMatches(condition: NumericCondition, data: ProtspaceData): number {
  if (!isNumericConditionReady(condition)) return 0;
  const values = data.numeric_annotation_data?.[condition.annotation];
  if (!values) return 0;
  let count = 0;
  for (const v of values) {
    if (matchesNumericValue(v, condition)) count++;
  }
  return count;
}
