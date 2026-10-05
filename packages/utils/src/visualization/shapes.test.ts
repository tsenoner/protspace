import { describe, it, expect } from 'vitest';
import { toDisplayValue, LEGEND_VALUES, SHAPE_PATH_GENERATORS } from './shapes';
import { NA_VALUE, NA_DISPLAY } from './missing-values';

describe('toDisplayValue', () => {
  it('returns NA_DISPLAY for the internal NA token', () => {
    expect(toDisplayValue(NA_VALUE)).toBe(NA_DISPLAY);
    expect(toDisplayValue('__NA__')).toBe('N/A');
  });

  it('returns the value unchanged for regular categories', () => {
    expect(toDisplayValue('Hemoglobin')).toBe('Hemoglobin');
    expect(toDisplayValue('TP53')).toBe('TP53');
  });

  it('returns "Other" unchanged when otherItemsCount is undefined or zero', () => {
    expect(toDisplayValue(LEGEND_VALUES.OTHER)).toBe('Other');
    expect(toDisplayValue(LEGEND_VALUES.OTHER, 0)).toBe('Other');
  });

  it('appends category count to "Other" when otherItemsCount is positive', () => {
    expect(toDisplayValue(LEGEND_VALUES.OTHER, 3)).toBe('Other (3 categories)');
    expect(toDisplayValue(LEGEND_VALUES.OTHER, 17)).toBe('Other (17 categories)');
  });
});

describe('SHAPE_PATH_GENERATORS', () => {
  const testSize = 20;

  it('circle generates valid SVG arc path', () => {
    const path = SHAPE_PATH_GENERATORS.circle(testSize);
    expect(path).toContain('M');
    expect(path).toContain('A');
    // Two arcs form a complete circle
    expect((path.match(/A/g) || []).length).toBe(2);
  });

  it('square generates closed 4-sided path', () => {
    const path = SHAPE_PATH_GENERATORS.square(testSize);
    expect(path).toMatch(/^M.*L.*L.*L.*Z$/);
  });

  it('diamond generates closed 4-point path', () => {
    const path = SHAPE_PATH_GENERATORS.diamond(testSize);
    expect(path).toMatch(/^M.*L.*L.*L.*Z$/);
  });

  it('plus generates closed 12-point path', () => {
    const path = SHAPE_PATH_GENERATORS.plus(testSize);
    expect((path.match(/L/g) || []).length).toBe(11);
    expect(path).toContain('Z');
  });

  it('triangle-up generates closed 3-point path', () => {
    const path = SHAPE_PATH_GENERATORS['triangle-up'](testSize);
    expect((path.match(/L/g) || []).length).toBe(2);
    expect(path).toContain('Z');
  });

  it('triangle-down generates closed 3-point path', () => {
    const path = SHAPE_PATH_GENERATORS['triangle-down'](testSize);
    expect((path.match(/L/g) || []).length).toBe(2);
    expect(path).toContain('Z');
  });

  it('circle radius is half the size', () => {
    expect(SHAPE_PATH_GENERATORS.circle(10)).toBe('M 5,0 A 5,5 0 1,1 -5,0 A 5,5 0 1,1 5,0');
    expect(SHAPE_PATH_GENERATORS.circle(20)).toBe('M 10,0 A 10,10 0 1,1 -10,0 A 10,10 0 1,1 10,0');
  });

  // Every coordinate of a polygon is linear in size, so doubling the size doubles each one.
  it.each(['square', 'diamond', 'plus', 'triangle-up', 'triangle-down'])(
    '%s coordinates scale linearly with size',
    (shape) => {
      const coords = (size: number) =>
        (SHAPE_PATH_GENERATORS[shape](size).match(/-?\d+(\.\d+)?(e-?\d+)?/g) ?? []).map(Number);
      const small = coords(10);
      const large = coords(20);
      expect(small.some((c) => c !== 0)).toBe(true);
      expect(large).toHaveLength(small.length);
      large.forEach((c, i) => expect(c).toBeCloseTo(2 * small[i], 10));
    },
  );
});
