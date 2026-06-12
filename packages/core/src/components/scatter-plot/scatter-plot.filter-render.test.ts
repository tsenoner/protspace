/**
 * @vitest-environment jsdom
 *
 * Rendering-integrity regression for the query-filter channel (#257 follow-up).
 *
 * When a query filter is active, the scatter plot builds `_plotData` from the
 * matched subset. Each PlotDataPoint.originalIndex MUST still address the full
 * dataset, because the style getters (colors/shape/opacity) and the tooltip
 * path resolve annotation values against the full data by that index — exactly
 * as the isolation path already does. If a filter renumbers originalIndex to a
 * slice-local 0..N-1, then a non-prefix filter (one that drops earlier proteins)
 * paints kept points with the WRONG protein's colour and can even hide them.
 *
 * Construct the element via createElement without appending it (so Lit's
 * connectedCallback / WebGL init never runs — same approach as
 * scatter-plot.isolation.test.ts) and drive _processData directly.
 */
import { vi, describe, it, expect } from 'vitest';
import type { PlotData, PlotDataPoint, VisualizationData } from '@protspace/utils';
import { plotDataId, materializePlotDataPoint } from '@protspace/utils';

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

const RED = '#ff0000';
const GREEN = '#00ff00';

/** Slot-materialized ids of a SoA PlotData container. */
function plotIds(pd: PlotData): string[] {
  return Array.from({ length: pd.length }, (_, s) => plotDataId(pd, s));
}

/** Slot-materialized PlotDataPoints of a SoA PlotData container. */
function plotPoints(pd: PlotData): PlotDataPoint[] {
  return Array.from({ length: pd.length }, (_, s) => materializePlotDataPoint(pd, s));
}

type ScatterplotInternals = HTMLElement & {
  data: VisualizationData;
  selectedAnnotation: string;
  filteredProteinIds: string[];
  filtersActive: boolean;
  hiddenAnnotationValues: string[];
  selectedProteinIds: string[];
  _plotData: PlotData;
  _processData(): void;
  _getVisiblePointCount(): number;
  _buildStyleGetters(): {
    getColors(point: PlotDataPoint): string[];
    getOpacity(point: PlotDataPoint): number;
  };
  updated(changedProperties: Map<string, unknown>): void;
};

/**
 * Six proteins. p0–p2 are family "A" (red), p3–p5 are family "B" (green).
 * annotation_data rows hold an index into `annotations.fam.values`, and
 * valueToColor is derived from values↔colors positionally, so A→red, B→green.
 */
function makeFamilyData(): VisualizationData {
  const families = ['A', 'A', 'A', 'B', 'B', 'B'];
  const colorFor = (v: string) => (v === 'A' ? RED : GREEN);
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
      // each row points at the first index of its family value in `values`
      fam: families.map((v) => [families.indexOf(v)]),
    },
  } as unknown as VisualizationData;
}

function makeScatter(): ScatterplotInternals {
  const sp = document.createElement('protspace-scatterplot') as ScatterplotInternals;
  sp.data = makeFamilyData();
  sp.selectedAnnotation = 'fam';
  return sp;
}

/**
 * Dataset 2 for swap tests. Protein ids are 'q*' so they cannot overlap a
 * stale filter that references 'p1' / 'p3'. The 'fam' annotation is preserved
 * so selectedAnnotation stays valid across the swap.
 */
function makeDataset2(): VisualizationData {
  const families = ['C', 'C', 'C', 'D', 'D', 'D'];
  const coords = new Float32Array(families.length * 2);
  families.forEach((_, i) => {
    coords[i * 2] = i * 2;
    coords[i * 2 + 1] = i * 2;
  });
  return {
    protein_ids: families.map((_, i) => `q${i}`),
    projections: [{ name: 'umap', data: coords, dimension: 2 }],
    annotations: {
      fam: {
        values: families,
        colors: families.map((v) => (v === 'C' ? '#0000ff' : '#ffff00')),
        shapes: families.map(() => 'circle'),
      },
    },
    annotation_data: {
      fam: families.map((v) => [families.indexOf(v)]),
    },
  } as unknown as VisualizationData;
}

describe('scatter-plot query-filter rendering integrity', () => {
  it("colours a non-prefix filtered subset by each point's OWN value", () => {
    const sp = makeScatter();
    // Keep only family B — a non-prefix subset (drops p0–p2).
    sp.filteredProteinIds = ['p3', 'p4', 'p5'];
    sp.filtersActive = true;

    sp._processData();
    const getters = sp._buildStyleGetters();

    expect(plotIds(sp._plotData).sort()).toEqual(['p3', 'p4', 'p5']);

    // Every kept point is family B → must be green, not the colour of the
    // protein sitting at the same slice-local position in the full dataset.
    for (const point of plotPoints(sp._plotData)) {
      expect(getters.getColors(point)).toEqual([GREEN]);
    }
  });

  it('still colours a prefix filter and the unfiltered plot correctly', () => {
    // Prefix subset (p0–p2, family A) — happens to work even with the bug, so
    // this guards against an over-correction that breaks the easy case.
    const prefix = makeScatter();
    prefix.filteredProteinIds = ['p0', 'p1', 'p2'];
    prefix.filtersActive = true;
    prefix._processData();
    const prefixGetters = prefix._buildStyleGetters();
    for (const point of plotPoints(prefix._plotData)) {
      expect(prefixGetters.getColors(point)).toEqual([RED]);
    }

    // No filter at all — full plot, both families correct.
    const full = makeScatter();
    full._processData();
    const fullGetters = full._buildStyleGetters();
    const colorById = new Map(
      plotPoints(full._plotData).map((p) => [p.id, fullGetters.getColors(p)]),
    );
    expect(colorById.get('p0')).toEqual([RED]);
    expect(colorById.get('p5')).toEqual([GREEN]);
  });
});

