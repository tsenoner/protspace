/**
 * @vitest-environment jsdom
 *
 * Legend reactivity (B11: F-19 / F-31 / F-57 / F-46). The legend → scatter-plot
 * mapping transport (INV-06/07) is consumed by two handlers
 * (`_handleZOrderChange` / `_handleColorMappingChange`). This file LOCKS their
 * pre-change behavior:
 *
 *   - F-31 single render path: a legend mapping change must render EXACTLY ONCE.
 *     Today the imperative handler calls `_renderPlot()` once AND the three
 *     mapping fields are `@state`, so the write calls `requestUpdate(...)`,
 *     enqueues a Lit update, and `updated()`'s catch-all (scatter-plot.ts
 *     L774-777, `!onlySelectionChanged`) fires a SECOND `_renderPlot()`. The
 *     load-bearing signal — identical to F-48/_transform — is whether the field
 *     write calls `requestUpdate`: a reactive `@state` setter calls it
 *     synchronously on write (RED: a second render is scheduled); a plain field
 *     does not (GREEN after F-31). This is observable without connecting and
 *     without any `updateComplete` await (which hangs on an un-appended element).
 *
 *   - INV-08 colorOnly guardrail: colorOnly=true skips `invalidateDepthOrder()`
 *     + virtualization invalidation; colorOnly=false forces them. Must stay
 *     GREEN across the batch.
 *
 *   - F-19 key-validation: a malformed/partial detail must NOT overwrite the
 *     mapping fields with `undefined`. Today the handlers blind-cast
 *     `event as CustomEvent` and assign `.detail.shapeMapping` (= undefined) —
 *     RED until the runtime guards are added.
 *
 *   - F-57 (post-B6 reality): the numeric recompute lifecycle is owned by
 *     `NumericRecomputeRunner`; the host exposes `_numericRecomputeRunning`
 *     (`@state` mirror, driven by the runner's `setRunning` host callback) —
 *     there is NO `_numericRecomputeState` object. The runner's `setRunning`
 *     write to the `@state` mirror schedules its own Lit update, so the runner's
 *     explicit `host.requestUpdate()` in the start path is redundant. Signal:
 *     spy the host `requestUpdate` across a synchronous `schedule()` start.
 *
 *   - F-46: the public `numeric-recompute-start` / `-end` CustomEvents have ZERO
 *     consumers (confirmed by repo-wide search; absent from INV-05). They must
 *     be removed while the `_numericRecomputeRunning` busy mirror is preserved.
 *     Today the runner dispatches them via the host `dispatch` callback — RED for
 *     "not dispatched" until F-46.
 *
 * Construct the element via createElement WITHOUT appending (so Lit's
 * connectedCallback / WebGL init never runs — same no-append pattern as
 * scatter-plot.test.ts / scatter-plot.b6.test.ts). The legend listeners are
 * registered in connectedCallback, which never runs here, so the handlers are
 * driven DIRECTLY (not via dispatchEvent), matching the sibling tests that call
 * private handlers directly.
 */
import { vi, describe, it, expect, afterEach } from 'vitest';
import type { VisualizationData } from '@protspace/utils';

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

function makeData(): VisualizationData {
  const fams = ['A', 'A', 'B'];
  const coords = new Float32Array(fams.length * 2);
  fams.forEach((_, i) => {
    coords[i * 2] = i;
    coords[i * 2 + 1] = i;
  });
  return {
    protein_ids: fams.map((_, i) => `p${i}`),
    projections: [{ name: 'umap', data: coords, dimension: 2 }],
    annotations: {
      fam: {
        values: fams,
        colors: ['#f00', '#f00', '#0f0'],
        shapes: fams.map(() => 'circle'),
      },
    },
    annotation_data: { fam: fams.map((v) => [fams.indexOf(v)]) },
  } as unknown as VisualizationData;
}

type WebglStub = {
  invalidateDepthOrder: ReturnType<typeof vi.fn>;
  invalidateStyleCache: ReturnType<typeof vi.fn>;
};

