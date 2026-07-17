// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import * as d3 from 'd3';
import { WebGLRenderer } from './webgl-renderer';
import { ExportRenderer } from './export-renderer';
import type { PlotData } from '@protspace/utils';
import type { ScalePair, WebGLStyleGetters } from '../types';
import { createMockCanvas } from './test-support/mock-webgl2';

const pd: PlotData = {
  length: 2,
  xs: new Float32Array([0, 1]),
  ys: new Float32Array([0, 1]),
  zs: null,
  originalIndices: null,
  proteinIds: ['p0', 'p1'],
};
const scales = (): ScalePair => ({
  x: d3.scaleLinear().domain([0, 1]).range([0, 800]),
  y: d3.scaleLinear().domain([0, 1]).range([0, 600]),
});
const style = (): WebGLStyleGetters => ({
  getColors: () => ['#f00'],
  getPointSize: () => 9,
  getOpacity: () => 1,
  getDepth: () => 0,
  getShape: () => 'circle',
});
const config = { width: 800, height: 600 };

function makeRenderer() {
  const { canvas } = createMockCanvas({});
  return new WebGLRenderer(
    canvas,
    scales,
    () => d3.zoomIdentity,
    () => config,
    style(),
  );
}

describe('WebGLRenderer.createExportScales (facade pass-through, #301/#302)', () => {
  it('returns null before anything has been rendered', () => {
    expect(makeRenderer().createExportScales(400, 300)).toBeNull();
  });

  it('after render(), delegates to ExportRenderer.createExportScales with the last-rendered data + live config', () => {
    const r = makeRenderer();
    r.render(pd);
    const got = r.createExportScales(400, 300);
    const want = ExportRenderer.createExportScales(config, pd, 400, 300);
    expect(got).not.toBeNull();
    expect(got!.x.domain()).toEqual(want!.x.domain());
    expect(got!.x.range()).toEqual(want!.x.range());
    expect(got!.y.domain()).toEqual(want!.y.domain());
    expect(got!.y.range()).toEqual(want!.y.range());
  });
});
