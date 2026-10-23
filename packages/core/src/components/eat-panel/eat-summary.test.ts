import { describe, expect, it } from 'vitest';
import { DEFAULT_EAT_RELIABILITY } from '@protspace/utils';
import type { EatReliabilityState } from '@protspace/utils';
import { conditionsForReliability } from '../query-builder/eat-reliability';
import { evaluateQuery } from '../query-builder/query-evaluate';
import {
  binOf,
  countIn,
  EAT_BIN_COUNT,
  getEatIndex,
  isKept,
  predictionIds,
  labelsAt,
  rankOf,
  summarizeEat,
  weakestIn,
} from './eat-summary';
import type { EatDrill, EatIndex, EatSummary } from './eat-summary';
import {
  createEatFixture,
  EAT_FIXTURE_CONFIDENCE_KEY,
  EAT_FIXTURE_IDS,
} from './test-support/eat-fixture';

const IDS = EAT_FIXTURE_IDS;
const CONFIDENCE_KEY = EAT_FIXTURE_CONFIDENCE_KEY;

const data = createEatFixture();
const index = getEatIndex(data, 'toxin') as EatIndex;
const idx = (id: string) => IDS.indexOf(id);
const ids = (indices: ArrayLike<number>) => Array.from(indices, (i) => IDS[i]);
const at = (min: number, max: number): EatReliabilityState => ({ min, max });
const mask = (excluded: string[]) => Uint8Array.from(IDS, (id) => (excluded.includes(id) ? 0 : 1));
const counts = (summary: EatSummary) => {
  const { inView, curated, predicted, kept, outside, none } = summary;
  return { inView, curated, predicted, kept, outside, none };
};
const row = (summary: EatSummary, label: string) => summary.rows.find((r) => r.label === label);

