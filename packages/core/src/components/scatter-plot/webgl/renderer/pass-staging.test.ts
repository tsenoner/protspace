import { describe, it, expect, vi } from 'vitest';
import * as d3 from 'd3';
import type { PlotData, PlotDataPoint } from '@protspace/utils';
import type { ScalePair, WebGLStyleGetters } from '../types';
import { createPassScratch, restageStyles, stageInPaintOrder } from './pass-staging';
import {
  referenceRestage,
  referenceStage,
  referenceStylePass,
  stageArrays,
} from './test-support/reference-staging';

vi.mock('../color-utils', () => ({
  resolveColor: (color: string): [number, number, number] => {
    const n = parseInt(color.slice(1), 16);
    return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
  },
}));

const scales: ScalePair = {
  x: d3.scaleLinear().domain([0, 10]).range([0, 500]),
  y: d3.scaleLinear().domain([0, 10]).range([300, 0]),
};

function plotData(n: number): PlotData {
  return {
    length: n,
    xs: Float32Array.from({ length: n }, (_, i) => (i * 7) % 10),
    ys: Float32Array.from({ length: n }, (_, i) => (i * 3) % 10),
    zs: null,
    originalIndices: Int32Array.from({ length: n }, (_, i) => n - 1 - i),
    proteinIds: Array.from({ length: n }, (_, i) => `id${i}`),
  };
}

/** Getters whose every output varies by point, with a pass that has no records. */
function perPointGetters(): WebGLStyleGetters {
  const colorSets = [['#102030'], ['#405060', '#708090'], [], ['#a0b0c0', '#d0e0f0', '#123456']];
  return {
    getColors: (p: PlotDataPoint) => colorSets[p.originalIndex % 4],
    getPointSize: (p: PlotDataPoint) => 10 + (p.originalIndex % 5),
    getOpacity: (p: PlotDataPoint) => [0, 0.2, 0.8, 1][p.originalIndex % 4],
    getDepth: (p: PlotDataPoint) => (p.originalIndex % 6) / 6,
    getShape: (p: PlotDataPoint) => ['circle', 'diamond', 'square'][p.originalIndex % 3],
    isPredicted: (p: PlotDataPoint) => p.originalIndex % 5 === 0,
    isMultilabel: () => true,
    createStylePass() {
      return referenceStylePass(this);
    },
  };
}

describe('staging slots without a record', () => {
  it('stages through the per-point getters exactly as the reference does', () => {
    const style = perPointGetters();
    for (const n of [300, 3000]) {
      const pd = plotData(n);
      const expected = stageArrays(n, 4, true);
      const reference = referenceStage(style, pd, scales, n, true, expected);

      const staged = stageArrays(n, 4, true);
      const order = new Uint32Array(n);
      const pass = style.createStylePass();
      expect(pass.records.colors).toHaveLength(0);
      const visible: number[] = [];
      const cut = stageInPaintOrder(
        staged,
        pass,
        createPassScratch(n),
        order,
        pd,
        scales,
        n,
        true,
        (slot, opacity) => {
          if (opacity > 0) visible.push(slot);
        },
      );

      expect(Array.from(order)).toEqual(Array.from(reference.order));
      expect(cut).toBe(reference.cut);
      expect(staged).toEqual(expected);
      expect(visible).toHaveLength(Array.from(order).filter((s) => s % 4 !== 3).length);
    }
  });

  it('stages the positions the d3 scales give, to the bit', () => {
    const n = 4000;
    const pd = plotData(n);
    pd.xs = Float32Array.from({ length: n }, (_, i) => Math.sin(i * 12.9898) * 137.3);
    pd.ys = Float32Array.from({ length: n }, (_, i) => Math.cos(i * 78.233) * 0.0371);
    const odd: ScalePair = {
      x: d3.scaleLinear().domain([-144.165, 144.165]).range([40, 1873.5]),
      y: d3.scaleLinear().domain([0.03896, -0.03896]).range([12.25, 977]),
    };
    const style = perPointGetters();
    const expected = stageArrays(n, 4, true);
    referenceStage(style, pd, odd, n, false, expected);
    const staged = stageArrays(n, 4, true);
    const pass = style.createStylePass();
    stageInPaintOrder(staged, pass, createPassScratch(n), new Uint32Array(n), pd, odd, n, false);
    expect(staged.dataPositions).toEqual(expected.dataPositions);
  });

  it('restages styles through the per-point getters exactly as the reference does', () => {
    const n = 2500;
    const pd = plotData(n);
    const style = perPointGetters();
    const staged = stageArrays(n, 4, true);
    const order = new Uint32Array(n);
    const scratch = createPassScratch(n);
    stageInPaintOrder(staged, style.createStylePass(), scratch, order, pd, scales, n, false);

    const recolored: WebGLStyleGetters = { ...style, getColors: () => ['#ffffff', '#000000'] };
    // A restage leaves positions, depths and unused texels as the stage left them.
    const expected = stageArrays(n, 4, true);
    expected.dataPositions.set(staged.dataPositions);
    expected.depths.set(staged.depths);
    expected.labelColorData!.set(staged.labelColorData!);
    referenceRestage(recolored, pd, order, n, expected);
    restageStyles(staged, recolored.createStylePass(), scratch, order, pd, n, n);
    expect(staged).toEqual(expected);
  });
});
