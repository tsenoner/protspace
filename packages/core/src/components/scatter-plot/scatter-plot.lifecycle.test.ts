/**
 * @vitest-environment jsdom
 *
 * Lifecycle hardening. These tests pin the
 * post-disconnect / post-context-loss behaviour of the host's lifecycle paths.
 * Every assertion targets a DETACHED node or a null-renderer state; the
 * connected render / zoom / selection / numeric flow is untouched and stays
 * byte-identical (event dispatch and detail shapes are unchanged: we only SUPPRESS spurious dispatches from a
 * detached node, never alter a dispatch the user observes while connected).
 *
 * Construct the element via createElement WITHOUT appending it (so isConnected
 * stays false and Lit's connectedCallback / WebGL init never auto-run — same
 * approach as scatter-plot.test.ts / scatter-plot.isolation.test.ts). We drive
 * the private lifecycle methods directly.
 *
 * Covered:
 *   - firstUpdated constructs EXACTLY ONE WebGLRenderer and never
 *     orphans one (currently RED — firstUpdated double-constructs via
 *     _updateSizeAndRender then again inline).
 *   - a numeric recompute does not complete after disconnect — the busy
 *     state is cleared and a superseded RAF body bails (ALREADY SATISFIED by
 *     NumericRecomputeRunner.cancel(); this is a characterization lock).
 *     (The old `numeric-recompute-end` event was removed; re-characterized via
 *     the kept `_numericRecomputeRunning` mirror.)
 *   - the 750ms resetZoom transition is interrupted on disconnect
 *     (ALREADY SATISFIED by PlotInteractionController.teardown(); this is a
 *     characterization lock asserted via the controller teardown path).
 *   - a selection committed then disconnected before its deferred RAF
 *     fires dispatches nothing — disconnectedCallback cancels the tracked
 *     _commitSelectionRafId (currently RED — the RAF id is not cancelled). The
 *     suppression is via cancellation, NOT an isConnected body-guard, so the
 *     connected dispatch (scatter-plot.test.ts selection locks) stays byte-identical.
 *   - `_renderWebGL` is a no-op (does not throw) when `_webglRenderer` is
 *     null (currently RED — uses a non-null assertion).
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import * as d3 from 'd3';

// Count WebGLRenderer constructions without a real GL context. We preserve the
// real module's other exports (computeSizeScaleFactor, pointRadiusCss) and
// replace only the renderer with an instrumented stub that records each
// construction + destroy.
// The class + registry live in vi.hoisted so the hoisted vi.mock factory can
// close over them (a top-level const would be a TDZ ReferenceError at mock time).
const { webglConstructions, FakeWebGLRenderer } = vi.hoisted(() => {
  const constructions: FakeWebGLRenderer[] = [];
  class FakeWebGLRenderer {
    destroyed = false;
    renders = 0;
    resizes = 0;
    constructor(..._args: unknown[]) {
      constructions.push(this);
    }
    prewarm() {}
    setSelectionActive() {}
    invalidatePositionCache() {}
    invalidateStyleCache() {}
    invalidateCategoryStyles() {}
    invalidateDepthOrder() {}
    render() {
      this.renders++;
    }
    clear() {}
    resize() {
      this.resizes++;
    }
    releaseDataReferences() {}
    pointScale() {
      return 1;
    }
    cancelMorph() {}
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

import {
  createPlot,
  fakeFrames,
  fakeIdle,
  makeFamilyData,
  type PlotInternals,
} from './test-support/plot-fixture';

function makeHost() {
  return createPlot({ data: makeFamilyData({ score: true }), selectedAnnotation: 'fam' });
}

/** jsdom's MouseEvent refuses the test window as its view, which d3's brush listens on. */
const mouse = (type: string, x: number, y: number) =>
  Object.defineProperty(new MouseEvent(type, { bubbles: true, clientX: x, clientY: y }), 'view', {
    value: window,
  });

