import { describe, it, expect } from 'vitest';
import { NA_VALUE } from '@protspace/utils';
import type { ProtspaceData } from './types';
import type { NumericCondition } from './query-types';
import { ANY_VALUE } from './query-types';
import { evaluateQuery } from './query-evaluate';
import {
  countNumericMatches,
  isNumericConditionReady,
  matchesNumericValue,
  toRange,
} from './query-numeric-helpers';

function numericCondition(overrides: Partial<NumericCondition>): NumericCondition {
  return {
    id: 'n1',
    kind: 'numeric',
    annotation: 'length',
    min: null,
    max: null,
    ...overrides,
  };
}

describe('toRange', () => {
  it('keeps only the bound an older one-sided operator read, and drops the operator', () => {
    expect(toRange(numericCondition({ operator: 'gt', min: 1, max: 9 }))).toMatchObject({
      min: 1,
      max: null,
    });
    expect(toRange(numericCondition({ operator: 'lte', min: 1, max: 9 }))).toMatchObject({
      min: null,
      max: 9,
    });
    expect(toRange(numericCondition({ operator: 'between', min: 1, max: 9 }))).not.toHaveProperty(
      'operator',
    );
  });
});

describe('isNumericConditionReady', () => {
  it('gt is ready when min is set', () => {
    expect(isNumericConditionReady(numericCondition({ operator: 'gt', min: 5 }))).toBe(true);
  });
  it('gt is not ready when min is null', () => {
    expect(isNumericConditionReady(numericCondition({ operator: 'gt', min: null }))).toBe(false);
  });
  it('lt is ready when max is set', () => {
    expect(isNumericConditionReady(numericCondition({ operator: 'lt', max: 9 }))).toBe(true);
  });
  it('a range needs one end; the other may stay open', () => {
    expect(isNumericConditionReady(numericCondition({ min: 1, max: null }))).toBe(true);
    expect(isNumericConditionReady(numericCondition({ min: null, max: 9 }))).toBe(true);
    expect(isNumericConditionReady(numericCondition({ min: null, max: null }))).toBe(false);
  });
  it('only ANY_VALUE makes a bound-less condition ready; N/A alone is the full range', () => {
    expect(
      isNumericConditionReady(
        numericCondition({ operator: 'gt', min: null, presence: [ANY_VALUE] }),
      ),
    ).toBe(true);
    expect(
      isNumericConditionReady(
        numericCondition({ operator: 'gt', min: null, presence: [NA_VALUE] }),
      ),
    ).toBe(false);
    expect(
      isNumericConditionReady(numericCondition({ operator: 'gt', min: null, presence: [] })),
    ).toBe(false);
  });
});

