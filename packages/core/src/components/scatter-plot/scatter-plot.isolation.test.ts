/**
 * @vitest-environment jsdom
 *
 * Unit tests for the isolation-state event contract on protspace-scatterplot.
 *
 * These tests construct the element via document.createElement without appending
 * it to the DOM, so Lit's connectedCallback/firstUpdated never fire and we avoid
 * the WebGL/canvas init that would otherwise blow up under jsdom. The constructor
 * does new ResizeObserver(...), which jsdom doesn't provide, so we stub that one
 * global before the element module is imported.
 */
import { vi, describe, it, expect, beforeEach } from 'vitest';
import type { PlotData, VisualizationData } from '@protspace/utils';

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

type ScatterplotInternals = HTMLElement & {
  _isolationMode: boolean;
  _isolationHistory: string[][];
  clearIsolationState(options?: { silent?: boolean }): void;
  isIsolationMode(): boolean;
};

describe('scatter-plot clearIsolationState', () => {
  let sp: ScatterplotInternals;
  let events: CustomEvent[];

  beforeEach(() => {
    sp = document.createElement('protspace-scatterplot') as ScatterplotInternals;
    events = [];
    sp.addEventListener('data-isolation-reset', (event) => {
      events.push(event as CustomEvent);
    });
  });

  it('dispatches data-isolation-reset when previously isolated', () => {
    sp._isolationMode = true;
    sp._isolationHistory = [['p1', 'p2', 'p3']];

    sp.clearIsolationState();

    expect(events).toHaveLength(1);
    expect(events[0].detail).toEqual({ isolationHistory: [], isolationMode: false });
    expect(events[0].bubbles).toBe(true);
    expect(events[0].composed).toBe(true);
    expect(sp.isIsolationMode()).toBe(false);
    expect(sp._isolationHistory).toEqual([]);
  });

  it('does not dispatch when never isolated (fresh load)', () => {
    sp.clearIsolationState();

    expect(events).toHaveLength(0);
    expect(sp.isIsolationMode()).toBe(false);
  });

  it('does not dispatch when called with { silent: true } from resetIsolation', () => {
    sp._isolationMode = true;
    sp._isolationHistory = [['p1', 'p2']];

    sp.clearIsolationState({ silent: true });

    expect(events).toHaveLength(0);
    expect(sp.isIsolationMode()).toBe(false);
    expect(sp._isolationHistory).toEqual([]);
  });
});

