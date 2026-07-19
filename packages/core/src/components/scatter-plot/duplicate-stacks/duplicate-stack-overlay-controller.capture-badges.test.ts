/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach, afterEach, type MockInstance } from 'vitest';
import * as d3 from 'd3';
import { DuplicateStackOverlayController } from './duplicate-stack-overlay-controller';
import { DuplicateBadgesCanvasRenderer } from './duplicate-badges-canvas-renderer';
import { QuadtreeIndex } from '../interaction/quadtree-index';
import { makePD, tenPointPD } from './test-support/plot-data-fixtures';
import type { PlotData } from '@protspace/utils';
import type { BadgeCaptureProjection } from './duplicate-stack-types';

/**
 * #301/#302: captureBadges renders badges for the WHOLE extent (lazily-cached
 * full-extent stack set, independent of the last live viewport) at the
 * caller's output geometry/projection. The #294 null contract is preserved:
 * disabled or nothing-to-render → null, so captureAtResolution skips
 * compositing rather than pasting a blank canvas.
 */

/** Identity-ish live scales: data [0,100] → base pixels [0,100]. */
function liveScales() {
  return {
    x: d3.scaleLinear().domain([0, 100]).range([0, 100]),
    y: d3.scaleLinear().domain([0, 100]).range([0, 100]),
  };
}

function makeFixture(
  opts: { isEnabled?: boolean; pd?: PlotData; visibleSlots?: number[] | null } = {},
) {
  const pd = opts.pd ?? tenPointPD();
  const visibleSlots =
    opts.visibleSlots === undefined
      ? Array.from({ length: pd.length }, (_, i) => i)
      : opts.visibleSlots;
  const scales = liveScales();
  const quadtree = new QuadtreeIndex();
  quadtree.setScales(scales);
  if (visibleSlots) quadtree.rebuild(pd, visibleSlots);
  const config = {
    width: 800,
    height: 600,
    margin: { top: 20, right: 20, bottom: 20, left: 20 },
  };
  const deps = {
    getOverlayGroup: () => null,
    getBadgesCanvas: () => undefined,
    getTransform: () => d3.zoomIdentity,
    getConfig: () => config,
    getScales: () => scales,
    getPlotData: () => pd,
    getQuadtree: () => quadtree,
    getVisibleSlots: vi.fn(() => visibleSlots),
    isEnabled: () => opts.isEnabled ?? true,
    isSelectionMode: () => false,
    getColor: () => '#000000',
    onPointActivate: () => {},
    onHover: () => {},
    onHoverEnd: () => {},
  };
  const controller = new DuplicateStackOverlayController(
    deps as unknown as ConstructorParameters<typeof DuplicateStackOverlayController>[0],
  );
  return { controller, deps };
}

/** Export projection: data [0,100] → a 1600×400 output (aspect ≠ live 800×600). */
function exportProjection(overrides: Partial<BadgeCaptureProjection> = {}): BadgeCaptureProjection {
  return {
    scales: {
      x: (dataX: number) => (dataX / 100) * 1600,
      y: (dataY: number) => (dataY / 100) * 400,
    },
    width: 1600,
    height: 400,
    badgeScale: 1,
    ...overrides,
  };
}

/** Stack keys handed to renderExport on the most recent captureBadges call. */
function renderedKeys(spy: MockInstance): string[] {
  // renderExport(canvas, stacks, badgeScale, expandedKey) — stacks is arg 1.
  const stacks = spy.mock.calls[spy.mock.calls.length - 1][1] as Array<{ key: string }>;
  return stacks.map((s) => s.key).sort();
}

describe('captureBadges — null contract (#294, preserved)', () => {
  it('returns null when the overlay is disabled', () => {
    const { controller } = makeFixture({ isEnabled: false });
    expect(controller.captureBadges(exportProjection())).toBeNull();
  });

  it('returns null when no visible-slot list exists yet', () => {
    const { controller } = makeFixture({ visibleSlots: null });
    expect(controller.captureBadges(exportProjection())).toBeNull();
  });

  it('returns null when the data has no duplicates', () => {
    const { controller } = makeFixture({ pd: makePD([1, 2, 3], [1, 2, 3]) });
    expect(controller.captureBadges(exportProjection())).toBeNull();
  });
});

