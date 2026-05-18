import type { ProtspaceData } from './types';
import type { NumericCondition, NumericOperator } from './query-types';

/**
 * Which value fields a numeric operator needs:
 * `gt` uses `min`, `lt` uses `max`, `between` uses both.
 */
export function numericFieldsFor(operator: NumericOperator): {
  min: boolean;
  max: boolean;
} {
  switch (operator) {
    case 'gt':
      return { min: true, max: false };
    case 'lt':
      return { min: false, max: true };
    case 'between':
      return { min: true, max: true };
  }
}

/**
 * True when the condition has every bound its operator requires.
 * An unready condition is treated as matching nothing.
 */
export function isNumericConditionReady(condition: NumericCondition): boolean {
  switch (condition.operator) {
    case 'gt':
      return condition.min !== null;
    case 'lt':
      return condition.max !== null;
    case 'between':
      return condition.min !== null && condition.max !== null;
  }
}

/**
 * Test a single raw numeric value against the condition.
 * `>` and `<` are exclusive; `between` is inclusive on both ends.
 *
 * TODO: sequence length is the only numeric annotation today and is always
 * present. When other numeric annotations are added, decide how a null value
 * should behave under each operator (and under a NOT-wrapped condition).
 */
export function matchesNumericValue(value: number | null, condition: NumericCondition): boolean {
  if (value === null) return false;
  const { operator, min, max } = condition;
  switch (operator) {
    case 'gt':
      return min !== null && value > min;
    case 'lt':
      return max !== null && value < max;
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
