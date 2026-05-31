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
