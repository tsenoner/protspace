/**
 * @vitest-environment jsdom
 *
 * The host side of the projection glide: which geometry changes ask the renderer
 * to glide, how the frames are driven, and what pauses meanwhile. A projection or
 * plane switch that keeps every point in its slot glides; any other geometry
 * change ends a glide at once. The glide's frames ride the coalesced render
 * request, one render per frame, and stop when it ends.
 *
 * As in scatter-plot.render-coalescing.test.ts the element is never appended: a
 * real WebGLRenderer on the mock WebGL2 canvas is attached by hand, and updated()
 * is called with the properties a Lit update would have reported.
 */
import { vi, describe, it, expect, beforeEach, afterEach, type MockInstance } from 'vitest';
import type { VisualizationData } from '@protspace/utils';
import { MORPH_MS, drawnPositions, morphWeight } from './webgl/renderer/position-morph';
import type * as PositionMorph from './webgl/renderer/position-morph';
import type * as PerfCounters from '../../utils/perf-counters';

const clock = vi.hoisted(() => ({ now: 1000 }));

vi.mock('./webgl/renderer/position-morph', async (importOriginal) => {
  const actual = await importOriginal<typeof PositionMorph>();
  return { ...actual, frameTime: () => clock.now, drawnPositions: vi.fn(actual.drawnPositions) };
});
vi.mock('../../utils/perf-counters', async (importOriginal) => {
  const actual = await importOriginal<typeof PerfCounters>();
  return { ...actual, perfCounters: actual.createPerfCounters() };
});

import { perfCounters } from '../../utils/perf-counters';
import { fakeFrames, mountPlot, type PlotInternals } from './test-support/plot-fixture';

const counters = perfCounters!;

type Inputs = Pick<
  PlotInternals,
  'data' | 'selectedProjectionIndex' | 'projectionPlane' | 'filteredProteinIds' | 'filtersActive'
>;

// p3 has no coordinates in 'gap'. 'pca3' is 3D, for the plane switch.
const PROJECTIONS = [
  { name: 'umap', dimension: 2, data: [0, 0, 1, 1, 2, 2, 3, 3] },
  { name: 'pca', dimension: 2, data: [3, 0, 2, 1, 1, 2, 0, 3] },
  { name: 'pca3', dimension: 3, data: [0, 0, 1, 1, 1, 0, 2, 2, 3, 3, 3, 2] },
  { name: 'gap', dimension: 2, data: [0, 1, 1, 0, 2, 3, NaN, NaN] },
];

