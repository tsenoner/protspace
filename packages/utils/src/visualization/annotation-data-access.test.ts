import { describe, it, expect } from 'vitest';
import {
  getCsrHitRange,
  getProteinAnnotationIndices,
  getProteinAnnotationCount,
  getFirstAnnotationIndex,
  isCsrAnnotationData,
  isMultilabelAnnotationData,
  isMultilabelAnnotationDataCached,
  sliceAnnotationData,
} from './annotation-data-access';
import type { CsrAnnotationData } from '../types';

describe('annotation-data-access', () => {
  describe('Int32Array storage', () => {
    const data = Int32Array.from([0, 2, -1, 1]);

    it('returns single-element array for present indices', () => {
      expect(getProteinAnnotationIndices(data, 0)).toEqual([0]);
      expect(getProteinAnnotationIndices(data, 1)).toEqual([2]);
      expect(getProteinAnnotationIndices(data, 3)).toEqual([1]);
    });

    it('returns empty array for sentinel -1', () => {
      expect(getProteinAnnotationIndices(data, 2)).toEqual([]);
    });

    it('counts correctly', () => {
      expect(getProteinAnnotationCount(data, 0)).toBe(1);
      expect(getProteinAnnotationCount(data, 2)).toBe(0);
    });

    it('returns first index without allocation', () => {
      expect(getFirstAnnotationIndex(data, 0)).toBe(0);
      expect(getFirstAnnotationIndex(data, 1)).toBe(2);
      expect(getFirstAnnotationIndex(data, 2)).toBe(-1);
    });
  });

  describe('number[][] storage', () => {
    const data: readonly (readonly number[])[] = [[0, 5], [], [3]];

    it('returns the inner array verbatim', () => {
      expect(getProteinAnnotationIndices(data, 0)).toEqual([0, 5]);
      expect(getProteinAnnotationIndices(data, 1)).toEqual([]);
      expect(getProteinAnnotationIndices(data, 2)).toEqual([3]);
    });

    it('counts correctly', () => {
      expect(getProteinAnnotationCount(data, 0)).toBe(2);
      expect(getProteinAnnotationCount(data, 1)).toBe(0);
      expect(getProteinAnnotationCount(data, 2)).toBe(1);
    });

    it('returns first index or -1 for empty', () => {
      expect(getFirstAnnotationIndex(data, 0)).toBe(0);
      expect(getFirstAnnotationIndex(data, 1)).toBe(-1);
      expect(getFirstAnnotationIndex(data, 2)).toBe(3);
    });
  });

  describe('sparse multi-value storage', () => {
    const data = {
      kind: 'sparse-multi' as const,
      base: Int32Array.from([0, 1, -1, 2]),
      overrides: new Map([[1, [1, 3]]]),
      length: 4,
    };

    it('uses overrides only for exceptional rows', () => {
      expect(getProteinAnnotationIndices(data, 0)).toEqual([0]);
      expect(getProteinAnnotationIndices(data, 1)).toEqual([1, 3]);
      expect(getProteinAnnotationCount(data, 1)).toBe(2);
      expect(getFirstAnnotationIndex(data, 1)).toBe(1);
      expect(getProteinAnnotationIndices(data, 2)).toEqual([]);
    });

    it('detects multilabel rows by scanning only sparse overrides', () => {
      expect(isMultilabelAnnotationData(data)).toBe(true);
      expect(
        isMultilabelAnnotationData({
          ...data,
          overrides: new Map([[1, [1]]]),
        }),
      ).toBe(false);
    });

    it('remaps surviving overrides while slicing', () => {
      const sliced = sliceAnnotationData(data, [3, 1]);
      expect(getProteinAnnotationIndices(sliced, 0)).toEqual([2]);
      expect(getProteinAnnotationIndices(sliced, 1)).toEqual([1, 3]);
    });
  });

  describe('out-of-range proteinIdx', () => {
    it('returns empty for Int32Array', () => {
      const data = Int32Array.from([0]);
      expect(getProteinAnnotationIndices(data, 5)).toEqual([]);
      expect(getFirstAnnotationIndex(data, 5)).toBe(-1);
    });

    it('returns empty for number[][]', () => {
      const data: readonly (readonly number[])[] = [[0]];
      expect(getProteinAnnotationIndices(data, 5)).toEqual([]);
      expect(getFirstAnnotationIndex(data, 5)).toBe(-1);
    });
  });

  describe('sliceAnnotationData', () => {
    it('slices Int32Array preserving type', () => {
      const data = Int32Array.from([0, 2, -1, 1]);
      const sliced = sliceAnnotationData(data, [0, 3]);
      expect(sliced).toBeInstanceOf(Int32Array);
      expect(Array.from(sliced as Int32Array)).toEqual([0, 1]);
    });

    it('slices number[][] preserving type', () => {
      const data: readonly (readonly number[])[] = [[0, 5], [], [3]];
      const sliced = sliceAnnotationData(data, [2, 0]);
      expect(Array.isArray(sliced)).toBe(true);
      expect(sliced[0]).toEqual([3]);
      expect(sliced[1]).toEqual([0, 5]);
    });

    it('handles out-of-range indices safely', () => {
      const data = Int32Array.from([1, 2]);
      const sliced = sliceAnnotationData(data, [0, 99]);
      expect(Array.from(sliced as Int32Array)).toEqual([1, -1]);
    });
  });

  describe('isMultilabelAnnotationData', () => {
    it('distinguishes typed single-value and dense multilabel storage', () => {
      expect(isMultilabelAnnotationData(Int32Array.from([0, 1]))).toBe(false);
      expect(isMultilabelAnnotationData([[0], [1, 2]])).toBe(true);
    });
  });
});

