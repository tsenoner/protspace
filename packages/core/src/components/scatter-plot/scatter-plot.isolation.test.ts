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
import { DataProcessor } from '@protspace/utils';

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
        num: new Float64Array([100, 101, 102, 103, 104]),
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
    expect(r.numeric_annotation_data?.num).toEqual(new Float64Array([101, 103]));
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
    expect(r.numeric_annotation_data?.num).toEqual(new Float64Array([101, 103]));
    expect(Array.from(r.projections[0].data)).toEqual([10, 11, 30, 33]);
  });

  it('hands back the same view until the isolation or the filter changes', () => {
    const el = document.createElement('protspace-scatterplot') as SlicingInternals;
    el.data = buildData();
    el._isolationMode = true;
    el._isolationHistory = [['p1', 'p3', 'p4']];

    const first = el.getCurrentData();
    expect(el.getCurrentData()).toBe(first);

    el.filtersActive = true;
    el.filteredProteinIds = ['p0', 'p3', 'p4'];
    const filtered = el.getCurrentData();
    expect(filtered).not.toBe(first);
    expect(filtered?.protein_ids).toEqual(['p3', 'p4']);

    el._isolationHistory.push(['p4']);
    expect(el.getCurrentData()?.protein_ids).toEqual(['p4']);
  });
});

