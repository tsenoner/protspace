import { describe, it, expect } from 'vitest';
import {
  getProteinAnnotationIndices,
  getProteinAnnotationCount,
  getFirstAnnotationIndex,
  sliceAnnotationData,
} from './annotation-data-access';

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
});