// ---------------------------------------------------------------------------
// Task 1.7 — Order-independence of query filter × legend hide
//
// The filter channel (_processData / filteredProteinIds) and the legend hide
// channel (hiddenAnnotationValues / _buildStyleGetters) are orthogonal:
//   • filter determines which points land in _plotData
//   • hide sets opacity to 0 for matching points but never culls them
//
// The final _plotData ids and per-point opacities must be identical regardless
// of which channel is configured first.
// ---------------------------------------------------------------------------
describe('scatter-plot filter × hide order-independence', () => {
  // p1 = family A (red, visible), p3 = family B (green, will be hidden)
  const FILTER_IDS = ['p1', 'p3'];
  const HIDDEN_VALUES = ['B'];

  /**
   * Returns _plotData and style-getters after bringing the element to the
   * same end state via two different assignment orderings.
   */
  function buildFinalState(order: 'filter-first' | 'hide-first') {
    const sp = makeScatter(); // data + selectedAnnotation already set
    if (order === 'filter-first') {
      // Scenario A: establish filter → process → then hide
      sp.filteredProteinIds = [...FILTER_IDS];
      sp.filtersActive = true;
      sp._processData();
      sp.hiddenAnnotationValues = [...HIDDEN_VALUES];
    } else {
      // Scenario B: hide first → then establish filter → process
      sp.hiddenAnnotationValues = [...HIDDEN_VALUES];
      sp.filteredProteinIds = [...FILTER_IDS];
      sp.filtersActive = true;
      sp._processData();
    }
    const getters = sp._buildStyleGetters();
    return { sp, getters };
  }

  it('_plotData contains exactly the query-matched ids; hidden-value points are NOT culled', () => {
    const { sp } = buildFinalState('filter-first');
    // Both p1 (A) and p3 (B) must appear — hiding B does not remove it from _plotData.
    expect(plotIds(sp._plotData).sort()).toEqual(['p1', 'p3']);
  });

  it('hidden-value point (family B) has opacity 0; visible-value point (family A) has opacity > 0', () => {
    const { sp, getters } = buildFinalState('filter-first');
    const byId = new Map(plotPoints(sp._plotData).map((p) => [p.id, p]));
    // p3 is family B which is hidden → opacity must be 0
    expect(getters.getOpacity(byId.get('p3')!)).toBe(0);
    // p1 is family A which is not hidden → opacity must be positive
    expect(getters.getOpacity(byId.get('p1')!)).toBeGreaterThan(0);
  });

  it('end-state _plotData ids are identical regardless of assignment order', () => {
    const { sp: spA } = buildFinalState('filter-first');
    const { sp: spB } = buildFinalState('hide-first');
    expect(plotIds(spA._plotData).sort()).toEqual(plotIds(spB._plotData).sort());
  });

  it('end-state per-point opacities are identical regardless of assignment order', () => {
    const { sp: spA, getters: gA } = buildFinalState('filter-first');
    const { sp: spB, getters: gB } = buildFinalState('hide-first');

    const pointsA = plotPoints(spA._plotData);
    const pointsB = plotPoints(spB._plotData);
    for (const pA of pointsA) {
      const pB = pointsB.find((p) => p.id === pA.id)!;
      expect(gA.getOpacity(pA)).toBe(gB.getOpacity(pB));
    }
  });
});

