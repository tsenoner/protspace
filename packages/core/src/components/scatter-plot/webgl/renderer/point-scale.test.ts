import { describe, it, expect } from 'vitest';
import { computePointScale, pointRadiusCss } from './point-scale';

describe('pointRadiusCss', () => {
  it('maps the area-like point size to a CSS radius', () => {
    expect(pointRadiusCss(36)).toBe(2);
    expect(pointRadiusCss(40)).toBeCloseTo(2.10819, 5);
    expect(pointRadiusCss(240)).toBeCloseTo(5.16398, 5);
  });
});

describe('computePointScale', () => {
  it('draws the requested size on a 1000x700 plot at k = 1', () => {
    expect(computePointScale(1, 1000, 700)).toBe(1);
  });

  it('grows dots a little on zoom-in and never shrinks them on zoom-out', () => {
    expect(computePointScale(0.1, 1000, 700)).toBe(1);
    expect(computePointScale(0.5, 1000, 700)).toBe(1);
    expect(computePointScale(4, 1000, 700)).toBeCloseTo(1.41421, 5);
    expect(computePointScale(16, 1000, 700)).toBeCloseTo(2, 5);
    expect(computePointScale(256, 1000, 700)).toBeCloseTo(4, 5);
    expect(computePointScale(1000, 1000, 700)).toBeCloseTo(4, 5);
  });

  it('scales with the plot CSS area, bounded for thumbnails and big monitors', () => {
    expect(computePointScale(1, 2000, 1400)).toBeCloseTo(1.41421, 5);
    expect(computePointScale(1, 800, 600)).toBeCloseTo(0.90999, 5);
    expect(computePointScale(1, 3000, 2100)).toBe(1.5);
    expect(computePointScale(1, 500, 350)).toBe(0.8);
  });

  it('multiplies the zoom and screen gains', () => {
    expect(computePointScale(16, 2000, 1400)).toBeCloseTo(2.82843, 5);
  });
});
