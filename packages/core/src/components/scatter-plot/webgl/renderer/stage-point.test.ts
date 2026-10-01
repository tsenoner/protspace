import { describe, it, expect } from 'vitest';
import {
  packPointStyle,
  stagePointStyle,
  type StagePointArrays,
  type StagePointStyle,
} from './stage-point';
import { MAX_LABELS } from './label-atlas-plan';
import type { PlotDataPoint } from '@protspace/utils';

function arrays(capacity: number, maxLabels: number = MAX_LABELS): StagePointArrays {
  return {
    dataPositions: new Float32Array(capacity * 2),
    sizes: new Float32Array(capacity),
    colors: new Float32Array(capacity * 4),
    depths: new Float32Array(capacity),
    labelCounts: new Float32Array(capacity),
    shapes: new Float32Array(capacity),
    predicted: new Float32Array(capacity),
    labelColorData: new Uint8Array(capacity * maxLabels * 4),
    maxLabels,
  };
}

function styleWithColors(colors: string[]): StagePointStyle {
  return {
    getColors: () => colors,
    getPointSize: () => 36,
    getShape: () => 'circle',
    isPredicted: () => false,
  } as unknown as StagePointStyle;
}

const style = {
  getColors: () => ['#ff0000'],
  getPointSize: () => 36, // sqrt(36)/3 = 2
  getShape: () => 'circle', // shapeIndex 0
  isPredicted: () => false,
} as unknown as StagePointStyle;

describe('stagePointStyle', () => {
  it('writes clamped color, CSS diameter, shape and flags for one slot', () => {
    const a = arrays(4);
    const sp: PlotDataPoint = { id: 'p', x: 0, y: 0, originalIndex: 0 };
    stagePointStyle(a, /*idx*/ 1, sp, /*opacity*/ 0.5, style);
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
    const diamond = {
      getColors: () => ['#00ff00'],
      getPointSize: () => 36,
      getShape: () => 'diamond',
      isPredicted: () => true,
    } as never;
    const sp: PlotDataPoint = { id: 'p', x: 0, y: 0, originalIndex: 0 };
    stagePointStyle(a, 0, sp, 1, diamond);
    expect(a.sizes[0]).toBeCloseTo(5);
    expect(a.predicted[0]).toBe(1);
  });

  it('packs exactly what packPointStyle packs from the same values', () => {
    const viaGetters = arrays(2);
    const direct = arrays(2);
    const sp: PlotDataPoint = { id: 'p', x: 0, y: 0, originalIndex: 0 };
    const pie = styleWithColors(['#123456', '#abcdef', '#fedcba']);
    stagePointStyle(viaGetters, 1, sp, 0.7, pie);
    packPointStyle(direct, 1, ['#123456', '#abcdef', '#fedcba'], 'circle', 36, 0.7, false);
    expect(viaGetters).toEqual(direct);
  });
});

describe('stagePointStyle label capacity', () => {
  const sp: PlotDataPoint = { id: 'p', x: 0, y: 0, originalIndex: 0 };
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
    stagePointStyle(a, 1, sp, 1, styleWithColors(twelveColors));
    expect(a.labelCounts[1]).toBe(MAX_LABELS);
  });

  it('honours a reduced stride in both the count and the texels written', () => {
    const a = arrays(4, 4);
    stagePointStyle(a, 1, sp, 1, styleWithColors(twelveColors));
    expect(a.labelCounts[1]).toBe(4);
    // Slot 1 owns texels [4, 8) at stride 4; slot 2's first texel must stay clear.
    const slotTwoFirstTexel = 2 * 4 * 4;
    expect(a.labelColorData![slotTwoFirstTexel + 3]).toBe(0);
  });

  it('stages counts and skips texels when no atlas is allocated', () => {
    const a = arrays(4);
    a.labelColorData = null;
    expect(() =>
      stagePointStyle(a, 1, sp, 1, styleWithColors(['#ff0000', '#00ff00'])),
    ).not.toThrow();
    expect(a.labelCounts[1]).toBe(2);
  });

  it('leaves a single-label point at one slice', () => {
    const a = arrays(4);
    stagePointStyle(a, 1, sp, 1, styleWithColors(['#ff0000']));
    expect(a.labelCounts[1]).toBe(1);
  });
});