describe('CSR storage', () => {
  // rows: 0 -> [5, 6], 1 -> [], 2 -> [2], 3 -> [], 4 -> [0, 1, 9]
  // First and last rows carry hits, and `end[-1]` is conceptually 0, so row 0's
  // range is [0, end[0]).
  const csr = (): CsrAnnotationData => ({
    kind: 'csr',
    end: Int32Array.from([2, 2, 3, 3, 6]),
    codes: Int32Array.from([5, 6, 2, 0, 1, 9]),
    length: 5,
  });

  it('is recognised without being mistaken for the other tagged shape', () => {
    expect(isCsrAnnotationData(csr())).toBe(true);
    expect(isCsrAnnotationData(Int32Array.from([0, 1]))).toBe(false);
    expect(isCsrAnnotationData([[0], [1]])).toBe(false);
    expect(
      isCsrAnnotationData({
        kind: 'sparse-multi',
        base: Int32Array.from([0]),
        overrides: new Map(),
        length: 1,
      }),
    ).toBe(false);
  });

  it('derives half-open hit ranges, empty outside the row count', () => {
    const data = csr();
    expect(getCsrHitRange(data, 0)).toEqual([0, 2]);
    expect(getCsrHitRange(data, 1)).toEqual([2, 2]);
    expect(getCsrHitRange(data, 4)).toEqual([3, 6]);
    expect(getCsrHitRange(data, 5)).toEqual([0, 0]);
    expect(getCsrHitRange(data, -1)).toEqual([0, 0]);
  });

  it('returns indices for empty, single-hit, first and last rows', () => {
    const data = csr();
    expect(getProteinAnnotationIndices(data, 0)).toEqual([5, 6]);
    expect(getProteinAnnotationIndices(data, 1)).toEqual([]);
    expect(getProteinAnnotationIndices(data, 2)).toEqual([2]);
    expect(getProteinAnnotationIndices(data, 3)).toEqual([]);
    expect(getProteinAnnotationIndices(data, 4)).toEqual([0, 1, 9]);
  });

  it('treats an empty first row as the [0, 0) range', () => {
    const data: CsrAnnotationData = {
      kind: 'csr',
      end: Int32Array.from([0, 1]),
      codes: Int32Array.from([3]),
      length: 2,
    };
    expect(getProteinAnnotationIndices(data, 0)).toEqual([]);
    expect(getProteinAnnotationCount(data, 0)).toBe(0);
    expect(getFirstAnnotationIndex(data, 0)).toBe(-1);
    expect(getProteinAnnotationIndices(data, 1)).toEqual([3]);
  });

  it('returns a real Array, not a typed-array view', () => {
    // Callers run `.map`/`.flatMap`/`.some` on the result; a subarray would only
    // fail on `.flatMap`, so the shape itself is asserted.
    const indices = getProteinAnnotationIndices(csr(), 0);
    expect(Array.isArray(indices)).toBe(true);
    expect(indices.flatMap((i) => [i, i])).toEqual([5, 5, 6, 6]);
  });

  it('counts hits per row', () => {
    const data = csr();
    expect(getProteinAnnotationCount(data, 0)).toBe(2);
    expect(getProteinAnnotationCount(data, 1)).toBe(0);
    expect(getProteinAnnotationCount(data, 2)).toBe(1);
    expect(getProteinAnnotationCount(data, 4)).toBe(3);
  });

  it('returns the first hit or -1', () => {
    const data = csr();
    expect(getFirstAnnotationIndex(data, 0)).toBe(5);
    expect(getFirstAnnotationIndex(data, 1)).toBe(-1);
    expect(getFirstAnnotationIndex(data, 2)).toBe(2);
    expect(getFirstAnnotationIndex(data, 4)).toBe(0);
  });

  it('matches the other shapes on out-of-range and negative indices', () => {
    const data = csr();
    for (const idx of [5, 99, -1]) {
      expect(getProteinAnnotationIndices(data, idx)).toEqual([]);
      expect(getProteinAnnotationCount(data, idx)).toBe(0);
      expect(getFirstAnnotationIndex(data, idx)).toBe(-1);
    }
  });

  it('detects multilabel rows from the end deltas', () => {
    expect(isMultilabelAnnotationData(csr())).toBe(true);
    expect(isMultilabelAnnotationDataCached(csr())).toBe(true);
    const singles: CsrAnnotationData = {
      kind: 'csr',
      end: Int32Array.from([1, 1, 2]),
      codes: Int32Array.from([4, 7]),
      length: 3,
    };
    expect(isMultilabelAnnotationData(singles)).toBe(false);
    expect(isMultilabelAnnotationDataCached(singles)).toBe(false);
  });

  it('slices to CSR, preserving hit order and dropping out-of-range rows', () => {
    const sliced = sliceAnnotationData(csr(), [4, 1, 0, 99]);
    expect(isCsrAnnotationData(sliced)).toBe(true);
    const out = sliced as CsrAnnotationData;
    expect(out.length).toBe(4);
    expect(Array.from(out.end)).toEqual([3, 3, 5, 5]);
    expect(Array.from(out.codes)).toEqual([0, 1, 9, 5, 6]);
    expect(getProteinAnnotationIndices(out, 0)).toEqual([0, 1, 9]);
    expect(getProteinAnnotationIndices(out, 1)).toEqual([]);
    expect(getProteinAnnotationIndices(out, 2)).toEqual([5, 6]);
    expect(getProteinAnnotationIndices(out, 3)).toEqual([]);
  });

  it('slices into fresh buffers that do not alias the source', () => {
    const data = csr();
    const out = sliceAnnotationData(data, [0, 1, 2, 3, 4]) as CsrAnnotationData;
    expect(Array.from(out.codes)).toEqual(Array.from(data.codes));
    expect(Array.from(out.end)).toEqual(Array.from(data.end));
    expect(out.codes.buffer).not.toBe(data.codes.buffer);
    expect(out.end.buffer).not.toBe(data.end.buffer);
    out.codes[0] = 42;
    out.end[0] = 0;
    expect(data.codes[0]).toBe(5);
    expect(data.end[0]).toBe(2);
  });

  it('slices an all-empty selection to zero-length codes', () => {
    const out = sliceAnnotationData(csr(), [1, 3]) as CsrAnnotationData;
    expect(out.codes.length).toBe(0);
    expect(Array.from(out.end)).toEqual([0, 0]);
  });
});