describe('scatter-plot getCurrentData (isolation slicing)', () => {
  type SlicingInternals = HTMLElement & {
    data: VisualizationData;
    selectedProjectionIndex: number;
    filtersActive: boolean;
    filteredProteinIds: string[];
    _isolationMode: boolean;
    _isolationHistory: string[][];
    _plotData: PlotData;
    getCurrentData(): VisualizationData | null;
  };

  // 5 proteins; row coords encode the index so we can assert which rows survived.
  function buildData(): VisualizationData {
    return {
      protein_ids: ['p0', 'p1', 'p2', 'p3', 'p4'],
      projections: [
        {
          name: 'proj',
          dimension: 2,
          data: new Float32Array([0, 0, 10, 11, 20, 22, 30, 33, 40, 44]),
        },
      ],
      annotations: {
        cat: {
          kind: 'categorical',
          values: ['A', 'B'],
          colors: ['#000000', '#ffffff'],
          shapes: ['circle', 'square'],
        },
        num: { kind: 'numeric', values: [], colors: [], shapes: [] },
      },
      annotation_data: {
        cat: new Int32Array([0, 1, 0, 1, 0]),
      },
      numeric_annotation_data: {
        num: [100, 101, 102, 103, 104],
      },
    };
  }

  it('slices protein ids, categorical, numeric, and projection data to the isolated survivors', () => {
    const el = document.createElement('protspace-scatterplot') as SlicingInternals;
    const data = buildData();
    el.data = data;
    el.selectedProjectionIndex = 0;

    // Isolate p1 and p3 (original indices 1 and 3). _plotData is the survivor view
    // that getCurrentData() must reuse for slicing.
    el._isolationMode = true;
    el._isolationHistory = [['p1', 'p3']];
    el._plotData = {
      length: 2,
      xs: new Float32Array([10, 30]),
      ys: new Float32Array([11, 33]),
      zs: null,
      originalIndices: new Int32Array([1, 3]),
      proteinIds: data.protein_ids,
    };

    const result = el.getCurrentData();
    expect(result).not.toBeNull();
    const r = result as VisualizationData;

    expect(r.protein_ids).toEqual(['p1', 'p3']);
    // categorical column sliced by survivor indices: cat[1]=1, cat[3]=1
    expect(Array.from(r.annotation_data.cat as Int32Array)).toEqual([1, 1]);
    // numeric column sliced: num[1]=101, num[3]=103
    expect(r.numeric_annotation_data?.num).toEqual([101, 103]);
    // projection coords sliced to rows 1 and 3
    expect(Array.from(r.projections[0].data)).toEqual([10, 11, 30, 33]);
    expect(r.projections[0].dimension).toBe(2);
  });

  it('produces identical slicing via the fallback path when the display is pre-filtered', () => {
    const el = document.createElement('protspace-scatterplot') as SlicingInternals;
    const data = buildData();
    el.data = data;
    el.selectedProjectionIndex = 0;

    // Active view filter excludes p4, so _getCurrentDisplayData returns a strict
    // subset (length 4 != full length 5). That defeats the originalIndices fast-path
    // length guard and forces the membership-scan fallback.
    el.filtersActive = true;
    el.filteredProteinIds = ['p0', 'p1', 'p2', 'p3'];

    // Isolated survivors p1, p3 are a subset of the filtered display.
    el._isolationMode = true;
    el._isolationHistory = [['p1', 'p3']];
    el._plotData = {
      length: 2,
      xs: new Float32Array([10, 30]),
      ys: new Float32Array([11, 33]),
      zs: null,
      originalIndices: new Int32Array([1, 3]),
      proteinIds: data.protein_ids,
    };

    const result = el.getCurrentData();
    expect(result).not.toBeNull();
    const r = result as VisualizationData;

    // Identical survivor slice to the fast-path test above.
    expect(r.protein_ids).toEqual(['p1', 'p3']);
    expect(Array.from(r.annotation_data.cat as Int32Array)).toEqual([1, 1]);
    expect(r.numeric_annotation_data?.num).toEqual([101, 103]);
    expect(Array.from(r.projections[0].data)).toEqual([10, 11, 30, 33]);
  });
});

