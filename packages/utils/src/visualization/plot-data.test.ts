import { describe, it, expect } from 'vitest';
import {
  EMPTY_PLOT_DATA,
  plotDataOriginalIndex,
  plotDataId,
  materializePlotDataPoint,
  clonePlotData,
  gatherPlotData,
} from './plot-data';
import type { PlotData } from '../types';

function makeIdentityPD(xs: number[], ys: number[], ids?: string[]): PlotData {
  return {
    length: xs.length,
    xs: new Float32Array(xs),
    ys: new Float32Array(ys),
    zs: null,
    originalIndices: null,
    proteinIds: ids ?? xs.map((_, i) => `p${i}`),
  };
}

function makeIsolatedPD(
  xs: number[],
  ys: number[],
  originalIndices: number[],
  proteinIds: string[],
): PlotData {
  return {
    length: xs.length,
    xs: new Float32Array(xs),
    ys: new Float32Array(ys),
    zs: null,
    originalIndices: new Int32Array(originalIndices),
    proteinIds,
  };
}

describe('EMPTY_PLOT_DATA', () => {
  it('has length 0 and empty typed arrays', () => {
    expect(EMPTY_PLOT_DATA.length).toBe(0);
    expect(EMPTY_PLOT_DATA.xs.length).toBe(0);
    expect(EMPTY_PLOT_DATA.ys.length).toBe(0);
    expect(EMPTY_PLOT_DATA.zs).toBeNull();
    expect(EMPTY_PLOT_DATA.originalIndices).toBeNull();
    expect(EMPTY_PLOT_DATA.proteinIds).toHaveLength(0);
  });
});

describe('plotDataOriginalIndex', () => {
  it('returns slot index directly when originalIndices is null (identity mapping)', () => {
    const pd = makeIdentityPD([1, 2, 3], [4, 5, 6]);
    expect(plotDataOriginalIndex(pd, 0)).toBe(0);
    expect(plotDataOriginalIndex(pd, 2)).toBe(2);
  });

  it('returns mapped protein index when originalIndices is present', () => {
    const pd = makeIsolatedPD([5, 7], [6, 8], [2, 3], ['a', 'b', 'c', 'd']);
    expect(plotDataOriginalIndex(pd, 0)).toBe(2);
    expect(plotDataOriginalIndex(pd, 1)).toBe(3);
  });
});

describe('plotDataId', () => {
  it('returns correct protein id for identity mapping', () => {
    const pd = makeIdentityPD([1, 2], [3, 4], ['alpha', 'beta']);
    expect(plotDataId(pd, 0)).toBe('alpha');
    expect(plotDataId(pd, 1)).toBe('beta');
  });

  it('returns correct protein id for isolated mapping', () => {
    const pd = makeIsolatedPD([5, 7], [6, 8], [2, 3], ['a', 'b', 'c', 'd']);
    expect(plotDataId(pd, 0)).toBe('c'); // originalIndices[0] = 2 → proteinIds[2]
    expect(plotDataId(pd, 1)).toBe('d'); // originalIndices[1] = 3 → proteinIds[3]
  });
});

describe('materializePlotDataPoint', () => {
  it('creates correct PlotDataPoint for identity-mapped slot', () => {
    const pd = makeIdentityPD([1, 3], [2, 4], ['p0', 'p1']);
    const pt = materializePlotDataPoint(pd, 1);
    expect(pt).toEqual({ id: 'p1', x: 3, y: 4, originalIndex: 1 });
  });

  it('creates correct PlotDataPoint for isolated slot', () => {
    // slot 0 → protein index 2 → id 'c'
    const pd = makeIsolatedPD([5, 7], [6, 8], [2, 3], ['a', 'b', 'c', 'd']);
    const pt = materializePlotDataPoint(pd, 0);
    expect(pt).toEqual({ id: 'c', x: 5, y: 6, originalIndex: 2 });
  });

  it('includes z field when zs is present', () => {
    const pd: PlotData = {
      length: 1,
      xs: new Float32Array([10]),
      ys: new Float32Array([20]),
      zs: new Float32Array([30]),
      originalIndices: null,
      proteinIds: ['x'],
    };
    const pt = materializePlotDataPoint(pd, 0);
    expect(pt.z).toBe(30);
  });

  it('omits z field when zs is null', () => {
    const pd = makeIdentityPD([1], [2], ['p0']);
    const pt = materializePlotDataPoint(pd, 0);
    expect('z' in pt).toBe(false);
  });
});

describe('clonePlotData', () => {
  it('returns a new object with the SAME typed-array references', () => {
    const pd = makeIdentityPD([1, 2], [3, 4]);
    const clone = clonePlotData(pd);
    expect(clone).not.toBe(pd); // different container
    expect(clone.xs).toBe(pd.xs); // same buffer ref
    expect(clone.ys).toBe(pd.ys);
    expect(clone.length).toBe(pd.length);
    expect(clone.originalIndices).toBeNull();
    expect(clone.proteinIds).toBe(pd.proteinIds);
  });
});

describe('gatherPlotData', () => {
  it('gathers a subset of slots into a new PlotData', () => {
    const pd = makeIdentityPD([10, 20, 30, 40], [1, 2, 3, 4], ['a', 'b', 'c', 'd']);
    const gathered = gatherPlotData(pd, [1, 3]);
    expect(gathered.length).toBe(2);
    expect(Array.from(gathered.xs)).toEqual([20, 40]);
    expect(Array.from(gathered.ys)).toEqual([2, 4]);
    expect(gathered.originalIndices).not.toBeNull();
    expect(Array.from(gathered.originalIndices!)).toEqual([1, 3]);
    expect(gathered.proteinIds).toBe(pd.proteinIds); // shared ref
  });

  it('propagates zs when source has zs', () => {
    const pd: PlotData = {
      length: 3,
      xs: new Float32Array([1, 2, 3]),
      ys: new Float32Array([4, 5, 6]),
      zs: new Float32Array([7, 8, 9]),
      originalIndices: null,
      proteinIds: ['p0', 'p1', 'p2'],
    };
    const gathered = gatherPlotData(pd, [0, 2]);
    expect(gathered.zs).not.toBeNull();
    expect(Array.from(gathered.zs!)).toEqual([7, 9]);
  });

  it('returns null zs when source has no zs', () => {
    const pd = makeIdentityPD([1, 2], [3, 4]);
    const gathered = gatherPlotData(pd, [0]);
    expect(gathered.zs).toBeNull();
  });

  it('handles empty slots array', () => {
    const pd = makeIdentityPD([1, 2, 3], [4, 5, 6]);
    const gathered = gatherPlotData(pd, []);
    expect(gathered.length).toBe(0);
  });
});
