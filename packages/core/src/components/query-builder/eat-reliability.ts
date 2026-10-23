import { createNumericCondition } from './query-types';
import type { NumericCondition } from './query-types';
import { presenceOf, toRange } from './query-numeric-helpers';
import {
  DEFAULT_EAT_RELIABILITY,
  NA_VALUE,
  NEUTRAL_BOUND,
  normalizeReliability,
} from '@protspace/utils';
import type { EatReliabilityInput, EatReliabilityState } from '@protspace/utils';

/**
 * The EAT reliability filter's user-facing model, and its translation to and from
 * query conditions.
 *
 * ## Why the condition carries an N/A chip
 *
 * Curated proteins have no prediction, so they carry `null` in the eat-confidence
 * column and no comparison can match them. The presence chip is what keeps them
 * visible: `>= X` with `[NA_VALUE]` reads "reliable enough, **or** not an EAT
 * prediction at all". The range therefore states its intent directly, as one
 * un-negated condition, with an end left open when it sits at its neutral position:
 *
 *   A..1   ->  confidence >= A   or N/A
 *   0..B   ->  confidence <= B   or N/A
 *   A..B   ->  confidence between A and B (inclusive), or N/A
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
  state: EatReliabilityInput,
  id?: string,
): NumericCondition[] {
  // Normalize here, so no caller can emit an inverted band.
  const { min, max } = normalizeReliability(state);

  // A bound sitting at its neutral position constrains nothing, and the range is
  // inclusive on both ends — so a full-range band is no filter at all.
  const usesMin = min > NEUTRAL_BOUND.min;
  const usesMax = max < NEUTRAL_BOUND.max;
  if (!usesMin && !usesMax) return [];

  return [
    createNumericCondition({
      annotation,
      // Curated points carry no confidence score; this chip is what retains them.
      presence: [NA_VALUE],
      ...(id === undefined ? {} : { id }),
      // Only the ends that constrain; the other stays null, an open end.
      ...(usesMin ? { min } : {}),
      ...(usesMax ? { max } : {}),
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
 * because state -> conditions need not be injective (the legacy modes spelled "no filter"
 * several ways); conditions are what the query actually holds.
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
 * Recover the control's position from the conditions it owns — the reverse mirror.
 * A shape it does not recognise degrades to whichever bound is present rather than
 * silently resetting to 0, which is what made a hand-built condition invisible.
 *
 * The range follows from which ends the condition has (an older query's operator read
 * through `toRange`, as the builder and the evaluator read it); an open end is the
 * neutral bound. Falling through to `DEFAULT_EAT_RELIABILITY` for a shape with a bound
 * would leave the user's own condition invisible and snap the control back to the full
 * range, which is the #380 symptom this file exists to fix.
 */
export function reliabilityFromConditions(
  conditions: readonly NumericCondition[],
): EatReliabilityState {
  for (const condition of conditions) {
    // A negated condition cannot be read as a range of the control: NOT keeps only what has a
    // value and misses the range, so even NOT(>= min) is "below min, without the curated N/A
    // proteins", which the control (it keeps N/A) cannot express. Reading it as a range would
    // show what the condition does not keep, and the next nudge would commit that reading back
    // into the query. It is skipped, like any shape the control does not own.
    if (condition.logicalOp === 'NOT') continue;
    const { min, max } = toRange(condition);
    if (min !== null || max !== null) {
      return normalizeReliability({ min: min ?? NEUTRAL_BOUND.min, max: max ?? NEUTRAL_BOUND.max });
    }
  }
  return DEFAULT_EAT_RELIABILITY;
}

/** A fraction as `50 %`, rounded, with the thin no-break space the EAT copy uses. */
export const formatPercent = (fraction: number): string => `${Math.round(fraction * 100)}\u202f%`;

/**
 * `formatPercent` for a prediction judged against `state`: one the range leaves out never reads
 * as a range end, so 0.496 outside `50\u2013100 %` is `49.6 %`, not `50 %` (cut toward the side it
 * falls on).
 */
export function formatReliabilityIn(confidence: number, state: EatReliabilityInput): string {
  const { min, max } = normalizeReliability(state);
  const whole = Math.round(confidence * 100);
  if (confidence < min && whole >= Math.round(min * 100)) {
    return `${(Math.floor(confidence * 1000 + 1e-9) / 10).toFixed(1)}\u202f%`;
  }
  if (confidence > max && whole <= Math.round(max * 100)) {
    return `${(Math.ceil(confidence * 1000 - 1e-9) / 10).toFixed(1)}\u202f%`;
  }
  return formatPercent(confidence);
}

/** `50–100 %`, the range with both ends, as the EAT panel, the legend and the plot chip say it. */
export function rangeText(state: EatReliabilityInput): string {
  const { min, max } = normalizeReliability(state);
  return `${Math.round(min * 100)}–${formatPercent(max)}`;
}

/**
 * What a reliability filter keeps, by which ends moved: `≥ 61 %` (only the low end), `≤ 80 %`
 * (only the high end) or `30–80 %` (both); null when it keeps all.
 */
export function reliabilityLabel(state: EatReliabilityInput): string | null {
  const { min, max } = normalizeReliability(state);
  const low = min > NEUTRAL_BOUND.min;
  const high = max < NEUTRAL_BOUND.max;
  if (low && high) return `${Math.round(min * 100)}–${formatPercent(max)}`;
  if (low) return `≥ ${formatPercent(min)}`;
  if (high) return `≤ ${formatPercent(max)}`;
  return null;
}

/** The same in words, for a screen reader: `at least 50 %`, `between 40 and 60 %`, or `any`. */
export function reliabilityWords(state: EatReliabilityInput): string {
  const { min, max } = normalizeReliability(state);
  const low = min > NEUTRAL_BOUND.min;
  const high = max < NEUTRAL_BOUND.max;
  if (low && high) return `between ${Math.round(min * 100)} and ${formatPercent(max)}`;
  if (low) return `at least ${formatPercent(min)}`;
  if (high) return `at most ${formatPercent(max)}`;
  return 'any';
}
