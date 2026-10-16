import { createNumericCondition } from './query-types';
import type { NumericCondition, NumericOperator } from './query-types';
import { numericFieldsFor, presenceOf } from './query-numeric-helpers';
import {
  DEFAULT_EAT_RELIABILITY,
  NA_VALUE,
  NEUTRAL_BOUND,
  normalizeReliability,
} from '@protspace/utils';
import type { EatReliabilityMode, EatReliabilityState } from '@protspace/utils';

/**
 * The EAT reliability filter's user-facing model, and its translation to and from
 * query conditions.
 *
 * ## Why every mode carries an N/A chip
 *
 * Curated proteins have no prediction, so they carry `null` in the eat-confidence
 * column and no comparison can match them. The presence chip is what keeps them
 * visible: `>= X` with `[NA_VALUE]` reads "reliable enough, **or** not an EAT
 * prediction at all". Every mode therefore states its intent directly, as one
 * un-negated condition:
 *
 *   at least X    ->  confidence >= X   or N/A
 *   at most  X    ->  confidence <= X   or N/A
 *   between A,B   ->  confidence between A and B (inclusive), or N/A
 *
 * The predecessor spelled the first of these `NOT(confidence < X)`, which worked
 * only because `NOT` was a bare index complement that happened to sweep nulls back
 * in. `NOT` now means "has a value AND does not match", so the negated form would
 * hide curated points instead — the exact opposite of what the control promises.
 */

/**
 * The operator each mode states itself with. `Record` over the mode union, so a fourth
 * mode is a compile error here rather than a silently unfiltered query — and pairing it
 * with `numericFieldsFor` means the bounds a condition carries are decided by the
 * operator that will read them, not by a second hand-written mode table.
 */
const OPERATOR_FOR_MODE: Record<EatReliabilityMode, NumericOperator> = {
  atLeast: 'gte',
  atMost: 'lte',
  between: 'between',
};

/**
 * The owned condition expressing `state`, or none when nothing is constrained.
 *
 * `id` carries the identity of the condition being replaced. The query builder keys
 * a row's live match count and its in-progress bound text by condition id, so minting
 * a fresh id on every commit makes the row fall back to the global count and discards
 * a half-typed bound while the user is still typing it.
 */
export function conditionsForReliability(
  annotation: string,
  state: EatReliabilityState,
  id?: string,
): NumericCondition[] {
  // Normalize here, so no caller can emit an inverted band or a stale unused bound.
  const { mode, min, max } = normalizeReliability(state);
  const operator = OPERATOR_FOR_MODE[mode];
  const uses = numericFieldsFor(operator);

  // A bound sitting at its neutral position constrains nothing, and `between` is
  // inclusive on both ends — so a full-range band is no filter at all.
  const constrains = (uses.min && min > NEUTRAL_BOUND.min) || (uses.max && max < NEUTRAL_BOUND.max);
  if (!constrains) return [];

  return [
    createNumericCondition({
      annotation,
      // Curated points carry no confidence score; this chip is what retains them.
      presence: [NA_VALUE],
      ...(id === undefined ? {} : { id }),
      operator,
      // Only the bounds the operator reads; the rest stay null, as the query builder
      // renders and evaluates them.
      ...(uses.min ? { min } : {}),
      ...(uses.max ? { max } : {}),
    }),
  ];
}

/**
 * Multiset equality, not "same length and every left member appears on the right" —
 * that reported `['NA','NA']` equal to `['NA','ANY']`, which is the difference between
 * retaining curated points and matching every protein.
 */
function samePresence(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  const left = [...a].sort();
  const right = [...b].sort();
  return left.every((value, index) => value === right[index]);
}

/**
 * Do these two lists express the same filter? `id` is identity rather than meaning,
 * so it is ignored.
 *
 * The mirror's guard compares conditions rather than the states they came from
 * because state -> conditions is not injective: `atMost 0..1` and `between 0..1`
 * both constrain nothing and emit nothing, while an empty query reads back as the
 * `atLeast` default. Comparing derived states therefore never matched at those two
 * positions and re-applied the whole filter on every emit.
 *
 * Only NEGATION is compared, not the raw `logicalOp`. The surrounding query owns the
 * `AND`/`OR` connector — `replaceConditionsForAnnotation` re-imposes whatever the
 * replaced slot carried — while `conditionsForReliability` always emits a bare
 * condition. Comparing them raw meant a reliability condition that was not first in
 * its list ("AND" vs `undefined`) never matched, so every repeat emit rebuilt the
 * query and re-evaluated the whole dataset for a no-op.
 */
export function sameConditions(
  a: readonly NumericCondition[],
  b: readonly NumericCondition[],
): boolean {
  return (
    a.length === b.length &&
    a.every((left, index) => {
      const right = b[index];
      return (
        left.annotation === right.annotation &&
        left.operator === right.operator &&
        left.min === right.min &&
        left.max === right.max &&
        (left.logicalOp === 'NOT') === (right.logicalOp === 'NOT') &&
        samePresence(presenceOf(left), presenceOf(right))
      );
    })
  );
}

/**
 * A one-sided mode carrying the single bound it filters on, canonicalised. Going
 * through `normalizeReliability` is what keeps the reverse mirror speaking the same
 * spelling as the forward one: the control bar records this state and later compares
 * it, by value, against a state the legend has normalised.
 */
function boundedBy(mode: 'atLeast' | 'atMost', bound: number): EatReliabilityState {
  return normalizeReliability(
    mode === 'atLeast'
      ? { mode, min: bound, max: NEUTRAL_BOUND.max }
      : { mode, min: NEUTRAL_BOUND.min, max: bound },
  );
}

/**
 * Recover the control's position from the conditions it owns — the reverse mirror.
 * A shape it does not recognise degrades to whichever bound is present rather than
 * silently resetting to 0, which is what made a hand-built condition invisible.
 *
 * Which bound an operator carries comes from `numericFieldsFor`, the same table the
 * builder and the evaluator read. Restating it here as an operator switch meant a
 * sixth `NumericOperator` would fall through to `DEFAULT_EAT_RELIABILITY` — the user's
 * own condition invisible and the control snapped back to "Hide below 0%", which is
 * the #380 symptom this file exists to fix.
 */
export function reliabilityFromConditions(
  conditions: readonly NumericCondition[],
): EatReliabilityState {
  for (const condition of conditions) {
    // A negated condition inverts which side is kept, so it cannot be read as if
    // it were the positive form.
    const negated = condition.logicalOp === 'NOT';
    const { min, max } = numericFieldsFor(condition.operator);

    if (min && max) {
      // A NEGATED band keeps everything OUTSIDE it, which none of the three modes can
      // express — so it is skipped rather than read as its positive form. Reading it
      // positively would show the user a band that keeps exactly what their condition
      // hides, and the next nudge of the control would silently commit that inversion
      // back into the query.
      if (!negated && condition.min !== null && condition.max !== null) {
        return normalizeReliability({ mode: 'between', min: condition.min, max: condition.max });
      }
    } else if (min) {
      // `>`/`>=` keep everything above the bound; negated, everything below it.
      if (condition.min !== null) return boundedBy(negated ? 'atMost' : 'atLeast', condition.min);
    } else if (condition.max !== null) {
      // `<`/`<=` keep everything below the bound; negated, everything above it.
      return boundedBy(negated ? 'atLeast' : 'atMost', condition.max);
    }
  }
  return DEFAULT_EAT_RELIABILITY;
}
