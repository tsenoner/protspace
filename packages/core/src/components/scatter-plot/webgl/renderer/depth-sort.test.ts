import { describe, it, expect } from 'vitest';
import { sortIndicesByDepthDescending } from './depth-sort';
import { seededRandom } from '../../../../test-support/seeded-random';

describe('sortIndicesByDepthDescending', () => {
  it('basic: descending depth, ties break by ascending original index', () => {
    const order = new Uint32Array(4);
    const depths = new Float32Array([0.5, 0.1, 0.9, 0.1]);
    sortIndicesByDepthDescending(order, depths, 4, new Uint32Array(4));
    // Expected: 0.9 (idx2) > 0.5 (idx0) > 0.1 (idx1, idx3 — ascending tiebreak)
    expect(Array.from(order)).toEqual([2, 0, 1, 3]);
  });

  it('all-equal depths: stable identity order', () => {
    const n = 5;
    const order = new Uint32Array(n);
    const depths = new Float32Array([0.5, 0.5, 0.5, 0.5, 0.5]);
    sortIndicesByDepthDescending(order, depths, n, new Uint32Array(n));
    expect(Array.from(order)).toEqual([0, 1, 2, 3, 4]);
  });

  it('count smaller than array length: only order[0..count) is sorted', () => {
    const order = new Uint32Array(6);
    const depths = new Float32Array([0.3, 0.8, 0.1, 0.6, 0.9, 0.2]);
    // Sort only first 3 elements: depths[0..3) = [0.3, 0.8, 0.1]
    sortIndicesByDepthDescending(order, depths, 3, new Uint32Array(6));
    // Sorted subarray: 0.8 (idx1) > 0.3 (idx0) > 0.1 (idx2)
    expect(Array.from(order.subarray(0, 3))).toEqual([1, 0, 2]);
    // Elements beyond count are not asserted (implementation-defined)
  });

  it('larger fixed array: non-increasing depth, equal-depth runs in ascending index', () => {
    const depths = new Float32Array([0.7, 0.3, 0.7, 0.1, 0.5, 0.7, 0.3, 0.9]);
    const n = depths.length;
    const order = new Uint32Array(n);
    sortIndicesByDepthDescending(order, depths, n, new Uint32Array(n));

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
    expect(() => sortIndicesByDepthDescending(order, depths, 1, new Uint32Array(1))).not.toThrow();
    expect(order[0]).toBe(0);
  });

  it('count 0: no throw', () => {
    const order = new Uint32Array(4);
    const depths = new Float32Array([0.5, 0.3, 0.1, 0.8]);
    expect(() => sortIndicesByDepthDescending(order, depths, 0, new Uint32Array(4))).not.toThrow();
  });
});

// ── parity with the comparator reference ───────────────────────

/** The plain comparator on a typed identity, so a NaN orders exactly as the fallback does. */
function comparatorOrder(depths: Float32Array, count: number): number[] {
  const ids = new Uint32Array(count);
  for (let i = 0; i < count; i++) ids[i] = i;
  ids.sort((a, b) => depths[b] - depths[a] || a - b);
  return Array.from(ids);
}

/** The sort as staging calls it, with a scratch as long as the count. */
function sortedOrder(depths: Float32Array, count: number): number[] {
  const order = new Uint32Array(count);
  sortIndicesByDepthDescending(order, depths, count, new Uint32Array(count));
  return Array.from(order);
}

describe('sortIndicesByDepthDescending parity with the comparator', () => {
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
    const rng = seededRandom(999);
    const n = 20000;
    const depths = new Float32Array(n);
    for (let i = 0; i < n; i++) depths[i] = palette[Math.floor(rng() * palette.length)];
    expect(sortedOrder(depths, n)).toEqual(comparatorOrder(depths, n));
  });

  it('falls back to the comparator on a NaN depth', () => {
    // NaN makes `depths[b] - depths[a]` NaN, so the comparator falls through to the index
    // tiebreak and index order wins. Keyed by its bits, the radix sort would instead put
    // NaN above every finite depth and return [1, 0, 2].
    const depths = new Float32Array([1, Number.NaN, 1]);
    expect(sortedOrder(depths, 3)).toEqual([0, 1, 2]);
    expect(sortedOrder(depths, 3)).toEqual(comparatorOrder(depths, 3));
  });

  it('sorts infinities', () => {
    const depths = new Float32Array([Infinity, 0, Infinity, -Infinity, 0]);
    expect(sortedOrder(depths, 5)).toEqual([0, 2, 1, 4, 3]);
    expect(sortedOrder(depths, 5)).toEqual(comparatorOrder(depths, 5));
  });

  it('handles negative and zero depths', () => {
    const depths = new Float32Array([0, -0, -1.5, 2, -1.5, 0]);
    expect(sortedOrder(depths, 6)).toEqual(comparatorOrder(depths, 6));
  });

  it('sorts only the first count slots of capacity-sized buffers', () => {
    const next = seededRandom(12345);
    const depths = Float32Array.from({ length: 6000 }, () => Math.round(next() * 50) / 50);
    const order = new Uint32Array(6000);
    sortIndicesByDepthDescending(order, depths, 4000, new Uint32Array(6000));
    expect(Array.from(order.subarray(0, 4000))).toEqual(comparatorOrder(depths, 4000));
  });

  it('leaves entries beyond count untouched', () => {
    const depths = new Float32Array([0.3, 0.8, 0.1, 0.6]);
    const order = new Uint32Array([9, 9, 9, 9]);
    sortIndicesByDepthDescending(order, depths, 3, new Uint32Array(4));
    expect(order[3]).toBe(9);
  });
});

// ── parity over random inputs ──────────────────────────────────

describe('sortIndicesByDepthDescending parity over random inputs', () => {
  const sizes = [2, 3, 7, 100, 2047, 2048, 5000];
  const specials = [0, -0, Infinity, -Infinity, 1e-45, -1e-45, 3.4e38, -3.4e38];
  const shapes: Record<string, (next: () => number, n: number) => Float32Array> = {
    // A few distinct values, like painter tiers times legend slots: long equal runs.
    'heavily tied': (next, n) => {
      const palette = [next(), next(), next(), next()].map((r) => r * 2 - 1);
      return Float32Array.from({ length: n }, () => palette[Math.floor(next() * 4)]);
    },
    continuous: (next, n) => Float32Array.from({ length: n }, () => (next() - 0.5) * 2000),
    special: (next, n) =>
      Float32Array.from({ length: n }, () => {
        const r = next();
        return r < 0.5 ? specials[Math.floor(r * 2 * specials.length)] : (r - 0.75) * 1000;
      }),
  };

  const cases = Object.keys(shapes).flatMap((shape) =>
    [false, true].map(
      (withNaN) => [withNaN ? `${shape}, one NaN` : shape, shape, withNaN] as const,
    ),
  );

  it.each(cases)('%s', (_name, shape, withNaN) => {
    const next = seededRandom(2048);
    for (const n of sizes) {
      const depths = shapes[shape](next, n);
      if (withNaN) depths[Math.floor(next() * n)] = NaN;
      expect(sortedOrder(depths, n), `n = ${n}`).toEqual(comparatorOrder(depths, n));
    }
  });
});
