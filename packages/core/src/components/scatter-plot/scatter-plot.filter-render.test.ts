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
import type { PlotDataPoint, VisualizationData } from '@protspace/utils';

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

type ScatterplotInternals = HTMLElement & {
  data: VisualizationData;
  selectedAnnotation: string;
  filteredProteinIds: string[];
  filtersActive: boolean;
  hiddenAnnotationValues: string[];
  _plotData: PlotDataPoint[];
  _processData(): void;
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
  return {
    protein_ids: families.map((_, i) => `p${i}`),
    projections: [{ name: 'umap', data: families.map((_, i) => [i, i]) }],
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
  return {
    protein_ids: families.map((_, i) => `q${i}`),
    projections: [{ name: 'umap', data: families.map((_, i) => [i * 2, i * 2]) }],
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

    expect(sp._plotData.map((p) => p.id).sort()).toEqual(['p3', 'p4', 'p5']);

    // Every kept point is family B → must be green, not the colour of the
    // protein sitting at the same slice-local position in the full dataset.
    for (const point of sp._plotData) {
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
    for (const point of prefix._plotData) {
      expect(prefixGetters.getColors(point)).toEqual([RED]);
    }

    // No filter at all — full plot, both families correct.
    const full = makeScatter();
    full._processData();
    const fullGetters = full._buildStyleGetters();
    const colorById = new Map(full._plotData.map((p) => [p.id, fullGetters.getColors(p)]));
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
    expect(sp._plotData.map((p) => p.id).sort()).toEqual(['p1', 'p3']);
  });

  it('hidden-value point (family B) has opacity 0; visible-value point (family A) has opacity > 0', () => {
    const { sp, getters } = buildFinalState('filter-first');
    const byId = new Map(sp._plotData.map((p) => [p.id, p]));
    // p3 is family B which is hidden → opacity must be 0
    expect(getters.getOpacity(byId.get('p3')!)).toBe(0);
    // p1 is family A which is not hidden → opacity must be positive
    expect(getters.getOpacity(byId.get('p1')!)).toBeGreaterThan(0);
  });

  it('end-state _plotData ids are identical regardless of assignment order', () => {
    const { sp: spA } = buildFinalState('filter-first');
    const { sp: spB } = buildFinalState('hide-first');
    expect(spA._plotData.map((p) => p.id).sort()).toEqual(spB._plotData.map((p) => p.id).sort());
  });

  it('end-state per-point opacities are identical regardless of assignment order', () => {
    const { sp: spA, getters: gA } = buildFinalState('filter-first');
    const { sp: spB, getters: gB } = buildFinalState('hide-first');

    const idsA = spA._plotData.map((p) => p.id).sort();
    for (const id of idsA) {
      const pA = spA._plotData.find((p) => p.id === id)!;
      const pB = spB._plotData.find((p) => p.id === id)!;
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
    expect(sp._plotData.map((p) => p.id).sort()).toEqual(['p3', 'p4', 'p5']);

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
    expect(sp._plotData.map((p) => p.id).sort()).toEqual(['p0', 'p1', 'p2', 'p3', 'p4', 'p5']);
  });
});

describe('scatter-plot dataset-swap clears stale query filter', () => {
  it('updated() on data swap resets filtersActive and filteredProteinIds before _processData', () => {
    const sp = makeScatter(); // dataset 1 (p0–p5), fam annotation

    // Establish an active filter on dataset 1.
    sp.filteredProteinIds = ['p1', 'p3'];
    sp.filtersActive = true;
    sp._processData();
    expect(sp._plotData.map((p) => p.id).sort()).toEqual(['p1', 'p3']);

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
    expect(sp._plotData.map((p) => p.id).sort()).toEqual(['q0', 'q1', 'q2', 'q3', 'q4', 'q5']);
  });
});
