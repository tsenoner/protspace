/**
 * @vitest-environment jsdom
 *
 * Legend reactivity. The legend → scatter-plot mapping transport (the
 * color/shape and z-order CustomEvents) is consumed by two handlers
 * (`_handleZOrderChange` / `_handleColorMappingChange`). This file locks their
 * behavior:
 *
 *   - Single render path: a legend mapping change must render EXACTLY ONCE.
 *     The handler calls `_renderPlot()` itself, and the three mapping fields are
 *     plain fields, not `@state`. Were they reactive, the write would call
 *     `requestUpdate(...)`, enqueue a Lit update, and the catch-all render in
 *     `_reconcileSelectionOverlays` (any key outside NO_ADDITIONAL_RENDER_KEYS)
 *     would fire a SECOND `_renderPlot()`. So the load-bearing signal, as for
 *     _transform, is that the field write does not call `requestUpdate`.
 *     This is observable without connecting and without any `updateComplete`
 *     await (which hangs on an un-appended element).
 *
 *   - colorOnly guardrail: colorOnly=true skips `invalidateDepthOrder()`;
 *     colorOnly=false forces it.
 *
 *   - Key validation: a malformed/partial detail must NOT overwrite the
 *     mapping fields with `undefined`. The handlers check the detail with
 *     `isLegendColorMappingDetail` / `isLegendZOrderDetail` before assigning.
 *
 *   - Redundant requestUpdate: the numeric recompute lifecycle is owned by
 *     `NumericRecomputeRunner`; the host exposes `_numericRecomputeRunning`
 *     (`@state` mirror, driven by the runner's `setRunning` host callback) —
 *     there is NO `_numericRecomputeState` object. The runner's `setRunning`
 *     write to the `@state` mirror schedules its own Lit update, so the runner's
 *     explicit `host.requestUpdate()` in the start path is redundant. Signal:
 *     spy the host `requestUpdate` across a synchronous `schedule()` start.
 *
 * Construct the element via createElement WITHOUT appending (so Lit's
 * connectedCallback / WebGL init never runs — same no-append pattern as
 * scatter-plot.test.ts / scatter-plot.b6.test.ts). The legend listeners are
 * registered in connectedCallback, which never runs here, so the handlers are
 * driven DIRECTLY (not via dispatchEvent), matching the sibling tests that call
 * private handlers directly.
 */
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';

import {
  createPlot,
  fakeFrames,
  makeFamilyData,
  type PlotInternals,
} from './test-support/plot-fixture';

type WebglStub = {
  invalidateDepthOrder: ReturnType<typeof vi.fn>;
  invalidateStyleCache: ReturnType<typeof vi.fn>;
  invalidateCategoryStyles: ReturnType<typeof vi.fn>;
};

/** The plot, with the stub renderer `makeEl` gives it. */
type Plot = Omit<PlotInternals, '_webglRenderer'> & { _webglRenderer: WebglStub };

function makeEl(): Plot {
  const el = createPlot({
    data: makeFamilyData({ n: 3, families: { A: '#f00', B: '#0f0' } }),
    selectedAnnotation: 'fam',
  }) as unknown as Plot;
  // Simulate post-process state: non-empty plot so the handler render branch runs.
  (el as unknown as { _plotData: unknown })._plotData = { length: 3 };
  // Stub the renderer so invalidate* calls are no-ops and observable.
  el._webglRenderer = {
    invalidateDepthOrder: vi.fn(),
    invalidateStyleCache: vi.fn(),
    invalidateCategoryStyles: vi.fn(),
  };
  return el;
}

function colorMappingEvent(detail: unknown): Event {
  return new CustomEvent('legend-colormapping-change', { detail });
}
function zOrderEvent(detail: unknown): Event {
  return new CustomEvent('legend-zorder-change', { detail });
}

