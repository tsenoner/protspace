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
  _plotData: PlotDataPoint[];
  _processData(): void;
  _buildStyleGetters(): { getColors(point: PlotDataPoint): string[] };
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

describe('scatter-plot query-filter rendering integrity', () => {
  it('colours a non-prefix filtered subset by each point’s OWN value', () => {
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