describe('isMultilabelAnnotationDataCached', () => {
  it('agrees with the uncached form on every storage shape', () => {
    const dense: number[][] = [[0], [1, 2], [0]];
    const single: number[][] = [[0], [1], [0]];
    const compact = Int32Array.from([0, 1, 2]);

    for (const data of [dense, single, compact]) {
      expect(isMultilabelAnnotationDataCached(data)).toBe(isMultilabelAnnotationData(data));
    }
  });

  it('memoizes per storage object, not per content', () => {
    // The memo exists because the dense form is O(N) and callers want the answer
    // on every style-getter rebuild — a legend hide, a selection, a projection
    // switch.
    //
    // Mutating storage in place is precisely what production never does, and what
    // the memo's soundness rests on. It is used here purely as an observation
    // device: a re-read would flip the answer, so the STALE result is the memo,
    // caught in the act. Asserting two `true`s instead would pass just as well
    // with the memo deleted.
    const a: number[][] = [[0], [1, 2]];
    expect(isMultilabelAnnotationDataCached(a)).toBe(true);

    a[1] = [1];
    expect(isMultilabelAnnotationData(a)).toBe(false);
    expect(isMultilabelAnnotationDataCached(a)).toBe(true);

    // Equal-content but distinct storage is computed independently, so a fresh
    // dataset cannot inherit another's answer.
    const b: number[][] = [[0], [1]];
    expect(isMultilabelAnnotationDataCached(b)).toBe(false);
  });
});
