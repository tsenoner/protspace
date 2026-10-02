// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import * as d3 from 'd3';
import { WebGLRenderer } from './webgl-renderer';
import type { ScalePair } from '../types';
import { MAX_LABELS } from './label-atlas-plan';
import { styleGetters } from './test-support/renderer-fixture';
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
type ExportRendererSeam = {
  exportRenderer: {
    renderToCanvas: (...args: unknown[]) => HTMLCanvasElement;
  };
};

function setup(transform: d3.ZoomTransform, colors?: string[]) {
  const { canvas } = createMockCanvas({});
  const renderer = new WebGLRenderer(
    canvas,
    scales,
    () => transform,
    () => ({ width: 800, height: 600 }),
    styleGetters(colors),
  );
  // Intercept the off-screen export pass (needs a real WebGL2 context we don't
  // have under jsdom). We only assert which transform the facade forwards.
  const spy = vi
    .spyOn((renderer as unknown as ExportRendererSeam).exportRenderer, 'renderToCanvas')
    .mockReturnValue(document.createElement('canvas'));
  return { renderer, spy };
}

type ExportSpy = ReturnType<typeof setup>['spy'];

/**
 * The options object the facade forwarded to the export pass. One accessor for
 * every forwarded field, typed off the real spy, so a new assertion needs
 * neither another helper nor a cast at its call site.
 */
function forwarded(spy: ExportSpy) {
  return spy.mock.calls[0][3] as {
    transform: { x: number; y: number; k: number };
    labelStride: number | null;
  };
}

function forwardedTransform(spy: ExportSpy) {
  const { transform } = forwarded(spy);
  return { x: transform.x, y: transform.y, k: transform.k };
}

describe('WebGLRenderer.renderToCanvas — resetView transform handling (#294)', () => {
  afterEach(() => vi.restoreAllMocks());

  it('forwards the live transform when resetView is not requested', () => {
    const live = d3.zoomIdentity.translate(120, 60).scale(3);
    const { renderer, spy } = setup(live);

    renderer.renderToCanvas(400, 300);

    expect(forwardedTransform(spy)).toEqual({
      x: 120,
      y: 60,
      k: 3,
    });
  });

  it('forwards an identity transform (default view) when resetView is true', () => {
    const live = d3.zoomIdentity.translate(120, 60).scale(3);
    const { renderer, spy } = setup(live);

    renderer.renderToCanvas(400, 300, 1, undefined, undefined, true);

    expect(forwardedTransform(spy)).toEqual({
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

    expect(forwardedTransform(spy)).toEqual({
      x: 0,
      y: 0,
      k: 1,
    });
  });
});

describe('WebGLRenderer.renderToCanvas — inherited label-atlas stride', () => {
  afterEach(() => vi.restoreAllMocks());

  it('asks the style getters, not the last render, whether an atlas is wanted', () => {
    // The export stages through these getters, so its atlas decision has to come
    // from the same authority as its colours. `this.atlas` records only what the
    // last completed render staged, and is legitimately null while a multi-label
    // annotation is selected — nothing forces a render before an export, so the
    // window between an annotation switch and the next frame would otherwise
    // export dominant colours for a multi-label view.
    const { renderer, spy } = setup(d3.zoomIdentity, ['#f00', '#0f0']);

    renderer.renderToCanvas(400, 300);

    // Full fidelity: with no live plan there is no screen cap to stay under, so
    // the export is free to plan against its own context's limit.
    expect(forwarded(spy).labelStride).toBe(MAX_LABELS);
  });

  it('inherits no atlas for a single-label view', () => {
    const { renderer, spy } = setup(d3.zoomIdentity);

    renderer.renderToCanvas(400, 300);

    expect(forwarded(spy).labelStride).toBeNull();
  });
});