describe('eat summary', () => {
  it('orders predictions by reliability, then id', () => {
    expect(ids(index.order)).toEqual(['P3', 'P5', 'P7', 'P8', 'P9']);
    expect(Array.from(index.confidence)).toEqual([0.12, 0.55, 0.55, 0.81, 1]);
    expect(index.labels).toEqual(['A', 'B', 'C']);
  });

  it('counts curated, predicted and none once per protein', () => {
    expect(counts(summarizeEat(index, DEFAULT_EAT_RELIABILITY, null))).toEqual({
      inView: 10,
      curated: 4,
      predicted: 5,
      kept: 5,
      outside: 0,
      none: 1,
    });
  });

  it('splits kept and outside by the range, inclusive at the bound', () => {
    const atLeast = summarizeEat(index, at(0.55, 1), null);
    expect([atLeast.kept, atLeast.outside]).toEqual([4, 1]);
    const atMost = summarizeEat(index, at(0, 0.55), null);
    expect([atMost.kept, atMost.outside]).toEqual([3, 2]);
  });

  it('keeps a band inclusive at both ends', () => {
    const summary = summarizeEat(index, at(0.55, 0.81), null);
    expect([summary.kept, summary.outside]).toEqual([3, 2]);
    expect(isKept(at(0.55, 0.81), 0.81)).toBe(true);
    expect(isKept(at(0.55, 0.81), 0.82)).toBe(false);
  });

  it('bins a confidence of 1 into the last bin', () => {
    expect(binOf(1)).toBe(EAT_BIN_COUNT - 1);
    expect(binOf(0)).toBe(0);
    expect(binOf(0.6)).toBe(12);
    const { bins } = summarizeEat(index, DEFAULT_EAT_RELIABILITY, null);
    expect(bins).toHaveLength(EAT_BIN_COUNT);
    expect([bins[2], bins[11], bins[16], bins[19]]).toEqual([1, 2, 1, 1]);
    expect(bins.reduce((sum, n) => sum + n, 0)).toBe(5);
  });

  it('counts a multi-valued prediction under each label', () => {
    const summary = summarizeEat(index, at(0.55, 1), null);
    expect(row(summary, 'A')).toEqual({
      label: 'A',
      curated: 2,
      kept: 2,
      outside: 1,
      total: 5,
      predictedShare: 3 / 5,
      medianReliability: 0.55,
    });
    expect(row(summary, 'B')).toMatchObject({ curated: 1, kept: 2, outside: 0, total: 3 });
    expect(row(summary, 'C')).toMatchObject({ curated: 1, kept: 1, medianReliability: 0.81 });
    // Over every prediction: 0.12, 0.55, 0.55, 0.81 and the top one.
    expect(summary.medianReliability).toBe(0.55);
  });

  it('restricts every count to the context', () => {
    const context = mask(['P9', 'P0']);
    const summary = summarizeEat(index, DEFAULT_EAT_RELIABILITY, context);
    expect(counts(summary)).toEqual({
      inView: 8,
      curated: 3,
      predicted: 4,
      kept: 4,
      outside: 0,
      none: 1,
    });
    expect(summary.bins[19]).toBe(0);
    expect(row(summary, 'A')).toMatchObject({
      curated: 1,
      kept: 2,
      medianReliability: (0.12 + 0.55) / 2,
    });
    // A second call with the same mask reads the cached curated totals.
    expect(counts(summarizeEat(index, DEFAULT_EAT_RELIABILITY, context))).toEqual(counts(summary));
  });

  it('leaves out a label with nothing in context', () => {
    const summary = summarizeEat(index, DEFAULT_EAT_RELIABILITY, mask(['P4', 'P8']));
    expect(row(summary, 'C')).toBeUndefined();
  });

  it('ranks a prediction by the shares strictly below and above it', () => {
    expect(rankOf(index, idx('P8'))).toEqual({ below: 3, above: 1, total: 5 });
    // P7 ties another 0.55: neither is below or above the other.
    expect(rankOf(index, idx('P7'))).toEqual({ below: 1, above: 2, total: 5 });
    expect(rankOf(index, idx('P0'))).toBeNull();
  });

  it('names the labels of a prediction by its place in the order', () => {
    expect(labelsAt(index, index.order.indexOf(idx('P5')))).toEqual(['A', 'B']);
  });

  it('lists the weakest five of a bin and of a label, weakest first', () => {
    const weakest = (drill: EatDrill, context: Uint8Array | null, limit?: number) =>
      ids(Array.from(weakestIn(index, drill, context, limit), (k) => index.order[k]));
    const BIN_55: EatDrill = { bin: 11 };
    const LABEL_A: EatDrill = { label: 0 };
    expect(weakest(BIN_55, null)).toEqual(['P5', 'P7']);
    expect(weakest(LABEL_A, null)).toEqual(['P3', 'P5', 'P9']);
    expect(weakest(LABEL_A, null, 2)).toEqual(['P3', 'P5']);
    expect(weakest(LABEL_A, mask(['P3']))).toEqual(['P5', 'P9']);
    expect(countIn(index, LABEL_A, null, at(0.55, 1))).toEqual({
      total: 3,
      kept: 2,
    });
    expect(countIn(index, BIN_55, null, at(0.6, 1))).toEqual({ total: 2, kept: 0 });
  });

  it('counts lent predictions per source, missing sources included', () => {
    expect(index.lentCount.get('S1')).toBe(3);
    expect(index.lentCount.get('P0')).toBe(1);
    expect(index.lentCount.get('S9')).toBe(1);
  });

  it('returns kept and outside ids in reliability order', () => {
    const state = at(0.55, 1);
    expect(predictionIds(index, data, state, 'kept', null)).toEqual(['P5', 'P7', 'P8', 'P9']);
    expect(predictionIds(index, data, state, 'outside', null)).toEqual(['P3']);
    expect(predictionIds(index, data, state, 'kept', null, { label: 1 })).toEqual(['P5', 'P7']);
    expect(predictionIds(index, data, state, 'kept', mask(['P8']))).toEqual(['P5', 'P7', 'P9']);
  });

  it('agrees with the query filter on every range', () => {
    const states: EatReliabilityState[] = [
      DEFAULT_EAT_RELIABILITY,
      at(0.55, 1),
      at(0.13, 1),
      at(1, 1),
      at(0, 0.55),
      at(0, 0.12),
      at(0.55, 0.81),
      at(0.12, 1),
      at(0.81, 0.55),
    ];
    for (const state of states) {
      const byIsKept = Array.from(index.order).filter((_, k) => isKept(state, index.confidence[k]));
      const matched = evaluateQuery(conditionsForReliability(CONFIDENCE_KEY, state), data);
      const byQuery = Array.from(index.order).filter((p) => matched.has(p));
      expect(ids(byIsKept), JSON.stringify(state)).toEqual(ids(byQuery));
    }
  });

  it('caches the index per dataset and annotation', () => {
    expect(getEatIndex(data, 'toxin')).toBe(index);
    expect(getEatIndex(createEatFixture(), 'toxin')).not.toBe(index);
  });

  it('returns null for an annotation without predictions', () => {
    expect(getEatIndex(data, 'family')).toBeNull();
    expect(getEatIndex(data, 'missing')).toBeNull();
  });
});
