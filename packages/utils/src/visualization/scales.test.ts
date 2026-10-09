import { describe, expect, it } from 'vitest';
import { fitRect, fitScales, type DataDomain, type PlotMargin } from './scales';

const MARGIN: PlotMargin = { top: 40, right: 40, bottom: 40, left: 40 };
const SQUARE: DataDomain = { xMin: 0, xMax: 10, yMin: 0, yMax: 10 };

describe('fitScales', () => {
  it('a wide box narrows x and centres it; y keeps its full range', () => {
    // Inner area 920 × 520: the 10 × 10 domain becomes a 520 px square, centred in x.
    const { x, y } = fitScales(SQUARE, 1000, 600, MARGIN);
    expect(x.range()).toEqual([240, 760]);
    expect(y.range()).toEqual([560, 40]);
  });

  it('a tall box narrows y and centres it; x keeps its full range', () => {
    // Inner area 520 × 920: a 520 px square, centred in y.
    const { x, y } = fitScales(SQUARE, 600, 1000, MARGIN);
    expect(x.range()).toEqual([40, 560]);
    expect(y.range()).toEqual([760, 240]);
  });

  it('x and y share one pixels-per-unit', () => {
    const { x, y } = fitScales({ xMin: -3, xMax: 7, yMin: 2, yMax: 4.5 }, 1280, 628, MARGIN);
    expect(Math.abs(x(1) - x(0))).toBeCloseTo(Math.abs(y(1) - y(0)), 9);
  });

  it('the domain is the input at any size', () => {
    const domain: DataDomain = { xMin: -3.5, xMax: 12.25, yMin: 100, yMax: 140 };
    for (const [width, height] of [
      [800, 600],
      [1440, 900],
      [320, 1200],
      [10, 10],
    ]) {
      const { x, y } = fitScales(domain, width, height, MARGIN);
      expect(x.domain()).toEqual([domain.xMin, domain.xMax]);
      expect(y.domain()).toEqual([domain.yMin, domain.yMax]);
    }
  });

  it('asymmetric margins centre the rect within the inner area', () => {
    // Inner area 740 × 560 from (40, 10): a 560 px square, 90 px in from each side of it.
    const margin: PlotMargin = { top: 10, right: 20, bottom: 30, left: 40 };
    expect(fitRect(SQUARE, 800, 600, margin)).toEqual({
      left: 130,
      top: 10,
      width: 560,
      height: 560,
    });
  });

  it('a zero x span takes the full x range and y stays finite', () => {
    const { x, y } = fitScales({ xMin: 5, xMax: 5, yMin: 0, yMax: 4 }, 800, 600, MARGIN);
    expect(x.range()).toEqual([40, 760]);
    expect(y.range()).toEqual([560, 40]);
    // d3 puts a single-value domain on the middle of its range.
    expect(x(5)).toBe(400);
    expect(Number.isFinite(y(2))).toBe(true);
  });

  it('both spans zero give full ranges, so no range collapses', () => {
    const { x, y } = fitScales({ xMin: 1, xMax: 1, yMin: 2, yMax: 2 }, 800, 600, MARGIN);
    expect(x.range()).toEqual([40, 760]);
    expect(y.range()).toEqual([560, 40]);
  });

  it('a box smaller than its margins stays finite', () => {
    const rect = fitRect(SQUARE, 50, 30, MARGIN);
    expect(rect).toEqual({ left: 40, top: 40, width: 1, height: 1 });
  });
});
