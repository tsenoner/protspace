/**
 * @vitest-environment jsdom
 *
 * A resize used to re-stage every point (style getters plus depth sort, ~500 ms
 * at 573K) on every ResizeObserver step. Now the renderer re-maps the staged
 * positions through a uniform, so a step redraws what is already on the GPU. The
 * point grid is still rebuilt on the next frame (~30 ms at 573K).
 *
 * As in scatter-plot.render-coalescing.test.ts, the element stays unattached and
 * a real WebGLRenderer on the mock WebGL2 canvas is attached by hand.
 */
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { PlotData, ScalePair, VisualizationData } from '@protspace/utils';
import { createMockCanvas } from './webgl/renderer/test-support/mock-webgl2';

vi.hoisted(() => {
  if (!('ResizeObserver' in globalThis)) {
    (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    };
  }
});

import './scatter-plot';

type Internals = HTMLElement & {
  data: VisualizationData;
  selectedAnnotation: string;
  updateComplete: Promise<boolean>;
  _plotData: PlotData;
  _scales: ScalePair | null;
  _webglRenderer: { populateBuffers(...a: unknown[]): void } | null;
  _dupOverlay: { resetState(): void };
  _processData(): void;
  _buildPointGridIndex(): void;
  _createWebglRenderer(): void;
  _renderNow(): void;
  _renderPlot(): void;
  _updateSizeAndRender(): void;
  pickInteractivePointAt(x: number, y: number): { id: string } | null;
};

const XS = [1, 4, 6, 9];
const YS = [2, 8, 3, 7];

function makeData(xs = XS): VisualizationData {
  const coords = new Float32Array(xs.flatMap((x, i) => [x, YS[i]]));
  return {
    protein_ids: xs.map((_, i) => `p${i}`),
    projections: [{ name: 'umap', dimension: 2, data: coords }],
    annotations: {
      fam: { kind: 'categorical', values: ['A'], colors: ['#f00'], shapes: ['circle'] },
    },
    annotation_data: { fam: new Int32Array(xs.length) },
  } as unknown as VisualizationData;
}

let frames: FrameRequestCallback[];
const runFrame = () => {
  const queued = frames;
  frames = [];
  queued.forEach((cb) => cb(performance.now()));
};

function sizeTo(el: HTMLElement, width: number, height: number) {
  Object.defineProperty(el, 'clientWidth', { configurable: true, get: () => width });
  Object.defineProperty(el, 'clientHeight', { configurable: true, get: () => height });
}

/** An unattached 800x600 plot with data, a staged render and a built point index. */
function makePlot() {
  const el = document.createElement('protspace-scatterplot') as Internals;
  el.data = makeData();
  el.selectedAnnotation = 'fam';
  el._processData();
  const { canvas } = createMockCanvas();
  Object.defineProperty(el, '_canvas', { configurable: true, get: () => canvas });
  sizeTo(el, 800, 600);
  el._updateSizeAndRender();
  el._buildPointGridIndex();
  runFrame();
  const populate = vi.spyOn(el._webglRenderer!, 'populateBuffers');
  const rebuild = vi.spyOn(el, '_buildPointGridIndex');
  return { el, populate, rebuild };
}

beforeEach(() => {
  frames = [];
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => frames.push(cb));
  vi.stubGlobal('cancelAnimationFrame', (id: number) => {
    frames[id - 1] = () => {};
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('scatter-plot resize', () => {
  it('redraws on the spot without re-staging', () => {
    const { el, populate, rebuild } = makePlot();
    const render = vi.spyOn(el, '_renderPlot');

    for (const [w, h] of [
      [1200, 700],
      [640, 900],
      [1440, 900],
    ]) {
      sizeTo(el, w, h);
      el._updateSizeAndRender();
      runFrame();
    }

    expect(render).toHaveBeenCalledTimes(3);
    expect(populate).not.toHaveBeenCalled();
    expect(rebuild).toHaveBeenCalledTimes(3);
  });

  it('picks each point at its new position once the index is rebuilt', () => {
    const { el } = makePlot();
    const before = el._scales!;
    sizeTo(el, 1440, 500);
    el._updateSizeAndRender();
    runFrame();
    const after = el._scales!;

    XS.forEach((x, i) => {
      expect(el.pickInteractivePointAt(after.x(x), after.y(YS[i]))?.id).toBe(`p${i}`);
    });
    // The old positions are empty now: p1 moved from (290, 136) to (542, 100).
    expect(el.pickInteractivePointAt(before.x(XS[1]), before.y(YS[1]))).toBeNull();
  });
});
