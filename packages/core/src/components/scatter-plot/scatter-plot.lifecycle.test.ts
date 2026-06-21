/**
 * @vitest-environment jsdom
 *
 * B2 lifecycle hardening (scatter-plot-part2 audit). These tests pin the
 * post-disconnect / post-context-loss behaviour of the host's lifecycle paths.
 * Every assertion targets a DETACHED node or a null-renderer state; the
 * connected render / zoom / selection / numeric flow is untouched and stays
 * byte-identical (INV-03 / INV-05: we only SUPPRESS spurious dispatches from a
 * detached node, never alter a dispatch the user observes while connected).
 *
 * Construct the element via createElement WITHOUT appending it (so isConnected
 * stays false and Lit's connectedCallback / WebGL init never auto-run — same
 * approach as scatter-plot.test.ts / scatter-plot.isolation.test.ts). We drive
 * the private lifecycle methods directly.
 *
 * Findings:
 *   - F-35 + F-11: firstUpdated constructs EXACTLY ONE WebGLRenderer and never
 *     orphans one (currently RED — firstUpdated double-constructs via
 *     _updateSizeAndRender then again inline).
 *   - F-05: a numeric recompute does not complete after disconnect — the busy
 *     state is cleared and a superseded RAF body bails (ALREADY SATISFIED by
 *     B6/F-04 NumericRecomputeRunner.cancel(); this is a characterization lock).
 *     (F-46 removed the old `numeric-recompute-end` event; re-characterized via
 *     the kept `_numericRecomputeRunning` mirror.)
 *   - F-12: the 750ms resetZoom transition is interrupted on disconnect
 *     (ALREADY SATISFIED by B8 PlotInteractionController.teardown(); this is a
 *     characterization lock asserted via the controller teardown path).
 *   - F-16: a selection committed then disconnected before its deferred RAF
 *     fires dispatches nothing — disconnectedCallback cancels the tracked
 *     _commitSelectionRafId (currently RED — the RAF id is not cancelled). The
 *     suppression is via cancellation, NOT an isConnected body-guard, so the
 *     connected dispatch (scatter-plot.test.ts B7 locks) stays byte-identical.
 *   - F-21: `_renderWebGL` is a no-op (does not throw) when `_webglRenderer` is
 *     null (currently RED — uses a non-null assertion).
 */
import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest';
import type { VisualizationData } from '@protspace/utils';

beforeAll(() => {
  if (!('ResizeObserver' in globalThis)) {
    (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    };
  }
});

// Count WebGLRenderer constructions without a real GL context. We preserve the
// real module's other exports (MAX_POINTS_DIRECT_RENDER) and replace only the
// renderer with an instrumented stub that records each construction + destroy.
// The class + registry live in vi.hoisted so the hoisted vi.mock factory can
// close over them (a top-level const would be a TDZ ReferenceError at mock time).
const { webglConstructions, FakeWebGLRenderer } = vi.hoisted(() => {
  const constructions: FakeWebGLRenderer[] = [];
  class FakeWebGLRenderer {
    destroyed = false;
    constructor(..._args: unknown[]) {
      constructions.push(this);
    }
    setStyleSignature() {}
    setSelectionActive() {}
    invalidatePositionCache() {}
    invalidateStyleCache() {}
    invalidateDepthOrder() {}
    setTrackRenderedPointIds() {}
    render() {}
    clear() {}
    resize() {}
    releaseDataReferences() {}
    destroy() {
      this.destroyed = true;
    }
  }
  return { webglConstructions: constructions, FakeWebGLRenderer };
});

vi.mock('./webgl', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return { ...actual, WebGLRenderer: FakeWebGLRenderer };
});

type FakeWebGLRenderer = InstanceType<typeof FakeWebGLRenderer>;

import './scatter-plot';

function makeFamilyData(): VisualizationData {
  const families = ['A', 'A', 'A', 'B', 'B', 'B'];
  const colorFor = (v: string) => (v === 'A' ? '#ff0000' : '#00ff00');
  const coords = new Float32Array(families.length * 2);
  families.forEach((_, i) => {
    coords[i * 2] = i;
    coords[i * 2 + 1] = i;
  });
  return {
    protein_ids: families.map((_, i) => `p${i}`),
    projections: [{ name: 'umap', data: coords, dimension: 2 }],
    annotations: {
      fam: {
        values: families,
        colors: families.map(colorFor),
        shapes: families.map(() => 'circle'),
      },
    },
    annotation_data: {
      fam: families.map((v) => [families.indexOf(v)]),
    },
    numeric_annotation_data: {
      score: families.map((_, i) => i),
    },
  } as unknown as VisualizationData;
}

type Host = HTMLElement & {
  data: VisualizationData;
  selectedAnnotation: string;
  selectedProteinIds: string[];
  _canvas?: HTMLCanvasElement;
  firstUpdated(): void;
  disconnectedCallback(): void;
  _scheduleNumericAnnotationRefresh(): void;
  _commitSelection(ids: string[], clearVisual: () => void): void;
  _renderWebGL(trigger?: string): void;
  _numericRecomputeRunning: boolean;
  _webglRenderer: FakeWebGLRenderer | null;
  _interaction: {
    teardown(): void;
    resetZoom(): void;
    initialize(): void;
  } | null;
};