// ---------------------------------------------------------------------------
// Task 1.8 — Dataset swap clears the filter channel before _processData runs
//
// updated() lines 454-457: when changedProperties has 'data' and filtersActive
// is true, it synchronously clears filteredProteinIds / filtersActive BEFORE
// _processData runs. This prevents a stale id-set from the previous dataset
// from blanking the new plot.
//
// On an unattached element the Lit lifecycle never auto-runs, so we simulate
// the lifecycle by calling updated() directly.
// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
// Reset All regression — clearing an active filter must rebuild _plotData
//
// Bug: "Reset All" in the query builder clears filteredProteinIds/filtersActive,
// and the updated() pass re-runs _processData. But the coordinate-only fast
// path's guard reads the NEW filtersActive (already false) instead of asking
// whether the current _plotData was BUILT culled, so the culled points were
// never restored: the legend (fed from getCurrentData()) showed everything
// while the canvas kept rendering the filtered subset.
// ---------------------------------------------------------------------------
describe('scatter-plot query-filter clear restores the full plot', () => {
  it('clearing an active filter via updated() rebuilds _plotData with all proteins', () => {
    const sp = makeScatter();

    // Apply a filter (control-bar query-apply path) and run the lifecycle.
    sp.filteredProteinIds = ['p3', 'p4', 'p5'];
    sp.filtersActive = true;
    sp.updated(
      new Map<string, unknown>([
        ['filteredProteinIds', []],
        ['filtersActive', false],
      ]),
    );
    expect(plotIds(sp._plotData).sort()).toEqual(['p3', 'p4', 'p5']);

    // Reset All (control-bar query-reset path): clear the channel, lifecycle runs.
    sp.filteredProteinIds = [];
    sp.filtersActive = false;
    sp.updated(
      new Map<string, unknown>([
        ['filteredProteinIds', ['p3', 'p4', 'p5']],
        ['filtersActive', true],
      ]),
    );

    // The full dataset must be back in _plotData — not just the old subset.
    expect(plotIds(sp._plotData).sort()).toEqual(['p0', 'p1', 'p2', 'p3', 'p4', 'p5']);
  });
});

// ---------------------------------------------------------------------------
// Bottom-left point-count indicator — _getVisiblePointCount
//
// The indicator must always show the number of points actually visible in the
// chart, across ALL visibility channels combined:
//   • query filter / isolation physically cull _plotData
//   • legend hide leaves points in _plotData at opacity 0 (alpha layer)
// So the count is |non-hidden points of _plotData| per the visibility model.
// Selection only fades points (they stay visible) — it must NOT change the count.
// ---------------------------------------------------------------------------
describe('scatter-plot visible point count', () => {
  it('counts the full dataset when nothing is filtered or hidden', () => {
    const sp = makeScatter();
    sp._processData();
    expect(sp._getVisiblePointCount()).toBe(6);
  });

  it('excludes legend-hidden values from the count', () => {
    const sp = makeScatter();
    sp._processData();
    sp.hiddenAnnotationValues = ['B']; // p3–p5 hidden, alpha=0, still in _plotData
    expect(sp._plotData.length).toBe(6);
    expect(sp._getVisiblePointCount()).toBe(3);
  });

  it('combines query filter (physical cull) with legend hide (alpha)', () => {
    const sp = makeScatter();
    sp.filteredProteinIds = ['p1', 'p3'];
    sp.filtersActive = true;
    sp._processData(); // _plotData = [p1 (A), p3 (B)]
    expect(sp._getVisiblePointCount()).toBe(2);
    sp.hiddenAnnotationValues = ['B']; // p3 hidden
    expect(sp._getVisiblePointCount()).toBe(1);
  });

  it('matches the all-hidden escape hatch: hiding every value shows everything', () => {
    const sp = makeScatter();
    sp._processData();
    sp.hiddenAnnotationValues = ['A', 'B'];
    // computeAllHidden fires → no hidden filter → all 6 points render.
    expect(sp._getVisiblePointCount()).toBe(6);
  });

  it('does not change when points are merely faded by a selection', () => {
    const sp = makeScatter();
    sp._processData();
    sp.selectedProteinIds = ['p0'];
    expect(sp._getVisiblePointCount()).toBe(6);
  });

  it('recounts after the hidden set changes (memo invalidation)', () => {
    const sp = makeScatter();
    sp._processData();
    expect(sp._getVisiblePointCount()).toBe(6);
    sp.hiddenAnnotationValues = ['A'];
    expect(sp._getVisiblePointCount()).toBe(3);
    sp.hiddenAnnotationValues = [];
    expect(sp._getVisiblePointCount()).toBe(6);
  });
});

describe('scatter-plot dataset-swap clears stale query filter', () => {
  it('updated() on data swap resets filtersActive and filteredProteinIds before _processData', () => {
    const sp = makeScatter(); // dataset 1 (p0–p5), fam annotation

    // Establish an active filter on dataset 1.
    sp.filteredProteinIds = ['p1', 'p3'];
    sp.filtersActive = true;
    sp._processData();
    expect(plotIds(sp._plotData).sort()).toEqual(['p1', 'p3']);

    // Swap to dataset 2 (q0–q5). None of its ids overlap the stale filter.
    const oldData = sp.data;
    const dataset2 = makeDataset2();
    sp.data = dataset2;

    // Simulate the Lit updated() lifecycle pass with 'data' in changedProperties.
    // updated() must clear filteredProteinIds / filtersActive synchronously, then
    // call _processData() so the new _plotData covers all of dataset 2.
    sp.updated(new Map([['data', oldData]]));

    // Filter channel must be cleared.
    expect(sp.filtersActive).toBe(false);
    expect(sp.filteredProteinIds).toEqual([]);

    // All dataset-2 proteins must appear — stale filter must not blank the plot.
    expect(plotIds(sp._plotData).sort()).toEqual(['q0', 'q1', 'q2', 'q3', 'q4', 'q5']);
  });
});