// `_scheduleNumericAnnotationRefresh` queues a requestAnimationFrame. Every
// assertion in this file is synchronous and none wants that frame's body — but
// jsdom runs it after the scheduling test returns, against the deliberately
// minimal `_plotData` and renderer stubs here, and it throws from inside the
// frame callback where no test can catch it. That is an unhandled error, which
// fails `vitest --run` even though every assertion passed. Whether the frame
// lands before teardown is a timing race, so it surfaced as an intermittent CI
// failure rather than a consistent one.
//
// Holding the callbacks unrun (fakeFrames queues them, and no test runs a frame)
// keeps the file to the synchronous, never-connected contract its header describes.
beforeEach(() => {
  fakeFrames();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('legend mapping handlers — single render path', () => {
  it('z-order change renders once and schedules NO second (Lit) render', () => {
    const el = makeEl();
    const renderSpy = vi.spyOn(el, '_renderPlot').mockImplementation(() => {});
    // requestUpdate is the Lit scheduling hook: a reactive @state write calls it
    // (→ updated() catch-all = a SECOND render); a plain field does not.
    const reqSpy = vi.spyOn(el, 'requestUpdate');

    el._handleZOrderChange(zOrderEvent({ zOrderMapping: { A: 1, B: 0 } }));

    expect(renderSpy).not.toHaveBeenCalled(); // requested for the next frame
    el._renderLoop.flush();
    expect(renderSpy).toHaveBeenCalledTimes(1);
    expect(el._zOrderMapping).toEqual({ A: 1, B: 0 });
    // A reactive (@state) _zOrderMapping would call requestUpdate here and
    // schedule the second render; as a plain field it does not.
    expect(reqSpy).not.toHaveBeenCalled();
  });

  it('color-mapping change renders once and schedules NO second (Lit) render', () => {
    const el = makeEl();
    const renderSpy = vi.spyOn(el, '_renderPlot').mockImplementation(() => {});
    const reqSpy = vi.spyOn(el, 'requestUpdate');

    el._handleColorMappingChange(
      colorMappingEvent({
        colorMapping: { A: '#111111', B: '#222222' },
        shapeMapping: { A: 'circle', B: 'square' },
        colorOnly: false,
      }),
    );

    el._renderLoop.flush();
    expect(renderSpy).toHaveBeenCalledTimes(1);
    expect(el._colorMapping).toEqual({ A: '#111111', B: '#222222' });
    expect(el._shapeMapping).toEqual({ A: 'circle', B: 'square' });
    // Reactive (@state) _colorMapping/_shapeMapping would call
    // requestUpdate → the updated() catch-all would render a SECOND time.
    expect(reqSpy).not.toHaveBeenCalled();
  });
});

describe('legend mapping handlers — colorOnly contract', () => {
  it('colorOnly=true does NOT call invalidateDepthOrder', () => {
    const el = makeEl();
    vi.spyOn(el, '_renderPlot').mockImplementation(() => {});

    el._handleColorMappingChange(
      colorMappingEvent({
        colorMapping: { A: '#1' },
        shapeMapping: { A: 'circle' },
        colorOnly: true,
      }),
    );

    expect(el._webglRenderer.invalidateDepthOrder).not.toHaveBeenCalled();
    // Whole categories restyle: the renderer rewrites its per-record table.
    expect(el._webglRenderer.invalidateCategoryStyles).toHaveBeenCalledTimes(1);
    expect(el._webglRenderer.invalidateStyleCache).not.toHaveBeenCalled();
  });

  it('colorOnly=false DOES call invalidateDepthOrder', () => {
    const el = makeEl();
    vi.spyOn(el, '_renderPlot').mockImplementation(() => {});

    el._handleColorMappingChange(
      colorMappingEvent({
        colorMapping: { A: '#1' },
        shapeMapping: { A: 'circle' },
        colorOnly: false,
      }),
    );

    expect(el._webglRenderer.invalidateDepthOrder).toHaveBeenCalledTimes(1);
  });
});

describe('legend mapping handlers — malformed detail key-validation', () => {
  it('a partial color-mapping detail does NOT overwrite state with undefined', () => {
    const el = makeEl();
    el._colorMapping = { A: '#existing' };
    el._shapeMapping = { A: 'circle' };
    vi.spyOn(el, '_renderPlot').mockImplementation(() => {});

    // Missing shapeMapping → a guard must reject, leaving prior state intact.
    el._handleColorMappingChange(colorMappingEvent({ colorMapping: { B: '#new' } }));

    // Without the guard the handler would assign _shapeMapping = detail.shapeMapping (undefined).
    expect(el._colorMapping).toEqual({ A: '#existing' });
    expect(el._shapeMapping).toEqual({ A: 'circle' });
  });

  it('a malformed z-order detail does NOT overwrite _zOrderMapping with undefined', () => {
    const el = makeEl();
    el._zOrderMapping = { A: 0, B: 1 };
    vi.spyOn(el, '_renderPlot').mockImplementation(() => {});

    // No zOrderMapping key → a guard must reject.
    el._handleZOrderChange(zOrderEvent({ wrongKey: { A: 9 } }));

    // Without the guard the handler would assign _zOrderMapping = detail.zOrderMapping (undefined).
    expect(el._zOrderMapping).toEqual({ A: 0, B: 1 });
  });
});

describe('numeric-recompute scheduling — no redundant requestUpdate', () => {
  it('schedules exactly ONE Lit update on start — the @state mirror, not a duplicate explicit call', () => {
    const el = makeEl();
    // Busy state is the _numericRecomputeRunning @state mirror, driven by the
    // runner's setRunning host callback. Writing that @state field already
    // routes through the element's requestUpdate() (Lit's reactive setter) and
    // schedules the update, so a separate explicit host.requestUpdate() from the
    // runner (since removed) would show up here as a second call.
    const reqSpy = vi.spyOn(el, 'requestUpdate');
    el._scheduleNumericAnnotationRefresh();
    expect(reqSpy).toHaveBeenCalledTimes(1);
    // The single call is the reactive @state mirror write (state: true), not a
    // bare argument-less explicit requestUpdate().
    expect(reqSpy.mock.calls[0][0]).toBe('_numericRecomputeRunning');
  });
});

describe('numeric-recompute busy state', () => {
  it('still sets _numericRecomputeRunning so the busy UI is unaffected (guardrail)', () => {
    const el = makeEl();
    el._scheduleNumericAnnotationRefresh();
    expect(el._numericRecomputeRunning).toBe(true);
  });
});

describe('legend visibility — restyle categories, not points', () => {
  const changed = (...keys: string[]) => new Map(keys.map((k) => [k, undefined]));

  it('a hide or show alone restyles the categories', () => {
    const el = makeEl();
    el._rebuildStyle(changed('hiddenAnnotationValues'));
    expect(el._webglRenderer.invalidateCategoryStyles).toHaveBeenCalledTimes(1);
    expect(el._webglRenderer.invalidateStyleCache).not.toHaveBeenCalled();
  });

  it('a hide that comes with an annotation, Other or EAT change re-stages', () => {
    for (const other of ['selectedAnnotation', 'otherAnnotationValues', 'eatOverlayEnabled']) {
      const el = makeEl();
      Object.assign(el._webglRenderer, { invalidatePositionCache: vi.fn() });
      el._rebuildStyle(changed('hiddenAnnotationValues', other));
      expect(el._webglRenderer.invalidateStyleCache).toHaveBeenCalledTimes(1);
      expect(el._webglRenderer.invalidateCategoryStyles).not.toHaveBeenCalled();
    }
  });
});
