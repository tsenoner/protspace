import { describe, it, expect } from 'vitest';
import {
  stagePoint,
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

describe('stagePoint', () => {
  it('writes scaled position, clamped color, basePointSize and depth for one slot', () => {
    const a = arrays(4);
    const sp: PlotDataPoint = { id: 'p', x: 0, y: 0, originalIndex: 0 };
    // screenX/screenY already scaled by the caller (scales.x/scales.y)
    stagePoint(
      a,
      /*idx*/ 1,
      sp,
      /*screenX*/ 12,
      /*screenY*/ 34,
      /*opacity*/ 0.5,
      /*depth*/ 0.7,
      style,
      /*dpr*/ 2,
      /*sizeScaleFactor*/ 1,
    );
    expect(a.dataPositions[2]).toBe(12);
    expect(a.dataPositions[3]).toBe(34);
    expect(a.colors[4]).toBeCloseTo(1); // r
    expect(a.colors[7]).toBeCloseTo(0.5); // clamped opacity
    // size=2, basePointSize=max(1, 2*2*2*1)=8, circle → 8
    expect(a.sizes[1]).toBeCloseTo(8);
    expect(a.depths[1]).toBeCloseTo(0.7);
    expect(a.labelCounts[1]).toBe(1);
    expect(a.shapes[1]).toBe(0);
    expect(a.predicted[1]).toBe(0);
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
    stagePoint(a, 0, sp, 0, 0, 1, 0, diamond, 1, 1);
    // size=2, base=max(1,2*2*1*1)=4, diamond → 4*1.25=5
    expect(a.sizes[0]).toBeCloseTo(5);
    expect(a.predicted[0]).toBe(1);
  });

  it('sizeScaleFactor scales basePointSize (export parity)', () => {
    const a = arrays(2);
    const sp: PlotDataPoint = { id: 'p', x: 0, y: 0, originalIndex: 0 };
    stagePoint(a, 0, sp, 0, 0, 1, 0, style, 1, 2);
    // size=2, base=max(1, 2*2*1*2)=8
    expect(a.sizes[0]).toBeCloseTo(8);
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
    stagePointStyle(a, 1, sp, 1, styleWithColors(twelveColors), 1);
    expect(a.labelCounts[1]).toBe(MAX_LABELS);
  });

  it('honours a reduced stride in both the count and the texels written', () => {
    const a = arrays(4, 4);
    stagePointStyle(a, 1, sp, 1, styleWithColors(twelveColors), 1);
    expect(a.labelCounts[1]).toBe(4);
    // Slot 1 owns texels [4, 8) at stride 4; slot 2's first texel must stay clear.
    const slotTwoFirstTexel = 2 * 4 * 4;
    expect(a.labelColorData![slotTwoFirstTexel + 3]).toBe(0);
  });

  it('stages counts and skips texels when no atlas is allocated', () => {
    const a = arrays(4);
    a.labelColorData = null;
    expect(() =>
      stagePointStyle(a, 1, sp, 1, styleWithColors(['#ff0000', '#00ff00']), 1),
    ).not.toThrow();
    expect(a.labelCounts[1]).toBe(2);
  });

  it('leaves a single-label point at one slice', () => {
    const a = arrays(4);
    stagePointStyle(a, 1, sp, 1, styleWithColors(['#ff0000']), 1);
    expect(a.labelCounts[1]).toBe(1);
  });
});
