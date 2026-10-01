/**
 * @vitest-environment jsdom
 *
 * Render coalescing: every render request made before the next frame shares one
 * render, and that render stages the union of what the requests invalidated.
 * An annotation switch used to re-stage four times (plot.updated, the legend's
 * z-order and colour events, plot.updated again); at 573K points each re-stage
 * is ~460 ms.
 *
 * The element is never appended, so Lit's lifecycle never runs. A real
 * WebGLRenderer on the mock WebGL2 canvas is attached by hand, which is what
 * makes `populateBuffers` the observable: it runs once per re-stage and takes
 * the merged (updatePositions, updateStyles) flags as arguments.
 */
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { PlotData, VisualizationData } from '@protspace/utils';
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

type Renderer = {
  invalidatePositionCache(): void;
  renderToCanvas(...a: unknown[]): HTMLCanvasElement;
  populateBuffers(pd: PlotData, scales: unknown, positions: boolean, styles: boolean): void;
};

type Internals = HTMLElement & {
  data: VisualizationData;
  selectedAnnotation: string;
  _plotData: PlotData;
  _webglRenderer: Renderer | null;
  _processData(): void;
  _createWebglRenderer(): void;
  _requestRender(): void;
  _flushRender(): void;
  _renderPlot(): void;
  _handleZOrderChange(event: Event): void;
  _handleColorMappingChange(event: Event): void;
  captureAtResolution(width: number, height: number): HTMLCanvasElement;
  getDataExtent(): { xMin: number; xMax: number; yMin: number; yMax: number } | null;
};

function makeData(): VisualizationData {
  return {
    protein_ids: ['p0', 'p1', 'p2', 'p3'],
    projections: [{ name: 'umap', dimension: 2, data: new Float32Array([0, 0, 1, 1, 2, 2, 3, 3]) }],
    annotations: {
      fam: {
        kind: 'categorical',
        values: ['A', 'B'],
        colors: ['#f00', '#0f0'],
        shapes: ['circle', 'square'],
      },
    },
    annotation_data: { fam: new Int32Array([0, 1, 0, 1]) },
  } as unknown as VisualizationData;
}

let frames: FrameRequestCallback[];
const runFrame = () => {
  const queued = frames;
  frames = [];
  queued.forEach((cb) => cb(performance.now()));
};

/** An unattached plot with data, a real renderer, and one render already staged. */
function makePlot() {
  const el = document.createElement('protspace-scatterplot') as Internals;
  el.data = makeData();
  el.selectedAnnotation = 'fam';
  el._processData();
  const { canvas } = createMockCanvas();
  Object.defineProperty(el, '_canvas', { configurable: true, get: () => canvas });
  el._createWebglRenderer();
  const renderer = el._webglRenderer!;
  const populate = vi.spyOn(renderer, 'populateBuffers');
  el._requestRender();
  el._flushRender();
  populate.mockClear();
  return { el, renderer, populate };
}

const zOrder = (m: Record<string, number>) =>
  new CustomEvent('legend-zorder-change', { detail: { zOrderMapping: m } });
const colors = (colorOnly: boolean) =>
  new CustomEvent('legend-colormapping-change', {
    detail: {
      colorMapping: { A: '#111111', B: '#222222' },
      shapeMapping: { A: 'circle', B: 'circle' },
      colorOnly,
    },
  });

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

describe('render coalescing', () => {
  it('requests made before a frame re-stage once, on that frame', () => {
    const { el, populate } = makePlot();

    el._handleZOrderChange(zOrder({ A: 1, B: 0 }));
    el._handleColorMappingChange(colors(false));
    el._requestRender();
    expect(populate).not.toHaveBeenCalled();

    runFrame();
    expect(populate).toHaveBeenCalledTimes(1);

    runFrame();
    expect(populate).toHaveBeenCalledTimes(1);
  });

  it('the one re-stage carries the union of the requests’ invalidations', () => {
    const { el, renderer, populate } = makePlot();

    // Alone, each is a partial re-stage: positions only, then styles only.
    renderer.invalidatePositionCache();
    el._requestRender();
    el._handleColorMappingChange(colors(true));

    runFrame();
    expect(populate).toHaveBeenCalledTimes(1);
    const [, , positions, styles] = populate.mock.calls[0];
    expect([positions, styles]).toEqual([true, true]);
  });

  it('a flush renders a waiting request now, and the frame then finds nothing to do', () => {
    const { el, populate } = makePlot();

    el._handleColorMappingChange(colors(false));
    el._flushRender();
    expect(populate).toHaveBeenCalledTimes(1);

    runFrame();
    expect(populate).toHaveBeenCalledTimes(1);
  });

  it('a legend mapping equal to the current one does not re-stage', () => {
    const { el, populate } = makePlot();
    el._handleZOrderChange(zOrder({ A: 1, B: 0 }));
    el._handleColorMappingChange(colors(false));
    runFrame();
    populate.mockClear();

    // A legend rebuild re-sends the same maps as new objects.
    el._handleZOrderChange(zOrder({ B: 0, A: 1 }));
    el._handleColorMappingChange(colors(false));
    runFrame();
    expect(populate).not.toHaveBeenCalled();

    el._handleZOrderChange(zOrder({ A: 0, B: 1 }));
    runFrame();
    expect(populate).toHaveBeenCalledTimes(1);
  });

  it('a colour-only change restyles the categories on the next frame, without a re-stage', () => {
    const { el, renderer, populate } = makePlot();
    const render = vi.spyOn(renderer as unknown as { render(pd: PlotData): void }, 'render');
    el._handleColorMappingChange(colors(true));
    runFrame();
    expect(render).toHaveBeenCalledTimes(1);
    expect(populate).not.toHaveBeenCalled();
  });

  it('a flush with nothing requested does not render', () => {
    const { el } = makePlot();
    const render = vi.spyOn(el, '_renderPlot');
    el._flushRender();
    expect(render).not.toHaveBeenCalled();
  });

  it('without requestAnimationFrame a request renders immediately', () => {
    const { el, populate } = makePlot();
    vi.stubGlobal('requestAnimationFrame', undefined);

    el._handleColorMappingChange(colors(false));
    expect(populate).toHaveBeenCalledTimes(1);
  });

  it('export and the data extent see a render that was only requested', () => {
    const { el, renderer, populate } = makePlot();
    const order: string[] = [];
    populate.mockImplementation(() => order.push('stage'));
    vi.spyOn(renderer, 'renderToCanvas').mockImplementation(() => {
      order.push('export');
      return document.createElement('canvas');
    });

    el._handleColorMappingChange(colors(false));
    el.captureAtResolution(100, 100);
    expect(order).toEqual(['stage', 'export']);

    renderer.invalidatePositionCache();
    el._requestRender();
    expect(el.getDataExtent()).not.toBeNull();
    expect(order).toEqual(['stage', 'export', 'stage']);
  });
});