afterEach(() => {
  webglConstructions.length = 0;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('firstUpdated constructs exactly one WebGLRenderer', () => {
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

describe('numeric recompute does not complete after disconnect', () => {
  it('a numeric recompute scheduled then disconnected leaves no job running', () => {
    const frames = fakeFrames();
    // A cancel that does nothing, so the superseded body still runs and must bail.
    vi.stubGlobal('cancelAnimationFrame', () => {});

    const sp = makeHost();
    sp.selectedAnnotation = 'score';

    sp._scheduleNumericAnnotationRefresh(); // queues the heavy-recompute RAF
    expect(sp._numericRecomputeRunning).toBe(true); // running after schedule

    sp.disconnectedCallback(); // cancel() bumps the job id + cancels the RAF + clears running
    expect(sp._numericRecomputeRunning).toBe(false); // teardown cleared the busy state

    // Drain whatever RAF bodies are still queued: the superseded job must bail
    // (the cancel bumped the job id), so it neither runs the body nor re-enters
    // the running state. (The removed -end event is now re-characterized via
    // the kept busy-state mirror.)
    frames.run();

    expect(sp._numericRecomputeRunning).toBe(false);
  });
});

describe('resetZoom transition interrupted on disconnect', () => {
  it('disconnectedCallback tears down the interaction controller (interrupts the 750ms transition)', () => {
    const sp = makeHost();
    const teardown = vi.fn();
    // Stand in for the B8 PlotInteractionController. Its real teardown() calls
    // _svgSelection.interrupt(), which aborts the resetZoom .transition(750).
    sp._interaction = {
      teardown,
      resetZoom: () => {},
      initialize: () => {},
    } as never;

    sp.disconnectedCallback();

    expect(teardown).toHaveBeenCalledTimes(1);
  });
});

describe('_commitSelection RAF cancelled on disconnect', () => {
  it('a selection committed then disconnected before the RAF fires dispatches nothing', () => {
    // The disconnect cancel must un-queue the pending RAF body, as in the browser.
    const frames = fakeFrames();

    const sp = makeHost();
    const brushEvents: unknown[] = [];
    sp.addEventListener('brush-selection', (e) => brushEvents.push(e));
    const clearVisual = vi.fn();

    // Commit schedules the deferred RAF; disconnect must cancel it before it runs.
    sp._commitSelection(['p0', 'p1'], clearVisual);
    sp.disconnectedCallback();

    // Drain whatever survives: the cancelled commit RAF is gone, so nothing fires.
    frames.run();

    expect(brushEvents).toHaveLength(0);
    expect(sp.selectedProteinIds).not.toEqual(['p0', 'p1']);
  });
});

describe('_renderWebGL is a no-op when the renderer is null', () => {
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

describe('reconnect after disconnect', () => {
  it('draws with a fresh renderer and never resizes or draws the destroyed one', async () => {
    const frames = fakeFrames();
    const sp = makeHost();
    document.body.appendChild(sp);
    await sp.updateComplete;
    frames.run();
    const dead = sp._webglRenderer as unknown as InstanceType<typeof FakeWebGLRenderer>;

    sp.remove();
    expect(dead.destroyed).toBe(true);
    const { renders, resizes } = dead;

    document.body.appendChild(sp);
    // What the ResizeObserver runs once the plot is back in the page.
    sp._updateSizeAndRender();

    expect(dead.resizes).toBe(resizes);
    expect(dead.renders).toBe(renders);
    const fresh = sp._webglRenderer as unknown as InstanceType<typeof FakeWebGLRenderer>;
    expect(fresh).not.toBe(dead);
    expect(fresh.destroyed).toBe(false);
    expect(fresh.resizes).toBe(1);
    expect(fresh.renders).toBe(1);

    await sp.updateComplete;
    sp.remove();
  });

  /** A plot appended, removed and appended again, with its point grid built. */
  async function reconnectedPlot(
    frames: ReturnType<typeof fakeFrames>,
    inputs: Partial<PlotInternals> = {},
  ) {
    const sp = createPlot({
      data: makeFamilyData({ score: true }),
      selectedAnnotation: 'fam',
      ...inputs,
    });
    document.body.appendChild(sp);
    await sp.updateComplete;
    frames.run();
    sp.remove();
    document.body.appendChild(sp);
    // What the ResizeObserver runs once the plot is back in the page.
    sp._updateSizeAndRender();
    frames.run();
    return sp;
  }

  it('selects with the brush again', async () => {
    const frames = fakeFrames();
    const sp = await reconnectedPlot(frames, { selectionMode: true });

    // A drag over the whole plot, as d3's brush hears it.
    sp._svg!.querySelector('.brush-container .overlay')!.dispatchEvent(mouse('mousedown', 1, 1));
    window.dispatchEvent(mouse('mousemove', 799, 599));
    window.dispatchEvent(mouse('mouseup', 799, 599));
    frames.flush();

    expect([...sp.selectedProteinIds].sort()).toEqual(['p0', 'p1', 'p2', 'p3', 'p4', 'p5']);
    sp.remove();
  });

  it('selects with the lasso again', async () => {
    const frames = fakeFrames();
    const sp = await reconnectedPlot(frames, { selectionMode: true, selectionTool: 'lasso' });

    const svg = sp._svg!;
    svg.dispatchEvent(mouse('pointerdown', 0, 0));
    for (const [x, y] of [
      [800, 0],
      [800, 600],
      [0, 600],
    ]) {
      svg.dispatchEvent(mouse('pointermove', x, y));
    }
    svg.dispatchEvent(mouse('pointerup', 0, 600));
    frames.flush();

    expect([...sp.selectedProteinIds].sort()).toEqual(['p0', 'p1', 'p2', 'p3', 'p4', 'p5']);
    sp.remove();
  });

  it('builds the protein id index whose idle build the disconnect cancelled', async () => {
    const frames = fakeFrames();
    const idle = fakeIdle();
    const data = { ...makeFamilyData(), protein_ids: ['a', 'a', 'b', 'b', 'c', 'c'] };
    const sp = await reconnectedPlot(frames, { data });
    idle.run();

    // Three proteins in six slots: the point count is of proteins once the index says so.
    expect(sp._getVisiblePointCount()).toBe(3);
    sp.remove();
  });

  it('drops the tooltip of the point hovered before the disconnect', async () => {
    const frames = fakeFrames();
    const sp = createPlot({ data: makeFamilyData({ score: true }), selectedAnnotation: 'fam' });
    document.body.appendChild(sp);
    await sp.updateComplete;
    frames.run();
    const { x, y } = sp._scales!;
    sp._svg!.dispatchEvent(mouse('mousemove', x(0), y(0)));
    frames.run();
    expect(sp._tooltipData).not.toBeNull();

    sp.remove();
    document.body.appendChild(sp);
    sp._updateSizeAndRender();

    expect(sp._tooltipData).toBeNull();
    sp.remove();
  });

  it('runs the numeric recompute the disconnect dropped', async () => {
    const frames = fakeFrames();
    const sp = createPlot({ data: makeFamilyData({ score: true }), selectedAnnotation: 'fam' });
    document.body.appendChild(sp);
    await sp.updateComplete;
    frames.run();
    const changes: Event[] = [];
    sp.addEventListener('data-change', (e) => changes.push(e));

    // A numeric settings change, then a disconnect before its frame.
    sp._scheduleNumericAnnotationRefresh();
    sp.remove();
    document.body.appendChild(sp);
    frames.run();

    expect(changes).toHaveLength(1);
    sp.remove();
  });

  it('lands the reset zoom its disconnect cut short', async () => {
    const frames = fakeFrames();
    const sp = createPlot({ data: makeFamilyData({ score: true }), selectedAnnotation: 'fam' });
    document.body.appendChild(sp);
    await sp.updateComplete;
    frames.run();

    // Zoomed in, then a reset (a double-click or a data load) and a disconnect before it ends.
    sp._interaction!.setTransform(d3.zoomIdentity.scale(2));
    sp.resetZoom();
    sp.remove();
    document.body.appendChild(sp);

    expect(sp._transform).toEqual(d3.zoomIdentity);
    // d3's own copy, which the next wheel or drag starts from.
    expect(d3.zoomTransform(sp._svg!)).toEqual(d3.zoomIdentity);
    sp.remove();
  });
});

describe('selection mode turned on before the data', () => {
  it('selects with the brush once the data arrives', async () => {
    const frames = fakeFrames();
    const sp = createPlot({ selectionMode: true, selectedAnnotation: 'fam' });
    document.body.appendChild(sp);
    await sp.updateComplete;
    sp.data = makeFamilyData();
    await sp.updateComplete;
    frames.run();

    // A drag over the whole plot, as d3's brush hears it.
    sp._svg!.querySelector('.brush-container .overlay')?.dispatchEvent(mouse('mousedown', 1, 1));
    window.dispatchEvent(mouse('mousemove', 799, 599));
    window.dispatchEvent(mouse('mouseup', 799, 599));
    frames.flush();

    expect([...sp.selectedProteinIds].sort()).toEqual(['p0', 'p1', 'p2', 'p3', 'p4', 'p5']);
    sp.remove();
  });
});
