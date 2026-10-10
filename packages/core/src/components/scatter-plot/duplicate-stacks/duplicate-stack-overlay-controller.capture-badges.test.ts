/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach, afterEach, type MockInstance } from 'vitest';
import { DuplicateBadgesCanvasRenderer } from './duplicate-badges-canvas-renderer';
import { makePD } from './test-support/plot-data-fixtures';
import { makeControllerFixture } from './test-support/overlay-controller-fixture';
import type { BadgeCaptureProjection } from './duplicate-stack-types';

/**
 * #301/#302: captureBadges renders badges for the WHOLE extent (lazily-cached
 * full-extent stack set, independent of the last live viewport) at the
 * caller's output geometry/projection. The #294 null contract is preserved:
 * disabled or nothing-to-render → null, so captureAtResolution skips
 * compositing rather than pasting a blank canvas.
 */

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
    const { controller } = makeControllerFixture({ isEnabled: () => false });
    expect(controller.captureBadges(exportProjection())).toBeNull();
  });

  it('returns null when no visible-slot list exists yet', () => {
    const { controller } = makeControllerFixture({ visibleSlots: null });
    expect(controller.captureBadges(exportProjection())).toBeNull();
  });

  it('returns null when the data has no duplicates', () => {
    const { controller } = makeControllerFixture({ pd: makePD([1, 2, 3], [1, 2, 3]) });
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
    const { controller } = makeControllerFixture();
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
    const { controller } = makeControllerFixture();
    expect(controller.captureBadges(exportProjection())).not.toBeNull();
    expect(renderedKeys(renderExportSpy)).toEqual(['0|0', '50|50', '90|90']);
  });

  it('respects legend/filter visibility via the host-provided slot list', () => {
    // Hide one member of B (slot 4) and all of C (slots 5-6).
    const { controller } = makeControllerFixture({ visibleSlots: [0, 1, 2, 3, 7, 8, 9] });
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
    const { controller } = makeControllerFixture();
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
    const { controller } = makeControllerFixture();
    controller.captureBadges(exportProjection({ badgeScale: 1.5 }));
    expect(spy.mock.calls[0][2]).toBe(1.5);
  });
});

describe('captureBadges — full-extent cache + invalidation (#301)', () => {
  it('computes once, serves later captures from the cache, and recomputes after resetState()', () => {
    const { controller, deps } = makeControllerFixture();
    controller.captureBadges(exportProjection());
    controller.captureBadges(exportProjection());
    expect(deps.getVisibleSlots).toHaveBeenCalledTimes(1); // 2nd capture = cache hit
    controller.resetState();
    controller.captureBadges(exportProjection());
    expect(deps.getVisibleSlots).toHaveBeenCalledTimes(2);
  });

  it('resetCacheKey() ALONE clears the capture cache (the enableDuplicateStackUI toggle path)', () => {
    const { controller, deps } = makeControllerFixture();
    controller.captureBadges(exportProjection());
    expect(deps.getVisibleSlots).toHaveBeenCalledTimes(1);
    controller.resetCacheKey(); // the host's _reconcileConfigMerge fires this on toggle
    controller.captureBadges(exportProjection());
    expect(deps.getVisibleSlots).toHaveBeenCalledTimes(2);
  });
});
