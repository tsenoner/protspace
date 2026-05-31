import { describe, it, expect } from 'vitest';
import { sortIndicesByDepthDescending } from './depth-sort';

describe('sortIndicesByDepthDescending', () => {
  it('basic: descending depth, ties break by ascending original index', () => {
    const order = new Uint32Array(4);
    const depths = new Float32Array([0.5, 0.1, 0.9, 0.1]);
    sortIndicesByDepthDescending(order, depths, 4);
    // Expected: 0.9 (idx2) > 0.5 (idx0) > 0.1 (idx1, idx3 — ascending tiebreak)
    expect(Array.from(order)).toEqual([2, 0, 1, 3]);
  });

  it('all-equal depths: stable identity order', () => {
    const n = 5;
    const order = new Uint32Array(n);
    const depths = new Float32Array([0.5, 0.5, 0.5, 0.5, 0.5]);
    sortIndicesByDepthDescending(order, depths, n);
    expect(Array.from(order)).toEqual([0, 1, 2, 3, 4]);
  });

  it('count smaller than array length: only order[0..count) is sorted', () => {
    const order = new Uint32Array(6);
    const depths = new Float32Array([0.3, 0.8, 0.1, 0.6, 0.9, 0.2]);
    // Sort only first 3 elements: depths[0..3) = [0.3, 0.8, 0.1]
    sortIndicesByDepthDescending(order, depths, 3);
    // Sorted subarray: 0.8 (idx1) > 0.3 (idx0) > 0.1 (idx2)
    expect(Array.from(order.subarray(0, 3))).toEqual([1, 0, 2]);
    // Elements beyond count are not asserted (implementation-defined)
  });

  it('larger fixed array: non-increasing depth, equal-depth runs in ascending index', () => {
    const depths = new Float32Array([0.7, 0.3, 0.7, 0.1, 0.5, 0.7, 0.3, 0.9]);
    const n = depths.length;
    const order = new Uint32Array(n);
    sortIndicesByDepthDescending(order, depths, n);

    // Verify non-increasing depth
    for (let i = 0; i < n - 1; i++) {
      expect(depths[order[i]]).toBeGreaterThanOrEqual(depths[order[i + 1]]);
    }

    // Within runs of equal depth, indices must be ascending
    let runStart = 0;
    while (runStart < n) {
      let runEnd = runStart + 1;
      while (runEnd < n && depths[order[runEnd]] === depths[order[runStart]]) {
        runEnd++;
      }
      // Indices in [runStart, runEnd) must be ascending
      for (let j = runStart; j < runEnd - 1; j++) {
        expect(order[j]).toBeLessThan(order[j + 1]);
      }
      runStart = runEnd;
    }
  });

  it('single element: no throw', () => {
    const order = new Uint32Array(1);
    const depths = new Float32Array([0.5]);
    expect(() => sortIndicesByDepthDescending(order, depths, 1)).not.toThrow();
    expect(order[0]).toBe(0);
  });

  it('count 0: no throw', () => {
    const order = new Uint32Array(4);
    const depths = new Float32Array([0.5, 0.3, 0.1, 0.8]);
    expect(() => sortIndicesByDepthDescending(order, depths, 0)).not.toThrow();
  });
});
