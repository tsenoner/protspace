import { describe, it, expect } from 'vitest';
import { createStageArrays, packPointStyle, type StagePointArrays } from './stage-point';
import { MAX_LABELS } from './label-atlas-plan';

function arrays(capacity: number, maxLabels: number = MAX_LABELS): StagePointArrays {
  return createStageArrays(capacity, maxLabels, new Uint8Array(capacity * maxLabels * 4));
}

/** A circle of size 36 (sqrt(36)/3 = 2), not predicted, at full opacity. */
function packColors(a: StagePointArrays, idx: number, colors: string[]): void {
  packPointStyle(a, idx, colors, 'circle', 36, 1, false);
}

describe('packPointStyle', () => {
  it('writes clamped color, CSS diameter, shape and flags for one slot', () => {
    const a = arrays(4);
    packPointStyle(a, /*idx*/ 1, ['#ff0000'], 'circle', 36, /*opacity*/ 0.5, false);
    expect(a.colors[4]).toBeCloseTo(1); // r
    expect(a.colors[7]).toBeCloseTo(0.5); // clamped opacity
    expect(a.sizes[1]).toBeCloseTo(4);
    expect(a.labelCounts[1]).toBe(1);
    expect(a.shapes[1]).toBe(0);
    expect(a.predicted[1]).toBe(0);
    // Position and depth are the staging pass's to write, not the style's.
    expect(a.dataPositions[2]).toBe(0);
    expect(a.depths[1]).toBe(0);
  });

  it('applies DIAMOND_SIZE_SCALE for shapeIndex 2 (diamond)', () => {
    const a = arrays(2);
    packPointStyle(a, 0, ['#00ff00'], 'diamond', 36, 1, true);
    expect(a.sizes[0]).toBeCloseTo(5);
    expect(a.predicted[0]).toBe(1);
  });
});

describe('packPointStyle label capacity', () => {
  const twelveColors = [
    '#000000',
    '#111111',
    '#222222',
    '#333333',
    '#444444',
    '#555555',
    '#666666',
    '#777777',
    '#888888',
    '#999999',
    '#aaaaaa',
    '#bbbbbb',
  ];

  it('clamps the staged label count to the reserved slice count', () => {
    // Unclamped, the shader was told to draw 12 slices from 8 reserved texels,
    // so slices 8..11 sampled the NEXT point's storage — an unrelated protein's
    // colours, presented as this one's data.
    const a = arrays(4);
    packColors(a, 1, twelveColors);
    expect(a.labelCounts[1]).toBe(MAX_LABELS);
  });

  it('honours a reduced stride in both the count and the texels written', () => {
    const a = arrays(4, 4);
    packColors(a, 1, twelveColors);
    expect(a.labelCounts[1]).toBe(4);
    // Slot 1 owns texels [4, 8) at stride 4; slot 2's first texel must stay clear.
    const slotTwoFirstTexel = 2 * 4 * 4;
    expect(a.labelColorData![slotTwoFirstTexel + 3]).toBe(0);
  });

  it('stages counts and skips texels when no atlas is allocated', () => {
    const a = arrays(4);
    a.labelColorData = null;
    expect(() => packColors(a, 1, ['#ff0000', '#00ff00'])).not.toThrow();
    expect(a.labelCounts[1]).toBe(2);
  });

  it('leaves a single-label point at one slice', () => {
    const a = arrays(4);
    packColors(a, 1, ['#ff0000']);
    expect(a.labelCounts[1]).toBe(1);
  });
});