type Internals = HTMLElement & {
  data: VisualizationData;
  selectedAnnotation: string;
  _plotData: { length: number };
  _zOrderMapping: Record<string, number> | null;
  _colorMapping: Record<string, string> | null;
  _shapeMapping: Record<string, string> | null;
  _styleGettersCache: unknown;
  _renderPlot(): void;
  _invalidateVirtualizationCache(): void;
  _webglRenderer: WebglStub;
  _numericRecomputeRunning: boolean;
  _handleZOrderChange(event: Event): void;
  _handleColorMappingChange(event: Event): void;
  _scheduleNumericAnnotationRefresh(): void;
  requestUpdate(name?: PropertyKey, oldValue?: unknown): void;
};

function makeEl(): Internals {
  const el = document.createElement('protspace-scatterplot') as unknown as Internals;
  el.data = makeData();
  el.selectedAnnotation = 'fam';
  // Simulate post-process state: non-empty plot so the handler render branch runs.
  (el as unknown as { _plotData: unknown })._plotData = { length: 3 };
  // Stub the renderer so invalidate* calls are no-ops and observable.
  (el as unknown as { _webglRenderer: WebglStub })._webglRenderer = {
    invalidateDepthOrder: vi.fn(),
    invalidateStyleCache: vi.fn(),
  };
  return el;
}

function colorMappingEvent(detail: unknown): Event {
  return new CustomEvent('legend-colormapping-change', { detail });
}
function zOrderEvent(detail: unknown): Event {
  return new CustomEvent('legend-zorder-change', { detail });
}

afterEach(() => vi.restoreAllMocks());

describe('legend mapping handlers — single render path (F-31)', () => {
  it('z-order change renders once imperatively and schedules NO second (Lit) render', () => {
    const el = makeEl();
    const renderSpy = vi.spyOn(el, '_renderPlot').mockImplementation(() => {});
    // requestUpdate is the Lit scheduling hook: a reactive @state write calls it
    // (→ updated() catch-all = a SECOND render); a plain field does not.
    const reqSpy = vi.spyOn(el, 'requestUpdate');

    el._handleZOrderChange(zOrderEvent({ zOrderMapping: { A: 1, B: 0 } }));

    expect(renderSpy).toHaveBeenCalledTimes(1); // the imperative render
    expect(el._zOrderMapping).toEqual({ A: 1, B: 0 });
    // F-31: while _zOrderMapping is @state, the write schedules the second render.
    // RED on the current tree (requestUpdate called); GREEN once demoted to a plain field.
    expect(reqSpy).not.toHaveBeenCalled();
  });

  it('color-mapping change renders once imperatively and schedules NO second (Lit) render', () => {
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

    expect(renderSpy).toHaveBeenCalledTimes(1);
    expect(el._colorMapping).toEqual({ A: '#111111', B: '#222222' });
    expect(el._shapeMapping).toEqual({ A: 'circle', B: 'square' });
    // F-31: _colorMapping/_shapeMapping are @state today → requestUpdate is
    // called → updated() catch-all renders a SECOND time. RED until demoted.
    expect(reqSpy).not.toHaveBeenCalled();
  });
});

describe('legend mapping handlers — INV-08 colorOnly contract (guardrail, stays GREEN)', () => {
  it('colorOnly=true does NOT call invalidateDepthOrder / virtualization invalidate', () => {
    const el = makeEl();
    vi.spyOn(el, '_renderPlot').mockImplementation(() => {});
    const virtSpy = vi.spyOn(el, '_invalidateVirtualizationCache').mockImplementation(() => {});

    el._handleColorMappingChange(
      colorMappingEvent({
        colorMapping: { A: '#1' },
        shapeMapping: { A: 'circle' },
        colorOnly: true,
      }),
    );

    expect(el._webglRenderer.invalidateDepthOrder).not.toHaveBeenCalled();
    expect(virtSpy).not.toHaveBeenCalled();
  });

  it('colorOnly=false DOES call invalidateDepthOrder + virtualization invalidate', () => {
    const el = makeEl();
    vi.spyOn(el, '_renderPlot').mockImplementation(() => {});
    const virtSpy = vi.spyOn(el, '_invalidateVirtualizationCache').mockImplementation(() => {});

    el._handleColorMappingChange(
      colorMappingEvent({
        colorMapping: { A: '#1' },
        shapeMapping: { A: 'circle' },
        colorOnly: false,
      }),
    );

    expect(el._webglRenderer.invalidateDepthOrder).toHaveBeenCalledTimes(1);
    expect(virtSpy).toHaveBeenCalledTimes(1);
  });
});