describe('scatter-plot isolation render-refresh sequence', () => {
  type RefreshInternals = HTMLElement & {
    data: VisualizationData;
    selectedProteinIds: string[];
    selectedProjectionIndex: number;
    _isolationMode: boolean;
    _isolationHistory: string[][];
    _plotData: PlotData;
    _lastDataRef: unknown;
    _processData(): void;
    _buildQuadtree(): void;
    _updateStyleSignature(): void;
    _renderPlot(): void;
    _reprocessAndRefresh(): void;
    isolateSelection(): void;
    resetIsolation(): void;
  };

  function buildData(): VisualizationData {
    return {
      protein_ids: ['p0', 'p1', 'p2', 'p3', 'p4'],
      projections: [
        {
          name: 'proj',
          dimension: 2,
          data: new Float32Array([0, 0, 10, 11, 20, 22, 30, 33, 40, 44]),
        },
      ],
      annotations: {
        cat: {
          kind: 'categorical',
          values: ['A', 'B'],
          colors: ['#000000', '#ffffff'],
          shapes: ['circle', 'square'],
        },
      },
      annotation_data: { cat: new Int32Array([0, 1, 0, 1, 0]) },
    };
  }

  function makeEl(): RefreshInternals {
    const el = document.createElement('protspace-scatterplot') as RefreshInternals;
    el.data = buildData();
    el.selectedProjectionIndex = 0;
    // Identity view over all 5 proteins. isolateSelection() validates the
    // requested ids against plotDataId(_plotData, slot); without a populated
    // _plotData the validation finds no survivors and bails before the refresh.
    el._plotData = {
      length: 5,
      xs: new Float32Array([0, 10, 20, 30, 40]),
      ys: new Float32Array([0, 11, 22, 33, 44]),
      zs: null,
      originalIndices: null,
      proteinIds: ['p0', 'p1', 'p2', 'p3', 'p4'],
    };
    return el;
  }

  // Record the order of the staged refresh steps. We spy the pure-ish private
  // steps; requestUpdate + the deferred _renderPlot are observed via
  // updateComplete resolution. The element is never appended, so Lit's lifecycle
  // and WebGL never fire — _webglRenderer stays undefined, exercising the
  // `if (this._webglRenderer)` false branch.
  function instrument(el: RefreshInternals) {
    const calls: string[] = [];
    vi.spyOn(el, '_processData').mockImplementation(() => calls.push('processData'));
    vi.spyOn(el, '_buildQuadtree').mockImplementation(() => calls.push('buildQuadtree'));
    vi.spyOn(el, '_updateStyleSignature').mockImplementation(() =>
      calls.push('updateStyleSignature'),
    );
    vi.spyOn(el, '_renderPlot').mockImplementation(() => calls.push('renderPlot'));
    // jsdom element is not connected, so updateComplete is an already-resolved promise.
    Object.defineProperty(el, 'updateComplete', {
      configurable: true,
      get: () => Promise.resolve(true),
    });
    const requestUpdate = vi.spyOn(el as unknown as { requestUpdate: () => void }, 'requestUpdate');
    return { calls, requestUpdate };
  }

  it('isolateSelection runs processData → buildQuadtree → requestUpdate, then defers renderPlot', async () => {
    const el = makeEl();
    el.selectedProteinIds = ['p1', 'p3'];
    const { calls, requestUpdate } = instrument(el);

    el.isolateSelection();

    // Synchronous portion: process + quadtree happen before requestUpdate; render is deferred.
    expect(calls).toEqual(['processData', 'buildQuadtree']);
    expect(requestUpdate).toHaveBeenCalled();

    await el.updateComplete;
    expect(calls).toEqual(['processData', 'buildQuadtree', 'renderPlot']);
  });

  it('resetIsolation nulls _lastDataRef BEFORE reprocess, then runs the same refresh sequence', async () => {
    const el = makeEl();
    el._isolationMode = true;
    el._isolationHistory = [['p1', 'p3']];
    el._lastDataRef = { stale: true };
    const { calls, requestUpdate } = instrument(el);
    // Capture _lastDataRef at the moment _processData is (re)invoked.
    let lastDataRefAtProcess: unknown = 'unset';
    (
      el._processData as unknown as { mockImplementation: (f: () => void) => void }
    ).mockImplementation(() => {
      lastDataRefAtProcess = el._lastDataRef;
      calls.push('processData');
    });

    el.resetIsolation();

    // Divergence preserved: cleared before the shared refresh block runs.
    expect(lastDataRefAtProcess).toBeNull();
    expect(calls).toEqual(['processData', 'buildQuadtree']);
    expect(requestUpdate).toHaveBeenCalled();

    await el.updateComplete;
    expect(calls).toEqual(['processData', 'buildQuadtree', 'renderPlot']);
  });

  it('_reprocessAndRefresh is the single shared implementation both callers route through', () => {
    const el = makeEl();
    const spy = vi.spyOn(el, '_reprocessAndRefresh');
    el.selectedProteinIds = ['p1'];
    el.isolateSelection();
    el._isolationMode = true;
    el._isolationHistory = [['p1']];
    el.resetIsolation();
    expect(spy).toHaveBeenCalledTimes(2);
  });
});
