import { describe, it, expect } from 'vitest';
import { stagePoint, type StagePointArrays, type StagePointStyle } from './stage-point';
import type { PlotDataPoint } from '@protspace/utils';

function arrays(capacity: number): StagePointArrays {
  return {
    dataPositions: new Float32Array(capacity * 2),
    sizes: new Float32Array(capacity),
    colors: new Float32Array(capacity * 4),
    depths: new Float32Array(capacity),
    labelCounts: new Float32Array(capacity),
    shapes: new Float32Array(capacity),
    labelColorData: new Uint8Array(capacity * 8 * 4),
  };
}

const style = {
  getColors: () => ['#ff0000'],
  getPointSize: () => 36, // sqrt(36)/3 = 2
  getShape: () => 'circle', // shapeIndex 0
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
  });

  it('applies DIAMOND_SIZE_SCALE for shapeIndex 2 (diamond)', () => {
    const a = arrays(2);
    const diamond = {
      getColors: () => ['#00ff00'],
      getPointSize: () => 36,
      getShape: () => 'diamond',
    } as never;
    const sp: PlotDataPoint = { id: 'p', x: 0, y: 0, originalIndex: 0 };
    stagePoint(a, 0, sp, 0, 0, 1, 0, diamond, 1, 1);
    // size=2, base=max(1,2*2*1*1)=4, diamond → 4*1.25=5
    expect(a.sizes[0]).toBeCloseTo(5);
  });

  it('sizeScaleFactor scales basePointSize (export parity)', () => {
    const a = arrays(2);
    const sp: PlotDataPoint = { id: 'p', x: 0, y: 0, originalIndex: 0 };
    stagePoint(a, 0, sp, 0, 0, 1, 0, style, 1, 2);
    // size=2, base=max(1, 2*2*1*2)=8
    expect(a.sizes[0]).toBeCloseTo(8);
  });
});
