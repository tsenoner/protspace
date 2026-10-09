import { describe, expect, it } from 'vitest';
import { fractionStep, splitSidebar } from './layout-geometry';

describe('splitSidebar', () => {
  it('splitSidebar honours the fraction within the 120 and 220 px minimums', () => {
    expect(splitSidebar(600, 0.5)).toEqual({ legend: 300, structure: 300 });
    expect(splitSidebar(600, 0.1)).toEqual({ legend: 120, structure: 480 });
    expect(splitSidebar(600, 0.8)).toEqual({ legend: 380, structure: 220 });
  });

  it('a short sidebar keeps the legend at its minimum', () => {
    expect(splitSidebar(300, 0.5)).toEqual({ legend: 120, structure: 180 });
    expect(splitSidebar(300, 0.8)).toEqual({ legend: 120, structure: 180 });
    expect(splitSidebar(80, 0.5)).toEqual({ legend: 80, structure: 0 });
  });
});

describe('fractionStep', () => {
  it('fractionStep moves 5 %, or 20 % with Shift', () => {
    expect(fractionStep('ArrowUp', false)).toBeCloseTo(-0.05, 10);
    expect(fractionStep('ArrowDown', false)).toBeCloseTo(0.05, 10);
    expect(fractionStep('ArrowUp', true)).toBeCloseTo(-0.2, 10);
    expect(fractionStep('ArrowDown', true)).toBeCloseTo(0.2, 10);
    expect(fractionStep('ArrowLeft', false)).toBe(0);
    expect(fractionStep('Enter', true)).toBe(0);
  });
});
