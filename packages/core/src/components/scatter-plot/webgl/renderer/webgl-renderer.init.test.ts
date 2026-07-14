// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import * as d3 from 'd3';
import { WebGLRenderer } from './webgl-renderer';
import type { PlotData } from '@protspace/utils';
import type { ScalePair, WebGLStyleGetters } from '../types';
import { createMockCanvas, type MockGLOptions } from './test-support/mock-webgl2';

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
  isPredicted: () => false,
});

function makeRenderer(opts: MockGLOptions) {
  const { canvas } = createMockCanvas(opts);
  return new WebGLRenderer(
    canvas,
    scales,
    () => d3.zoomIdentity,
    () => ({ width: 800, height: 600 }),
    style(),
  );
}

describe('WebGLRenderer init failure (F-03 characterization lock)', () => {
  // Per-test cleanup: restores every vi.spyOn (console.error below + the
  // getContext spy createMockCanvas installs) even if a test throws before any
  // inline restore. Inline mockRestore() can be skipped by an exception and leak
  // a console spy into the rest of the suite.
  afterEach(() => vi.restoreAllMocks());

  it('getContext(webgl2) null → render() is a no-op, does not throw', () => {
    const r = makeRenderer({ contextUnavailable: true });
    expect(() => r.render(pd)).not.toThrow();
    // No usable context, so no draw is attempted. drawArrays spy proves nothing rendered.
  });

  it('program link failure → render() does not throw and draws nothing', () => {
    const { canvas, gl } = createMockCanvas({ failProgramLink: true });
    const drawSpy = vi.spyOn(gl as unknown as { drawArrays: () => void }, 'drawArrays');
    const r = new WebGLRenderer(
      canvas,
      scales,
      () => d3.zoomIdentity,
      () => ({ width: 800, height: 600 }),
      style(),
    );
    expect(() => r.render(pd)).not.toThrow();
    expect(drawSpy).not.toHaveBeenCalled();
  });

  it('console.error is emitted (not swallowed) when getContext returns null', () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    makeRenderer({ contextUnavailable: true }).render(pd);
    expect(errSpy).toHaveBeenCalledWith('WebGL2 not available');
    // Restore is handled by afterEach(vi.restoreAllMocks) so an early throw
    // above cannot leak this console.error spy into later tests.
  });
});