describe('scatter-plot isolateSelection (layers)', () => {
  type LayerInternals = HTMLElement & {
    data: VisualizationData;
    selectedProteinIds: string[];
    filtersActive: boolean;
    filteredProteinIds: string[];
    _isolationHistory: string[][];
    _plotData: PlotData;
    _processData(): void;
    _buildPointGridIndex(): void;
    isolateSelection(): void;
    getCurrentData(): VisualizationData | null;
  };

  function makeEl(): LayerInternals {
    const ids = ['p0', 'p1', 'p2', 'p3', 'p4', 'p5'];
    const el = document.createElement('protspace-scatterplot') as LayerInternals;
    el.data = {
      protein_ids: ids,
      projections: [{ name: 'proj', dimension: 2, data: new Float32Array(12) }],
      annotations: {
        cat: { kind: 'categorical', values: ['A'], colors: ['#000000'], shapes: ['circle'] },
      },
      annotation_data: { cat: new Int32Array(6) },
    };
    el._plotData = {
      length: 6,
      xs: new Float32Array(6),
      ys: new Float32Array(6),
      zs: null,
      originalIndices: null,
      proteinIds: ids,
    };
    vi.spyOn(el, '_processData').mockImplementation(() => {});
    vi.spyOn(el, '_buildPointGridIndex').mockImplementation(() => {});
    return el;
  }

  it('keeps only selected ids in the current view, in selection order', () => {
    const el = makeEl();
    el.filtersActive = true;
    el.filteredProteinIds = ['p0', 'p1', 'p2', 'p3', 'p4'];
    el.selectedProteinIds = ['p4', 'unknown', 'p1', 'p5', 'p2'];
    el.isolateSelection();
    expect(el._isolationHistory).toEqual([['p4', 'p1', 'p2']]);

    // Nested: p2 and p4 are in the isolation, p0 is not.
    el.selectedProteinIds = ['p0', 'p4', 'p2'];
    el.isolateSelection();
    expect(el._isolationHistory).toEqual([
      ['p4', 'p1', 'p2'],
      ['p4', 'p2'],
    ]);
    expect(el.getCurrentData()?.protein_ids).toEqual(['p2', 'p4']);
  });

  it('adds no layer when no selected id is in the current view', () => {
    const el = makeEl();
    el.selectedProteinIds = ['p1'];
    el.isolateSelection();
    el.selectedProteinIds = ['p0', 'unknown'];
    el.isolateSelection();
    expect(el._isolationHistory).toEqual([['p1']]);
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
    _webglRenderer?: {
      invalidatePositionCache(): void;
      invalidateStyleCache(): void;
    };
    _processData(): void;
    _buildPointGridIndex(): void;
    _renderPlot(): void;
    _flushRender(): void;
    isolateSelection(): void;
    resetIsolation(): void;
    resetZoom(): void;
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
  // and WebGL never fire — _webglRenderer stays undefined unless a test installs
  // a fake one, so these exercise the `if (this._webglRenderer)` false branch.
  function instrument(el: RefreshInternals) {
    const calls: string[] = [];
    vi.spyOn(el, '_processData').mockImplementation(() => calls.push('processData'));
    vi.spyOn(el, '_buildPointGridIndex').mockImplementation(() =>
      calls.push('buildPointGridIndex'),
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

  it('isolateSelection runs processData → buildPointGridIndex → requestUpdate, then requests renderPlot', async () => {
    const el = makeEl();
    el.selectedProteinIds = ['p1', 'p3'];
    const { calls, requestUpdate } = instrument(el);

    el.isolateSelection();

    // Synchronous portion: process + point index happen before requestUpdate; render is deferred.
    expect(calls).toEqual(['processData', 'buildPointGridIndex']);
    expect(requestUpdate).toHaveBeenCalled();

    // The settled update requests the render; flushing draws it without a frame.
    await el.updateComplete;
    el._flushRender();
    expect(calls).toEqual(['processData', 'buildPointGridIndex', 'renderPlot']);
  });

  it('resetIsolation nulls _plotDataBuild BEFORE reprocess, then runs the same refresh sequence', async () => {
    const el = makeEl();
    el._isolationMode = true;
    el._isolationHistory = [['p1', 'p3']];
    el._plotDataBuild = { stale: true };
    const { calls, requestUpdate } = instrument(el);
    // Capture _plotDataBuild at the moment _processData is (re)invoked.
    let buildAtProcess: unknown = 'unset';
    (
      el._processData as unknown as { mockImplementation: (f: () => void) => void }
    ).mockImplementation(() => {
      buildAtProcess = el._plotDataBuild;
      calls.push('processData');
    });

    el.resetIsolation();

    // Divergence preserved: cleared before the shared refresh block runs.
    expect(buildAtProcess).toBeNull();
    expect(calls).toEqual(['processData', 'buildPointGridIndex']);
    expect(requestUpdate).toHaveBeenCalled();

    // The settled update requests the render; flushing draws it without a frame.
    await el.updateComplete;
    el._flushRender();
    expect(calls).toEqual(['processData', 'buildPointGridIndex', 'renderPlot']);
  });

  it.each([
    [
      'isolateSelection',
      (el: RefreshInternals) => {
        el.selectedProteinIds = ['p1', 'p3'];
        el.isolateSelection();
      },
    ],
    [
      'resetIsolation',
      (el: RefreshInternals) => {
        el._isolationMode = true;
        el._isolationHistory = [['p1', 'p3']];
        el.resetIsolation();
      },
    ],
  ])('%s invalidates the WebGL caches before the deferred render', async (_name, act) => {
    const el = makeEl();
    const { calls } = instrument(el);
    el._webglRenderer = {
      invalidatePositionCache: vi.fn(() => calls.push('invalidatePositionCache')),
      invalidateStyleCache: vi.fn(() => calls.push('invalidateStyleCache')),
    };

    act(el);

    const refresh = [
      'processData',
      'buildPointGridIndex',
      'invalidatePositionCache',
      'invalidateStyleCache',
    ];
    expect(calls).toEqual(refresh);
    await el.updateComplete;
    // The render waits for the next frame.
    el._flushRender();
    expect(calls).toEqual([...refresh, 'renderPlot']);
  });

  // #297: zooming into a region and then isolating should snap back to the full
  // view of the isolated subset, not keep the stale pre-isolation zoom transform.
  it('isolateSelection resets the zoom to the full view', () => {
    const el = makeEl();
    el.selectedProteinIds = ['p1', 'p3'];
    const resetZoom = vi.spyOn(el, 'resetZoom');

    el.isolateSelection();

    expect(resetZoom).toHaveBeenCalledTimes(1);
  });

  it('does not reset the zoom when isolateSelection bails (no valid selection)', () => {
    const el = makeEl();
    el.selectedProteinIds = [];
    const resetZoom = vi.spyOn(el, 'resetZoom');

    el.isolateSelection();

    expect(resetZoom).not.toHaveBeenCalled();
  });

  // Symmetry with isolateSelection: exiting isolation restores the full dataset,
  // so the view should also snap back to the full extent (#297).
  it('resetIsolation resets the zoom to the full view', () => {
    const el = makeEl();
    el._isolationMode = true;
    el._isolationHistory = [['p1', 'p3']];
    const resetZoom = vi.spyOn(el, 'resetZoom');

    el.resetIsolation();

    expect(resetZoom).toHaveBeenCalledTimes(1);
  });
});

describe('scatter-plot full view kept across a cull', () => {
  type FullViewInternals = HTMLElement & {
    data: VisualizationData;
    selectedAnnotation: string;
    selectedProjectionIndex: number;
    selectedProteinIds: string[];
    filtersActive: boolean;
    filteredProteinIds: string[];
    _plotData: PlotData;
    _pointGridIndex: unknown;
    _processData(): void;
    _buildPointGridIndex(): void;
    isolateSelection(): void;
    resetIsolation(): void;
    resetZoom(): void;
  };

  function makeEl(): FullViewInternals {
    const el = document.createElement('protspace-scatterplot') as FullViewInternals;
    el.data = {
      protein_ids: ['p0', 'p1', 'p2', 'p3'],
      projections: [
        { name: 'a', dimension: 2, data: new Float32Array([0, 0, 1, 1, 2, 2, 3, 3]) },
        { name: 'b', dimension: 2, data: new Float32Array([3, 3, 2, 2, 1, 1, 0, 0]) },
      ],
      annotations: {
        cat: { kind: 'categorical', values: ['A'], colors: ['#000000'], shapes: ['circle'] },
      },
      annotation_data: { cat: new Int32Array(4) },
    };
    el.selectedAnnotation = 'cat';
    el.selectedProjectionIndex = 0;
    vi.spyOn(el, 'resetZoom').mockImplementation(() => {});
    el._processData();
    el._buildPointGridIndex();
    return el;
  }

  function isolate(el: FullViewInternals, ids: string[]) {
    el.selectedProteinIds = ids;
    el.isolateSelection();
  }

  it('swaps the full plot data and point grid back on reset, through nested isolation', () => {
    const el = makeEl();
    const full = el._plotData;
    const grid = el._pointGridIndex;
    const rebuild = vi.spyOn(DataProcessor, 'processVisualizationData');

    isolate(el, ['p1', 'p2', 'p3']);
    isolate(el, ['p2']);
    expect(el._plotData.length).toBe(1);
    expect(el._pointGridIndex).not.toBe(grid);
    rebuild.mockClear();
    const reindex = vi.spyOn(grid as { rebuild(): void }, 'rebuild');

    el.resetIsolation();
    expect(el._plotData).toBe(full);
    expect(el._pointGridIndex).toBe(grid);
    expect(rebuild).not.toHaveBeenCalled();
    expect(reindex).not.toHaveBeenCalled();
    rebuild.mockRestore();
  });

  it('swaps the full view back when a query filter clears', () => {
    const el = makeEl();
    const full = el._plotData;
    el.filtersActive = true;
    el.filteredProteinIds = ['p0'];
    el._processData();
    expect(el._plotData.length).toBe(1);

    el.filtersActive = false;
    el.filteredProteinIds = [];
    el._processData();
    expect(el._plotData).toBe(full);
  });

  it('rebuilds when the projection changed during the isolation', () => {
    const el = makeEl();
    const full = el._plotData;
    isolate(el, ['p1', 'p2']);
    el.selectedProjectionIndex = 1;
    el._processData();

    el.resetIsolation();
    expect(el._plotData).not.toBe(full);
    expect(Array.from(el._plotData.xs)).toEqual([3, 2, 1, 0]);
  });
});
