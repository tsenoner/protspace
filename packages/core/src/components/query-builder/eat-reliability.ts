import { createNumericCondition } from './query-types';
import type { NumericCondition } from './query-types';
import { presenceOf, toRange } from './query-numeric-helpers';
import {
  DEFAULT_EAT_RELIABILITY,
  NA_VALUE,
  NEUTRAL_BOUND,
  normalizeReliability,
  RELIABILITY_BOUNDS,
} from '@protspace/utils';
import type { EatReliabilityState } from '@protspace/utils';

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
  const uses = RELIABILITY_BOUNDS[mode];

  // A bound sitting at its neutral position constrains nothing, and the range is
  // inclusive on both ends — so a full-range band is no filter at all.
  const constrains = (uses.min && min > NEUTRAL_BOUND.min) || (uses.max && max < NEUTRAL_BOUND.max);
  if (!constrains) return [];

  return [
    createNumericCondition({
      annotation,
      // Curated points carry no confidence score; this chip is what retains them.
      presence: [NA_VALUE],
      ...(id === undefined ? {} : { id }),
      // Only the ends the mode reads; the other stays null, an open end.
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
    a.every((leftCondition, index) => {
      const left = toRange(leftCondition);
      const right = toRange(b[index]);
      return (
        left.annotation === right.annotation &&
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
 * spelling as the forward one: the app's EAT panel controller compares this state, by
 * value, against the state the EAT panel has normalised.
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
 * The mode follows from which ends the range has (an older query's operator read
 * through `toRange`, as the builder and the evaluator read it). Falling through to
 * `DEFAULT_EAT_RELIABILITY` for a shape with a bound would leave the user's own
 * condition invisible and snap the control back to "Hide below 0%", which is the
 * #380 symptom this file exists to fix.
 */
export function reliabilityFromConditions(
  conditions: readonly NumericCondition[],
): EatReliabilityState {
  for (const condition of conditions) {
    // A negated condition inverts which side is kept, so it cannot be read as if
    // it were the positive form.
    const negated = condition.logicalOp === 'NOT';
    const { min, max } = toRange(condition);

    if (min !== null && max !== null) {
      // A NEGATED band keeps everything OUTSIDE it, which none of the three modes can
      // express — so it is skipped rather than read as its positive form. Reading it
      // positively would show the user a band that keeps exactly what their condition
      // hides, and the next nudge of the control would silently commit that inversion
      // back into the query.
      if (!negated) return normalizeReliability({ mode: 'between', min, max });
    } else if (min !== null) {
      // "at least" keeps everything above the bound; negated, everything below it.
      return boundedBy(negated ? 'atMost' : 'atLeast', min);
    } else if (max !== null) {
      // "at most" keeps everything below the bound; negated, everything above it.
      return boundedBy(negated ? 'atLeast' : 'atMost', max);
    }
  }
  return DEFAULT_EAT_RELIABILITY;
}

/** A fraction as `50 %`, rounded, with the thin no-break space the EAT copy uses. */
export const formatPercent = (fraction: number): string => `${Math.round(fraction * 100)}\u202f%`;

/** What a reliability filter keeps, `≥ 50 %`, `≤ 40 %` or `40–60 %`; null when it keeps all. */
export function reliabilityLabel(state: EatReliabilityState): string | null {
  const { mode, min, max } = normalizeReliability(state);
  if (mode === 'atLeast') return min > 0 ? `≥ ${formatPercent(min)}` : null;
  if (mode === 'atMost') return max < 1 ? `≤ ${formatPercent(max)}` : null;
  return min > 0 || max < 1 ? `${Math.round(min * 100)}–${formatPercent(max)}` : null;
}

/** The same in words, for a screen reader: `at least 50 %`, `between 40 and 60 %`, or `any`. */
export function reliabilityWords(state: EatReliabilityState): string {
  if (!reliabilityLabel(state)) return 'any';
  const { mode, min, max } = normalizeReliability(state);
  if (mode === 'atLeast') return `at least ${formatPercent(min)}`;
  if (mode === 'atMost') return `at most ${formatPercent(max)}`;
  return `between ${Math.round(min * 100)} and ${formatPercent(max)}`;
}
