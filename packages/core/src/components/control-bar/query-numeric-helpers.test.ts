import { describe, it, expect } from 'vitest';
import type { ProtspaceData } from './types';
import type { NumericCondition } from './query-types';
import {
  countNumericMatches,
  isNumericConditionReady,
  matchesNumericValue,
  numericFieldsFor,
} from './query-numeric-helpers';

function numericCondition(overrides: Partial<NumericCondition>): NumericCondition {
  return {
    id: 'n1',
    kind: 'numeric',
    annotation: 'length',
    operator: 'gt',
    min: null,
    max: null,
    ...overrides,
  };
}

describe('numericFieldsFor', () => {
  it('gt needs only min', () => {
    expect(numericFieldsFor('gt')).toEqual({ min: true, max: false });
  });
  it('lt needs only max', () => {
    expect(numericFieldsFor('lt')).toEqual({ min: false, max: true });
  });
  it('between needs both', () => {
    expect(numericFieldsFor('between')).toEqual({ min: true, max: true });
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
  it('between needs both bounds', () => {
    expect(
      isNumericConditionReady(numericCondition({ operator: 'between', min: 1, max: null })),
    ).toBe(false);
    expect(
      isNumericConditionReady(numericCondition({ operator: 'between', min: null, max: 9 })),
    ).toBe(false);
    expect(isNumericConditionReady(numericCondition({ operator: 'between', min: 1, max: 9 }))).toBe(
      true,
    );
  });
});

describe('matchesNumericValue', () => {
  it('gt is exclusive', () => {
    const c = numericCondition({ operator: 'gt', min: 50 });
    expect(matchesNumericValue(51, c)).toBe(true);
    expect(matchesNumericValue(50, c)).toBe(false);
    expect(matchesNumericValue(49, c)).toBe(false);
  });
  it('lt is exclusive', () => {
    const c = numericCondition({ operator: 'lt', max: 50 });
    expect(matchesNumericValue(49, c)).toBe(true);
    expect(matchesNumericValue(50, c)).toBe(false);
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
    numeric_annotation_data: { length: [10, 20, 30, null] },
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
});