function makeData(shift = 0): VisualizationData {
  return {
    protein_ids: ['p0', 'p1', 'p2', 'p3'],
    projections: PROJECTIONS.map((p) => ({
      ...p,
      data: new Float32Array(p.data.map((v) => v + shift)),
    })),
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

/** An unattached plot with data, a real renderer, and one render already drawn. */
function makePlot(inputs: Partial<Inputs> = {}) {
  const el = mountPlot({ data: makeData(), selectedAnnotation: 'fam', ...inputs });
  const renderer = el._webglRenderer!;
  frames.clear();
  const render = vi.spyOn(renderer, 'render');
  const request = vi.spyOn(renderer, 'morphNextPositionChange');
  return { el, renderer, render, request };
}

/** Set geometry inputs and run updated() with what a Lit update would report. */
function change(el: PlotInternals, inputs: Partial<Inputs>) {
  const changed = new Map<string, unknown>();
  for (const key of Object.keys(inputs) as (keyof Inputs)[]) changed.set(key, el[key]);
  Object.assign(el, inputs);
  el.updated(changed);
}

/** Run frames 16 ms apart until none is queued; returns the renders each one drew. */
function runFrames(render: MockInstance, beforeEachFrame?: () => void): number[] {
  const perFrame: number[] = [];
  while (frames.size > 0) {
    if (perFrame.length > 2 * (MORPH_MS / 16)) throw new Error('frames never stop');
    beforeEachFrame?.();
    clock.now += 16;
    const before = render.mock.calls.length;
    frames.run();
    perFrame.push(render.mock.calls.length - before);
  }
  return perFrame;
}

// The switch render draws the glide's start, then one frame per 16 ms until MORPH_MS.
const GLIDE_RENDERS = MORPH_MS / 16 + 1;

beforeEach(() => {
  frames = fakeFrames();
  counters.morphFrame = 0;
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('projection glide (host)', () => {
  it('a projection switch requests once after the invalidations, then renders once per frame until done', () => {
    const { el, renderer, render, request } = makePlot();
    const invalidate = vi.spyOn(renderer, 'invalidatePositionCache');

    change(el, { selectedProjectionIndex: 1 });
    expect(request).toHaveBeenCalledTimes(1);
    expect(request.mock.invocationCallOrder[0]).toBeGreaterThan(
      invalidate.mock.invocationCallOrder[0],
    );
    expect(el.hasAttribute('data-morphing')).toBe(true);

    // Other render requests during the glide share its frames.
    const perFrame = runFrames(render, () => {
      if (!renderer.isMorphing) return;
      el._renderLoop.request();
      el._renderLoop.request();
    });
    expect(perFrame).toEqual(Array(GLIDE_RENDERS).fill(1));
    expect(counters.morphFrame).toBe(GLIDE_RENDERS - 1);
    expect(renderer.isMorphing).toBe(false);
    expect(el.hasAttribute('data-morphing')).toBe(false);
  });

  it('a plane switch glides', () => {
    const { el, renderer, render, request } = makePlot({ selectedProjectionIndex: 2 });

    change(el, { projectionPlane: 'xz' });
    expect(request).toHaveBeenCalledTimes(1);
    frames.run();
    expect(renderer.isMorphing).toBe(true);
    expect(runFrames(render)).toHaveLength(GLIDE_RENDERS - 1);
  });

  it('a data, filter or isolation change never glides', () => {
    const { el, renderer, render, request } = makePlot();

    change(el, { data: makeData(1) });
    expect(runFrames(render)).toEqual([1]);
    change(el, { filteredProteinIds: ['p0', 'p1', 'p3'], filtersActive: true });
    expect(runFrames(render)).toEqual([1]);
    change(el, { selectedProjectionIndex: 1, filteredProteinIds: ['p0', 'p1'] });
    expect(runFrames(render)).toEqual([1]);
    el.selectedProteinIds = ['p0'];
    el.isolateSelection();
    el._renderLoop.request();
    expect(runFrames(render)).toEqual([1]);

    expect(request).not.toHaveBeenCalled();
    expect(renderer.isMorphing).toBe(false);
    expect(counters.morphFrame).toBe(0);
  });

  it('an isolation mid-glide ends it on the next frame', () => {
    const { el, renderer, render } = makePlot();
    change(el, { selectedProjectionIndex: 1 });
    frames.run();
    frames.run();

    el.selectedProteinIds = ['p0', 'p1'];
    el.isolateSelection();
    expect(runFrames(render)).toEqual([1]);
    expect(renderer.isMorphing).toBe(false);
    expect(el.hasAttribute('data-morphing')).toBe(false);
  });

  it('a filtered switch glides only while every point keeps its slot', () => {
    const { el, request } = makePlot({
      filteredProteinIds: ['p0', 'p1', 'p3'],
      filtersActive: true,
    });
    const slots = el._plotData.originalIndices;

    // The rebuild makes a new, equal index map.
    change(el, { selectedProjectionIndex: 1 });
    expect(el._plotData.originalIndices).not.toBe(slots);
    expect(request).toHaveBeenCalledTimes(1);

    // 'gap' has no coordinates for p3, so the rebuild culls it.
    change(el, { selectedProjectionIndex: 3 });
    expect(request).toHaveBeenCalledTimes(1);
    expect(el.hasAttribute('data-morphing')).toBe(false);
  });

  it('switches instantly under reduced motion, and without requestAnimationFrame', () => {
    const { el, renderer, render, request } = makePlot();
    vi.stubGlobal('matchMedia', (query: string) => ({ matches: query.includes('reduce') }));

    change(el, { selectedProjectionIndex: 1 });
    expect(runFrames(render)).toEqual([1]);

    // request() renders on the spot then; a glide would recurse through it.
    vi.stubGlobal('requestAnimationFrame', undefined);
    vi.spyOn(el._pointGrid, 'scheduleRebuild').mockImplementation(() => {});
    vi.stubGlobal('matchMedia', undefined);
    change(el, { selectedProjectionIndex: 0 });
    expect(render).toHaveBeenCalledTimes(2);

    expect(request).not.toHaveBeenCalled();
    expect(renderer.isMorphing).toBe(false);
    expect(el.hasAttribute('data-morphing')).toBe(false);
  });

  it('a second switch mid-glide restarts it from the drawn blend', () => {
    const { el, render, request } = makePlot();
    change(el, { selectedProjectionIndex: 1 });
    frames.run();
    for (let i = 0; i < 10; i++) {
      clock.now += 16;
      frames.run();
    }
    vi.mocked(drawnPositions).mockClear();

    change(el, { selectedProjectionIndex: 0 });
    expect(request).toHaveBeenCalledTimes(2);
    expect(runFrames(render)).toHaveLength(GLIDE_RENDERS);
    const [, from, weight] = vi.mocked(drawnPositions).mock.calls[0];
    expect(from).toBeInstanceOf(Float32Array);
    expect(weight).toBe(morphWeight(160));
  });

  it('a dataset swap mid-glide ends it at once, even at the same point count', () => {
    const { el, renderer, render, request } = makePlot();
    change(el, { selectedProjectionIndex: 1 });
    frames.run();
    frames.run();
    vi.mocked(drawnPositions).mockClear();
    const glideFrames = counters.morphFrame;

    change(el, { data: makeData(1) });
    expect(renderer.isMorphing).toBe(false);
    expect(el.hasAttribute('data-morphing')).toBe(false);
    // A switch before the swap is drawn has no drawn positions of this dataset to start from.
    change(el, { selectedProjectionIndex: 0 });
    expect(request).toHaveBeenCalledTimes(1);

    expect(runFrames(render)).toEqual([1]);
    expect(drawnPositions).not.toHaveBeenCalled();
    expect(counters.morphFrame).toBe(glideFrames);
  });

  it('disconnecting mid-glide drops data-morphing and stops the frames', () => {
    const { el, render } = makePlot();
    change(el, { selectedProjectionIndex: 1 });
    frames.run();

    el.disconnectedCallback();
    expect(el.hasAttribute('data-morphing')).toBe(false);
    expect(runFrames(render)).not.toContain(1);
  });

  it('pauses hover while the points glide', () => {
    const { el, render } = makePlot();
    el._hoveredProteinId = 'p1';
    const hovers: unknown[] = [];
    el.addEventListener('protein-hover', (e) => hovers.push((e as CustomEvent).detail.proteinId));

    change(el, { selectedProjectionIndex: 1 });
    expect(hovers).toEqual([null]);
    frames.run();
    el._handleCanvasMouseMove(new MouseEvent('mousemove'));
    expect(el._pendingHover).toBeNull();
    expect(el._hoverRaf).toBeNull();

    runFrames(render);
    el._handleCanvasMouseMove(new MouseEvent('mousemove'));
    expect(el._hoverRaf).not.toBeNull();
  });
});
