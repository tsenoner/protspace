import { describe, it, expect } from 'vitest';
import { computeExtent, computePaddedExtent, DATA_EXTENT_PADDING } from './data-extent';

describe('computeExtent', () => {
  it('returns min/max over the first `length` entries', () => {
    const xs = new Float32Array([1, 5, -3, 100]);
    const ys = new Float32Array([2, 2, 9, -1]);
    expect(computeExtent(xs, ys, 3)).toEqual({
      xMin: -3,
      xMax: 5,
      yMin: 2,
      yMax: 9,
    });
  });
});

describe('computePaddedExtent', () => {
  it('adds 5% of the span on each axis', () => {
    expect(DATA_EXTENT_PADDING).toBe(0.05);
    const xs = new Float32Array([0, 10]);
    const ys = new Float32Array([0, 20]);
    const e = computePaddedExtent(xs, ys, 2);
    expect(e.xMin).toBeCloseTo(-0.5);
    expect(e.xMax).toBeCloseTo(10.5);
    expect(e.yMin).toBeCloseTo(-1);
    expect(e.yMax).toBeCloseTo(21);
  });
});
