import { describe, expect, it } from 'vitest';
import { DEFAULT_EAT_RELIABILITY, NA_VALUE } from '@protspace/utils';
import type { EatReliabilityState } from '@protspace/utils';
import { conditionsForReliability, reliabilityFromConditions } from './eat-reliability';
import { createNumericCondition } from './query-types';

const KEY = 'ec__eat_confidence';

const MODES: EatReliabilityState[] = [
  { mode: 'atLeast', min: 0.3, max: 1 },
  { mode: 'atMost', min: 0, max: 0.7 },
  { mode: 'between', min: 0.3, max: 0.7 },
];

describe('conditionsForReliability', () => {
  it('emits nothing at the default, so a fresh dataset has a clean filter box', () => {
    expect(conditionsForReliability(KEY, DEFAULT_EAT_RELIABILITY)).toEqual([]);
  });

  it('keeps curated points via the N/A chip in every mode', () => {
    // Curated proteins carry a null confidence, so no comparison matches them.
    // The presence chip is the only thing that retains them — and under the
    // N/A-aware NOT there is no negation trick to fall back on.
    for (const state of MODES) {
      const conditions = conditionsForReliability(KEY, state);
      expect(conditions).toHaveLength(1);
      expect(conditions[0]?.presence).toContain(NA_VALUE);
      expect(conditions[0]?.logicalOp).not.toBe('NOT');
      expect(conditions[0]?.annotation).toBe(KEY);
    }
  });

  it('states each mode directly rather than negating its opposite', () => {
    expect(conditionsForReliability(KEY, MODES[0]!)[0]).toMatchObject({
      operator: 'gte',
      min: 0.3,
    });
    expect(conditionsForReliability(KEY, MODES[1]!)[0]).toMatchObject({
      operator: 'lte',
      max: 0.7,
    });
    expect(conditionsForReliability(KEY, MODES[2]!)[0]).toMatchObject({
      operator: 'between',
      min: 0.3,
      max: 0.7,
    });
  });

  it('omits a bound that constrains nothing', () => {
    expect(conditionsForReliability(KEY, { mode: 'atMost', min: 0, max: 1 })).toHaveLength(0);
    expect(conditionsForReliability(KEY, { mode: 'between', min: 0, max: 1 })).toHaveLength(0);
  });

  it('normalizes on the way in, so no caller can emit an inverted band', () => {
    // `normalizeReliability` itself is covered in @protspace/utils, where it lives;
    // what matters here is that the translation applies it.
    expect(conditionsForReliability(KEY, { mode: 'between', min: 0.8, max: 0.5 })[0]).toMatchObject(
      { operator: 'between', min: 0.5, max: 0.8 },
    );
  });

  it('reuses the id of the condition it replaces', () => {
    // The query builder keys a row's live match count and its in-progress bound text
    // by condition id; a fresh id per commit resets both mid-drag.
    expect(
      conditionsForReliability(KEY, { mode: 'atLeast', min: 0.5, max: 1 }, 'keep-me')[0]?.id,
    ).toBe('keep-me');
  });
});

describe('reliabilityFromConditions', () => {
  it('round-trips every mode', () => {
    for (const state of MODES) {
      expect(reliabilityFromConditions(conditionsForReliability(KEY, state))).toEqual(state);
    }
  });

  it('reads no conditions as the default', () => {
    expect(reliabilityFromConditions([])).toEqual(DEFAULT_EAT_RELIABILITY);
  });

  it('reads a hand-built exclusive operator too', () => {
    const gt = createNumericCondition({ annotation: KEY, operator: 'gt', min: 0.5 });
    expect(reliabilityFromConditions([gt])).toEqual({ mode: 'atLeast', min: 0.5, max: 1 });
  });

  it('does not read a negated condition as its positive form', () => {
    // NOT(conf >= X) keeps confidences BELOW X, the opposite of the bare form.
    const negated = createNumericCondition({
      annotation: KEY,
      operator: 'gte',
      min: 0.5,
      logicalOp: 'NOT',
    });
    expect(reliabilityFromConditions([negated])).toEqual({ mode: 'atMost', min: 0, max: 0.5 });
  });

  it('does not read a negated band as the band itself', () => {
    // NOT(between a,b) keeps everything OUTSIDE the band — no mode expresses that, so
    // reading it positively would show a band that keeps exactly what it hides, and the
    // next nudge of the control would commit that inversion back into the query.
    const negatedBand = createNumericCondition({
      annotation: KEY,
      operator: 'between',
      min: 0.3,
      max: 0.7,
      logicalOp: 'NOT',
    });
    expect(reliabilityFromConditions([negatedBand])).not.toEqual({
      mode: 'between',
      min: 0.3,
      max: 0.7,
    });
    expect(reliabilityFromConditions([negatedBand])).toEqual(DEFAULT_EAT_RELIABILITY);
  });
});
