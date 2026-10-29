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
 * WebGLRenderer on the mock WebGL2 canvas is attached by hand, and the perf
 * counters are the observable: `restage` counts the re-stages, `restagePos`
 * and `restageStyle` the ones that rewrote positions and styles.
 */
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { VisualizationData } from '@protspace/utils';
import type * as PerfCounters from '../../utils/perf-counters';

vi.mock('../../utils/perf-counters', async (importOriginal) => {
  const actual = await importOriginal<typeof PerfCounters>();
  return { ...actual, perfCounters: actual.createPerfCounters() };
});

import { createPerfCounters, perfCounters } from '../../utils/perf-counters';
import { fakeFrames, mountPlot } from './test-support/plot-fixture';

const counters = perfCounters!;
const resetCounters = () => Object.assign(counters, createPerfCounters());

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

let frames: ReturnType<typeof fakeFrames>;

/** An unattached plot with data, a real renderer, and one render already staged. */
function makePlot() {
  const el = mountPlot({ data: makeData(), selectedAnnotation: 'fam' });
  resetCounters();
  return { el, renderer: el._webglRenderer! };
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
  frames = fakeFrames();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('render coalescing', () => {
  it('requests made before a frame re-stage once, on that frame', () => {
    const { el } = makePlot();

    el._handleZOrderChange(zOrder({ A: 1, B: 0 }));
    el._handleColorMappingChange(colors(false));
    el._renderLoop.request();
    expect(counters.restage).toBe(0);

    frames.run();
    expect(counters.restage).toBe(1);

    frames.run();
    expect(counters.restage).toBe(1);
  });

  it('requests made before a frame queue that one frame between them', () => {
    const { el, renderer } = makePlot();
    const render = vi.spyOn(renderer, 'render');

    el._handleZOrderChange(zOrder({ A: 1, B: 0 }));
    el._handleColorMappingChange(colors(false));
    el._renderLoop.request();
    expect(frames.size).toBe(1);

    frames.run();
    expect(render).toHaveBeenCalledTimes(1);
    expect(frames.size).toBe(0);
  });

  it('the one re-stage carries the union of the requests’ invalidations', () => {
    const { el, renderer } = makePlot();

    // Alone, each is a partial re-stage: positions only, then styles only.
    renderer.invalidatePositionCache();
    el._renderLoop.request();
    el._handleColorMappingChange(colors(true));

    frames.run();
    expect([counters.restage, counters.restagePos, counters.restageStyle]).toEqual([1, 1, 1]);
  });

  it('a flush renders a waiting request now, and the frame then finds nothing to do', () => {
    const { el } = makePlot();

    el._handleColorMappingChange(colors(false));
    el._renderLoop.flush();
    expect(counters.restage).toBe(1);

    frames.run();
    expect(counters.restage).toBe(1);
  });

  it('a legend mapping equal to the current one does not re-stage', () => {
    const { el } = makePlot();
    el._handleZOrderChange(zOrder({ A: 1, B: 0 }));
    el._handleColorMappingChange(colors(false));
    frames.run();
    resetCounters();

    // A legend rebuild re-sends the same maps as new objects.
    el._handleZOrderChange(zOrder({ B: 0, A: 1 }));
    el._handleColorMappingChange(colors(false));
    frames.run();
    expect(counters.restage).toBe(0);

    el._handleZOrderChange(zOrder({ A: 0, B: 1 }));
    frames.run();
    expect(counters.restage).toBe(1);
  });

  it('a colour-only change restyles the categories on the next frame, without a re-stage', () => {
    const { el, renderer } = makePlot();
    const render = vi.spyOn(renderer, 'render');
    el._handleColorMappingChange(colors(true));
    frames.run();
    expect(render).toHaveBeenCalledTimes(1);
    expect(counters.restage).toBe(0);
  });

  it('a selection change in an update with other keys updates the overlays once', () => {
    const { el, renderer } = makePlot();
    const render = vi.spyOn(renderer, 'render');
    const overlays = vi.spyOn(el, '_updateSelectionOverlays');

    el.selectedProteinIds = ['p0'];
    el._reconcileSelectionOverlays(
      new Map<string, unknown>([
        ['selectedProteinIds', []],
        ['hiddenAnnotationValues', []],
      ]),
    );
    frames.run();
    expect(overlays).toHaveBeenCalledTimes(1);
    expect(render).toHaveBeenCalledTimes(1);
  });

  it('a flush with nothing requested does not render', () => {
    const { el } = makePlot();
    const render = vi.spyOn(el, '_renderPlot');
    el._renderLoop.flush();
    expect(render).not.toHaveBeenCalled();
  });

  it('without requestAnimationFrame a request renders immediately', () => {
    const { el } = makePlot();
    vi.stubGlobal('requestAnimationFrame', undefined);

    el._handleColorMappingChange(colors(false));
    expect(counters.restage).toBe(1);
  });

  it('export and the data extent see a render that was only requested', () => {
    const { el, renderer } = makePlot();
    const stagedAtExport: number[] = [];
    vi.spyOn(renderer, 'renderToCanvas').mockImplementation(() => {
      stagedAtExport.push(counters.restage);
      return document.createElement('canvas');
    });

    el._handleColorMappingChange(colors(false));
    el.captureAtResolution(100, 100);
    expect(stagedAtExport).toEqual([1]);

    renderer.invalidatePositionCache();
    el._renderLoop.request();
    expect(el.getDataExtent()).not.toBeNull();
    expect(counters.restage).toBe(2);
  });
});