function makeHost(): Host {
  const sp = document.createElement('protspace-scatterplot') as Host;
  sp.data = makeFamilyData();
  sp.selectedAnnotation = 'fam';
  return sp;
}

afterEach(() => {
  webglConstructions.length = 0;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('F-35 + F-11: firstUpdated constructs exactly one WebGLRenderer', () => {
  it('constructs exactly ONE WebGLRenderer and orphans none', () => {
    const sp = makeHost();
    // @query('canvas') resolves only after a render; supply a stub canvas so the
    // firstUpdated `if (this._canvas)` branch is taken (mirrors production).
    Object.defineProperty(sp, '_canvas', {
      configurable: true,
      value: document.createElement('canvas'),
    });

    sp.firstUpdated();

    // The bug: firstUpdated() calls _updateSizeAndRender() (which lazily
    // constructs a renderer when _canvas is present) and THEN constructs another
    // renderer inline with no null guard — orphaning the first (never destroyed).
    expect(webglConstructions).toHaveLength(1);
    // The host must reference the surviving renderer.
    expect(sp._webglRenderer).toBe(webglConstructions[0]);
    // No orphan: every constructed renderer is the one the host holds.
    expect(webglConstructions.filter((r) => r !== sp._webglRenderer)).toHaveLength(0);
  });
});

describe('F-05: numeric recompute does not complete after disconnect', () => {
  it('a numeric recompute scheduled then disconnected leaves no job running', () => {
    const rafQueue: FrameRequestCallback[] = [];
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
      rafQueue.push(cb);
      return rafQueue.length;
    });
    vi.stubGlobal('cancelAnimationFrame', () => {});

    const sp = makeHost();
    sp.selectedAnnotation = 'score';

    sp._scheduleNumericAnnotationRefresh(); // queues the heavy-recompute RAF
    expect(sp._numericRecomputeRunning).toBe(true); // running after schedule

    sp.disconnectedCallback(); // cancel() bumps the job id + cancels the RAF + clears running
    expect(sp._numericRecomputeRunning).toBe(false); // teardown cleared the busy state

    // Drain whatever RAF bodies are still queued: the superseded job must bail
    // (the cancel bumped the job id), so it neither runs the body nor re-enters
    // the running state. (F-46: the removed -end event is now re-characterized via
    // the kept busy-state mirror.)
    rafQueue.forEach((cb) => cb(0));

    expect(sp._numericRecomputeRunning).toBe(false);
  });
});

describe('F-12: resetZoom transition interrupted on disconnect', () => {
  it('disconnectedCallback tears down the interaction controller (interrupts the 750ms transition)', () => {
    const sp = makeHost();
    const teardown = vi.fn();
    // Stand in for the B8 PlotInteractionController. Its real teardown() calls
    // _svgSelection.interrupt(), which aborts the resetZoom .transition(750).
    sp._interaction = {
      teardown,
      resetZoom: () => {},
      initialize: () => {},
    };

    sp.disconnectedCallback();

    expect(teardown).toHaveBeenCalledTimes(1);
  });
});

describe('F-16: _commitSelection RAF cancelled on disconnect', () => {
  it('a selection committed then disconnected before the RAF fires dispatches nothing', () => {
    // Map id -> callback so cancelAnimationFrame can actually remove a pending
    // RAF body (mirrors the browser: the disconnect cancel must un-queue it).
    const rafQueue = new Map<number, FrameRequestCallback>();
    let nextId = 1;
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
      const id = nextId++;
      rafQueue.set(id, cb);
      return id;
    });
    vi.stubGlobal('cancelAnimationFrame', (id: number) => {
      rafQueue.delete(id);
    });

    const sp = makeHost();
    const brushEvents: unknown[] = [];
    sp.addEventListener('brush-selection', (e) => brushEvents.push(e));
    const clearVisual = vi.fn();

    // Commit schedules the deferred RAF; disconnect must cancel it before it runs.
    sp._commitSelection(['p0', 'p1'], clearVisual);
    sp.disconnectedCallback();

    // Drain whatever survives: the cancelled commit RAF is gone, so nothing fires.
    rafQueue.forEach((cb) => cb(0));

    expect(brushEvents).toHaveLength(0);
    expect(sp.selectedProteinIds).not.toEqual(['p0', 'p1']);
  });
});

describe('F-21: _renderWebGL is a no-op when the renderer is null', () => {
  it('does not throw when _webglRenderer is null', () => {
    const sp = makeHost();
    // No firstUpdated ran, so the renderer was never constructed (null). The
    // current code dereferences `this._webglRenderer!` unconditionally and
    // throws a TypeError; a hardened _renderWebGL bails when the renderer is
    // null. `_scales` is a getter (null with no processed data), so
    // _getPointsForRendering returns EMPTY_PLOT_DATA before the null deref.
    sp._webglRenderer = null;

    expect(() => sp._renderWebGL('plot')).not.toThrow();
  });
});