describe('captureBadges — full-extent coverage (#301)', () => {
  let renderExportSpy: MockInstance;
  let rafQueue: FrameRequestCallback[];
  beforeEach(() => {
    renderExportSpy = vi.spyOn(DuplicateBadgesCanvasRenderer, 'renderExport');
    rafQueue = [];
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
      rafQueue.push(cb);
      return rafQueue.length;
    });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });
  const drain = () => {
    const q = rafQueue;
    rafQueue = [];
    q.forEach((cb) => cb(0));
  };

  it('includes stacks OUTSIDE the last zoomed live viewport (the #301 repro)', () => {
    const { controller } = makeFixture();
    // Reproduce the bug precondition: the live overlay computed stacks for a
    // zoomed-in window covering only stack A at base px (0,0). Same TS-private
    // runtime-reachable technique as scatter-plot.duplicate-stack-compute.test.ts.
    const priv = controller as unknown as {
      ensureForViewport(k: string, a: number, b: number, c: number, d: number): boolean;
      stacks: unknown[];
    };
    priv.ensureForViewport('zoomed-view', -10, -10, 10, 10);
    drain();
    expect(priv.stacks).toHaveLength(1); // live set really is viewport-scoped

    const canvas = controller.captureBadges(exportProjection());
    expect(canvas).not.toBeNull();
    // Before the fix this rendered only ['0|0'] (culled from this.stacks).
    expect(renderedKeys(renderExportSpy)).toEqual(['0|0', '50|50', '90|90']);
  });

  it('no-zoom equivalence: capture renders the same 3 stacks without any live compute', () => {
    const { controller } = makeFixture();
    expect(controller.captureBadges(exportProjection())).not.toBeNull();
    expect(renderedKeys(renderExportSpy)).toEqual(['0|0', '50|50', '90|90']);
  });

  it('respects legend/filter visibility via the host-provided slot list', () => {
    // Hide one member of B (slot 4) and all of C (slots 5-6).
    const { controller } = makeFixture({ visibleSlots: [0, 1, 2, 3, 7, 8, 9] });
    controller.captureBadges(exportProjection());
    expect(renderedKeys(renderExportSpy)).toEqual(['0|0', '50|50']);
    const stacks = renderExportSpy.mock.calls[0][1] as Array<{
      key: string;
      points: unknown[];
    }>;
    expect(stacks.find((s) => s.key === '50|50')!.points).toHaveLength(2);
  });
});

describe('captureBadges — output geometry (#302)', () => {
  afterEach(() => vi.restoreAllMocks());

  it('sizes the canvas to the output physical dims and projects px/py through the export scales', () => {
    const spy = vi.spyOn(DuplicateBadgesCanvasRenderer, 'renderExport');
    const { controller } = makeFixture();
    const proj = exportProjection();
    const canvas = controller.captureBadges(proj)!;
    expect(canvas.width).toBe(1600);
    expect(canvas.height).toBe(400);
    const stacks = spy.mock.calls[0][1] as Array<{ key: string; px: number; py: number }>;
    const b = stacks.find((s) => s.key === '50|50')!;
    expect(b.px).toBeCloseTo(proj.scales.x(50)); // 800
    expect(b.py).toBeCloseTo(proj.scales.y(50)); // 200
  });

  it('forwards badgeScale to the export draw routine', () => {
    const spy = vi.spyOn(DuplicateBadgesCanvasRenderer, 'renderExport');
    const { controller } = makeFixture();
    controller.captureBadges(exportProjection({ badgeScale: 1.5 }));
    expect(spy.mock.calls[0][2]).toBe(1.5);
  });
});

describe('captureBadges — full-extent cache + invalidation (#301)', () => {
  it('computes once, serves later captures from the cache, and recomputes after resetState()', () => {
    const { controller, deps } = makeFixture();
    controller.captureBadges(exportProjection());
    controller.captureBadges(exportProjection());
    expect(deps.getVisibleSlots).toHaveBeenCalledTimes(1); // 2nd capture = cache hit
    controller.resetState();
    controller.captureBadges(exportProjection());
    expect(deps.getVisibleSlots).toHaveBeenCalledTimes(2);
  });

  it('resetCacheKey() ALONE clears the capture cache (the enableDuplicateStackUI toggle path)', () => {
    const { controller, deps } = makeFixture();
    controller.captureBadges(exportProjection());
    expect(deps.getVisibleSlots).toHaveBeenCalledTimes(1);
    controller.resetCacheKey(); // scatter-plot.ts:699 fires ONLY this on toggle
    controller.captureBadges(exportProjection());
    expect(deps.getVisibleSlots).toHaveBeenCalledTimes(2);
  });
});
