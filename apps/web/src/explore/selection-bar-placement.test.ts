import { describe, expect, it } from 'vitest';
import { SELECTION_BAR } from './layout-defaults';
import { placeSelectionBar } from './selection-bar-placement';

const EDGE = SELECTION_BAR.offset;
const base = { statusHeight: 30, fullWidth: 400, compactWidth: 200 };

describe('placeSelectionBar', () => {
  it.each([
    {
      name: 'centres the full bar when the centre clears the count',
      input: { ...base, plotWidth: 1000, countRight: 100 },
      want: { left: 300, bottom: EDGE, compact: false, statusMaxWidth: 280 },
    },
    {
      name: 'pushes the full bar right of the count when the centre would cover it',
      input: { ...base, plotWidth: 800, countRight: 300 },
      want: { left: 308, bottom: EDGE, compact: false, statusMaxWidth: 288 },
    },
    {
      name: 'goes compact beside the count when only the compact bar fits',
      input: { ...base, plotWidth: 600, countRight: 300 },
      want: { left: 308, bottom: EDGE, compact: true, statusMaxWidth: 288 },
    },
    {
      name: 'moves the full bar above the status corner when neither fits beside it',
      input: { ...base, plotWidth: 500, countRight: 400 },
      want: { left: 50, bottom: EDGE + 30 + 8, compact: false, statusMaxWidth: null },
    },
    {
      name: 'moves a compact bar above the status corner on a plot too narrow for the full one',
      input: { ...base, plotWidth: 360, countRight: 300 },
      want: { left: 80, bottom: EDGE + 30 + 8, compact: true, statusMaxWidth: null },
    },
  ])('$name', ({ input, want }) => {
    const place = placeSelectionBar(input);
    expect(place).toEqual(want);
    const width = place.compact ? input.compactWidth : input.fullWidth;
    expect(place.left).toBeGreaterThanOrEqual(EDGE);
    expect(place.left + width).toBeLessThanOrEqual(input.plotWidth - EDGE);
  });
});
