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

// ── parity with the comparator reference ───────────────────────

/** The pre-counting-sort implementation, kept as the reference ordering. */
function referenceOrder(depths: Float32Array, count: number): number[] {
  const idx = Array.from({ length: count }, (_, i) => i);
  idx.sort((a, b) => depths[b] - depths[a] || a - b);
  return idx;
}

/** Deterministic PRNG so a failure is reproducible. */
function makeRng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

describe('sortIndicesByDepthDescending parity with the comparator', () => {
  it('matches the comparator for few distinct depths (counting-sort path)', () => {
    const rng = makeRng(12345);
    for (const distinctCount of [1, 2, 7, 50]) {
      const palette = Array.from({ length: distinctCount }, () => Math.fround(rng()));
      const n = 5000;
      const depths = new Float32Array(n);
      for (let i = 0; i < n; i++) depths[i] = palette[Math.floor(rng() * distinctCount)];
      const order = new Uint32Array(n);
      sortIndicesByDepthDescending(order, depths, n);
      expect(Array.from(order)).toEqual(referenceOrder(depths, n));
    }
  });

  it('matches the comparator for realistic composePaintDepth-shaped depths', () => {
    // 4 tiers x 3 opacities x 12 legend slots, the shape the renderer actually emits.
    const palette: number[] = [];
    for (const tier of [0, 0.25, 0.5, 0.75]) {
      for (let slot = 0; slot < 12; slot++) {
        for (const op of [0.2, 0.6, 1]) {
          palette.push(Math.fround(tier + (slot / 12) * op * 0.24));
        }
      }
    }
    const rng = makeRng(999);
    const n = 20000;
    const depths = new Float32Array(n);
    for (let i = 0; i < n; i++) depths[i] = palette[Math.floor(rng() * palette.length)];
    const order = new Uint32Array(n);
    sortIndicesByDepthDescending(order, depths, n);
    expect(Array.from(order)).toEqual(referenceOrder(depths, n));
  });

  it('falls back to the comparator on a NaN depth', () => {
    // NaN makes `depths[b] - depths[a]` NaN, so the comparator falls through to the index
    // tiebreak and index order wins. The counting sort would instead give NaN a bucket of
    // its own — `Array.from(rank.keys()).sort()` leaves it after 1 — and return [0, 2, 1].
    const depths = new Float32Array([1, Number.NaN, 1]);
    const order = new Uint32Array(3);
    sortIndicesByDepthDescending(order, depths, 3);
    expect(Array.from(order)).toEqual([0, 1, 2]);
    expect(Array.from(order)).toEqual(referenceOrder(depths, 3));
  });

  it('sorts infinities through the counting-sort path', () => {
    const depths = new Float32Array([Infinity, 0, Infinity, -Infinity, 0]);
    const order = new Uint32Array(5);
    sortIndicesByDepthDescending(order, depths, 5);
    expect(Array.from(order)).toEqual([0, 2, 1, 4, 3]);
    expect(Array.from(order)).toEqual(referenceOrder(depths, 5));
  });

  // The cap is not unreachable: `getDepth` yields roughly one distinct value per legend
  // slot per opacity, so a high-cardinality categorical column (thousands of categories)
  // exceeds 4096 and takes this path in production, not just in tests.
  it('matches the comparator above the distinct-value cap (fallback path)', () => {
    const rng = makeRng(777);
    const n = 20000;
    const depths = new Float32Array(n);
    for (let i = 0; i < n; i++) depths[i] = rng(); // ~20000 distinct >> 4096 cap
    expect(new Set(Array.from(depths)).size).toBeGreaterThan(4096);
    const order = new Uint32Array(n);
    sortIndicesByDepthDescending(order, depths, n);
    expect(Array.from(order)).toEqual(referenceOrder(depths, n));
  });

  it('matches the comparator just under the distinct-value cap', () => {
    const rng = makeRng(4242);
    const distinctCount = 4000;
    const palette = Array.from({ length: distinctCount }, (_, i) => Math.fround(i / distinctCount));
    const n = 12000;
    const depths = new Float32Array(n);
    for (let i = 0; i < n; i++) depths[i] = palette[Math.floor(rng() * distinctCount)];
    expect(new Set(Array.from(depths.subarray(0, n))).size).toBeLessThanOrEqual(4096);
    const order = new Uint32Array(n);
    sortIndicesByDepthDescending(order, depths, n);
    expect(Array.from(order)).toEqual(referenceOrder(depths, n));
  });

  it('handles negative and zero depths', () => {
    const depths = new Float32Array([0, -0, -1.5, 2, -1.5, 0]);
    const order = new Uint32Array(6);
    sortIndicesByDepthDescending(order, depths, 6);
    expect(Array.from(order)).toEqual(referenceOrder(depths, 6));
  });

  it('leaves entries beyond count untouched', () => {
    const depths = new Float32Array([0.3, 0.8, 0.1, 0.6]);
    const order = new Uint32Array([9, 9, 9, 9]);
    sortIndicesByDepthDescending(order, depths, 3);
    expect(order[3]).toBe(9);
  });
});