describe('legend mapping handlers — malformed detail key-validation (F-19)', () => {
  it('a partial color-mapping detail does NOT overwrite state with undefined', () => {
    const el = makeEl();
    el._colorMapping = { A: '#existing' };
    el._shapeMapping = { A: 'circle' };
    vi.spyOn(el, '_renderPlot').mockImplementation(() => {});

    // Missing shapeMapping → a guard must reject, leaving prior state intact.
    el._handleColorMappingChange(colorMappingEvent({ colorMapping: { B: '#new' } }));

    // RED today: the handler blind-assigns _shapeMapping = detail.shapeMapping (undefined).
    expect(el._colorMapping).toEqual({ A: '#existing' });
    expect(el._shapeMapping).toEqual({ A: 'circle' });
  });

  it('a malformed z-order detail does NOT overwrite _zOrderMapping with undefined', () => {
    const el = makeEl();
    el._zOrderMapping = { A: 0, B: 1 };
    vi.spyOn(el, '_renderPlot').mockImplementation(() => {});

    // No zOrderMapping key → a guard must reject.
    el._handleZOrderChange(zOrderEvent({ wrongKey: { A: 9 } }));

    // RED today: the handler assigns _zOrderMapping = detail.zOrderMapping (undefined).
    expect(el._zOrderMapping).toEqual({ A: 0, B: 1 });
  });
});

describe('numeric-recompute scheduling — no redundant requestUpdate (F-57, post-B6)', () => {
  it('schedules exactly ONE Lit update on start — the @state mirror, not a duplicate explicit call', () => {
    const el = makeEl();
    // POST-B6: busy state is the _numericRecomputeRunning @state mirror, driven
    // by the runner's setRunning host callback. Writing that @state field already
    // routes through the element's requestUpdate() (Lit's reactive setter) and
    // schedules the update. The runner's SEPARATE explicit host.requestUpdate()
    // call was the redundant one F-57 drops.
    //
    // RED on the pre-F-57 tree: schedule() triggers TWO requestUpdate calls (the
    // @state setter's own + the explicit host.requestUpdate()). GREEN after F-57:
    // exactly ONE — the legitimate @state-driven schedule, with the redundant
    // explicit call removed.
    const reqSpy = vi.spyOn(el, 'requestUpdate');
    el._scheduleNumericAnnotationRefresh();
    expect(reqSpy).toHaveBeenCalledTimes(1);
    // The single call is the reactive @state mirror write (state: true), not a
    // bare argument-less explicit requestUpdate().
    expect(reqSpy.mock.calls[0][0]).toBe('_numericRecomputeRunning');
  });
});

describe('numeric-recompute events removed (F-46)', () => {
  it('does not dispatch numeric-recompute-start on schedule', () => {
    const el = makeEl();
    const startSpy = vi.fn();
    el.addEventListener('numeric-recompute-start', startSpy);
    el._scheduleNumericAnnotationRefresh();
    // RED today: the runner dispatches numeric-recompute-start via the host
    // dispatch callback. The stale-job guard + busy state are characterized via
    // the kept observables below + numeric-recompute-runner.test.ts.
    expect(startSpy).not.toHaveBeenCalled();
  });

  it('still sets _numericRecomputeRunning so the busy UI is unaffected (guardrail)', () => {
    const el = makeEl();
    el._scheduleNumericAnnotationRefresh();
    expect(el._numericRecomputeRunning).toBe(true);
  });
});
