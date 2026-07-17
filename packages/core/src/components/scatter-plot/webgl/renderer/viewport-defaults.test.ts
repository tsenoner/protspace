import { describe, it, expect } from 'vitest';
import {
  computeSizeScaleFactor,
  DEFAULT_VIEWPORT_WIDTH,
  DEFAULT_VIEWPORT_HEIGHT,
} from './viewport-defaults';

describe('computeSizeScaleFactor (shared dot/badge export sizing, #302)', () => {
  it('is 1 when reference dims equal display dims', () => {
    expect(computeSizeScaleFactor(800, 600, 800, 600)).toBe(1);
  });

  it('is the sqrt of the area ratio (export-renderer formula, verbatim)', () => {
    // 1600×1200 vs 800×600 → area ratio 4 → factor 2.
    expect(computeSizeScaleFactor(1600, 1200, 800, 600)).toBeCloseTo(2);
    // Non-live aspect still yields a single uniform factor (badges stay round).
    expect(computeSizeScaleFactor(1600, 400, 800, 600)).toBeCloseTo(
      Math.sqrt((1600 * 400) / (800 * 600)),
    );
  });

  it('falls back to the default viewport when display dims are undefined', () => {
    expect(
      computeSizeScaleFactor(DEFAULT_VIEWPORT_WIDTH, DEFAULT_VIEWPORT_HEIGHT, undefined, undefined),
    ).toBe(1);
    expect(computeSizeScaleFactor(1600, 1200, undefined, undefined)).toBeCloseTo(2);
  });
});