describe('matchesNumericValue', () => {
  it('an open max reads "at least min", inclusive', () => {
    const c = numericCondition({ min: 50, max: null });
    expect(matchesNumericValue(51, c)).toBe(true);
    expect(matchesNumericValue(50, c)).toBe(true);
    expect(matchesNumericValue(49, c)).toBe(false);
  });
  it('an open min reads "at most max", inclusive', () => {
    const c = numericCondition({ min: null, max: 50 });
    expect(matchesNumericValue(49, c)).toBe(true);
    expect(matchesNumericValue(50, c)).toBe(true);
    expect(matchesNumericValue(51, c)).toBe(false);
  });
  it('between is inclusive on both ends', () => {
    const c = numericCondition({ operator: 'between', min: 10, max: 20 });
    expect(matchesNumericValue(10, c)).toBe(true);
    expect(matchesNumericValue(20, c)).toBe(true);
    expect(matchesNumericValue(15, c)).toBe(true);
    expect(matchesNumericValue(9, c)).toBe(false);
    expect(matchesNumericValue(21, c)).toBe(false);
  });
  it('between with min > max matches nothing', () => {
    const c = numericCondition({ operator: 'between', min: 20, max: 10 });
    expect(matchesNumericValue(15, c)).toBe(false);
  });
  it('gte and lte include the bound their exclusive twin excludes', () => {
    const gte = numericCondition({ operator: 'gte', min: 50 });
    expect(matchesNumericValue(50, gte)).toBe(true);
    expect(matchesNumericValue(49, gte)).toBe(false);

    const lte = numericCondition({ operator: 'lte', max: 50 });
    expect(matchesNumericValue(50, lte)).toBe(true);
    expect(matchesNumericValue(51, lte)).toBe(false);
  });
  it('the N/A chip is the only way a null matches, and it does not widen the comparison', () => {
    const c = numericCondition({ operator: 'gte', min: 50, presence: [NA_VALUE] });
    expect(matchesNumericValue(null, c)).toBe(true);
    expect(matchesNumericValue(50, c)).toBe(true);
    // The chip readmits missing values; it does not relax the bound.
    expect(matchesNumericValue(49, c)).toBe(false);
  });
  it('the ANY chip matches every real value but still excludes null', () => {
    const c = numericCondition({ operator: 'gte', min: 50, presence: [ANY_VALUE] });
    expect(matchesNumericValue(49, c)).toBe(true);
    expect(matchesNumericValue(null, c)).toBe(false);
  });
  it('null value never matches', () => {
    expect(matchesNumericValue(null, numericCondition({ operator: 'gt', min: 0 }))).toBe(false);
  });
  it('unready condition matches nothing', () => {
    expect(matchesNumericValue(100, numericCondition({ operator: 'gt', min: null }))).toBe(false);
  });
});

describe('countNumericMatches', () => {
  const data: ProtspaceData = {
    protein_ids: ['P1', 'P2', 'P3', 'P4'],
    numeric_annotation_data: { length: new Float64Array([10, 20, 30, NaN]) },
  };
  it('counts proteins matching a ready condition', () => {
    const c = numericCondition({ operator: 'gt', min: 15 });
    expect(countNumericMatches(c, data)).toBe(2);
  });
  it('returns 0 for an unready condition', () => {
    expect(countNumericMatches(numericCondition({ operator: 'gt', min: null }), data)).toBe(0);
  });
  it('returns 0 when the annotation is missing', () => {
    const c = numericCondition({ operator: 'gt', min: 0, annotation: 'missing' });
    expect(countNumericMatches(c, data)).toBe(0);
  });

  // The count is a live preview of what the filter will do, so it has to walk the
  // same rows the evaluator walks: `numProteins`, not the value array's length.
  // A column shorter than the dataset used to leave the tail uncounted, so an N/A
  // presence chip — which DOES match those rows — undershot the real result.
  it('counts rows past the end of a short column as missing', () => {
    const sparse: ProtspaceData = {
      protein_ids: ['P1', 'P2', 'P3', 'P4'],
      numeric_annotation_data: { length: new Float64Array([10, 20]) },
    };
    const c = numericCondition({ operator: 'gte', min: 15, presence: [NA_VALUE] });
    // P2 (20 >= 15) plus P3 and P4, which have no value at all.
    expect(countNumericMatches(c, sparse)).toBe(3);
  });

  it('counts nothing without protein_ids, matching the evaluator', () => {
    const noIds: ProtspaceData = {
      numeric_annotation_data: { length: new Float64Array([10, 20]) },
    };
    const c = numericCondition({ operator: 'gte', min: 15 });
    expect(countNumericMatches(c, noIds)).toBe(0);
    expect(evaluateQuery([c], noIds).size).toBe(0);
  });

  it('agrees with the evaluator on a column with an explicit null', () => {
    const c = numericCondition({ operator: 'gte', min: 15, presence: [NA_VALUE] });
    // P2, P3 clear the bound; P4 is null and rides in on the N/A chip.
    expect(countNumericMatches(c, data)).toBe(3);
    expect(evaluateQuery([c], data).size).toBe(3);
  });
});
