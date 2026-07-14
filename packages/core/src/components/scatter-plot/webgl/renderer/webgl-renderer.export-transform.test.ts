// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import * as d3 from 'd3';
import { WebGLRenderer } from './webgl-renderer';
import type { ScalePair, WebGLStyleGetters } from '../types';
import { createMockCanvas } from './test-support/mock-webgl2';

/**
 * #294: the figure editor (publish modal) captures the scatterplot via
 * `renderToCanvas`. By default that capture preserves the live zoom/pan
 * transform (used by the "export current view" path). When `resetView` is
 * requested, the capture must ignore the live transform and render the
 * default, fit-all view — the same thing a double-click reset shows — so the
 * editor never inherits a stale zoom and its zoom-inset mapping stays correct.
 */

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

type ExportRendererSeam = {
  exportRenderer: {
    renderToCanvas: (...args: unknown[]) => HTMLCanvasElement;
  };
};

function setup(transform: d3.ZoomTransform) {
  const { canvas } = createMockCanvas({});
  const renderer = new WebGLRenderer(
    canvas,
    scales,
    () => transform,
    () => ({ width: 800, height: 600 }),
    style(),
  );
  // Intercept the off-screen export pass (needs a real WebGL2 context we don't
  // have under jsdom). We only assert which transform the facade forwards.
  const spy = vi
    .spyOn((renderer as unknown as ExportRendererSeam).exportRenderer, 'renderToCanvas')
    .mockReturnValue(document.createElement('canvas'));
  return { renderer, spy };
}

function forwardedTransform(spy: ReturnType<typeof vi.fn>) {
  const opts = spy.mock.calls[0][3] as { transform: { x: number; y: number; k: number } };
  return { x: opts.transform.x, y: opts.transform.y, k: opts.transform.k };
}

describe('WebGLRenderer.renderToCanvas — resetView transform handling (#294)', () => {
  afterEach(() => vi.restoreAllMocks());

  it('forwards the live transform when resetView is not requested', () => {
    const live = d3.zoomIdentity.translate(120, 60).scale(3);
    const { renderer, spy } = setup(live);

    renderer.renderToCanvas(400, 300);

    expect(forwardedTransform(spy as unknown as ReturnType<typeof vi.fn>)).toEqual({
      x: 120,
      y: 60,
      k: 3,
    });
  });

  it('forwards an identity transform (default view) when resetView is true', () => {
    const live = d3.zoomIdentity.translate(120, 60).scale(3);
    const { renderer, spy } = setup(live);

    renderer.renderToCanvas(400, 300, 1, undefined, undefined, true);

    expect(forwardedTransform(spy as unknown as ReturnType<typeof vi.fn>)).toEqual({
      x: 0,
      y: 0,
      k: 1,
    });
  });

  it('resetView is independent of the dataDomain (inset) path', () => {
    const live = d3.zoomIdentity.translate(50, 50).scale(2);
    const { renderer, spy } = setup(live);
    const dataDomain = { xMin: 0.1, xMax: 0.4, yMin: 0.1, yMax: 0.4 };

    renderer.renderToCanvas(200, 200, 1, dataDomain, undefined, true);

    expect(forwardedTransform(spy as unknown as ReturnType<typeof vi.fn>)).toEqual({
      x: 0,
      y: 0,
      k: 1,
    });
  });
});
