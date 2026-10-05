// @vitest-environment jsdom
/**
 * Characterization lock — the style getters cache invalidation lifecycle.
 *
 * `PointStyleState.getters()` (the host's `_style`) rebuilds the cached getters
 * ONLY after `invalidateGetters()`. The documented entry points call it:
 *   - `_handleColorMappingChange`        — legend color/shape mapping change
 *   - `_handleZOrderChange`              — legend z-order change
 *   - `_refreshSelectedAnnotationValues` — selected-annotation switch
 *
 * NOTE: `_processData` itself does NOT invalidate the getters,
 * so the selected-annotation case is driven through the real nulling path in
 * `_refreshSelectedAnnotationValues` rather than through `_processData`.
 *
 * The lock asserts: while nothing invalidates, repeat `_style.getters()`
 * returns the SAME instance (the memo is a perf contract, so identity is the
 * only observable there); each entry point yields a FRESH instance whose
 * getters return the NEW style, so a rebuild over stale inputs fails too.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import type { PlotDataPoint, VisualizationData } from '@protspace/utils';

beforeAll(() => {
  if (!('ResizeObserver' in globalThis)) {
    (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    };
  }
});
import './scatter-plot';

type StyleGetters = {
  getColors(p: PlotDataPoint): string[];
  getDepth(p: PlotDataPoint): number;
};

type Internals = HTMLElement & {
  data: VisualizationData;
  selectedAnnotation: string;
  _processData(): void;
  _refreshSelectedAnnotationValues(dataToUse: VisualizationData): void;
  _style: { getters(): StyleGetters };
  _handleColorMappingChange(e: Event): void;
  _handleZOrderChange(e: Event): void;
};

/**
 * Categorical fixture mirroring the real VisualizationData shape used by the
 * neighbor locks (scatter-plot.materialize-cache.test.ts): `annotations` /
 * `annotation_data` (NOT `features`/`feature_data`), projection `dimension: 2`.
 * A second annotation `shade` with its own colors makes the annotation switch
 * observable through getColors.
 */
function famData(): VisualizationData {
  const families = ['A', 'A', 'B'];
  const colorFor = (v: string) => (v === 'A' ? '#f00' : '#0f0');
  return {
    protein_ids: ['p0', 'p1', 'p2'],
    projections: [{ name: 'umap', data: new Float32Array([0, 0, 1, 1, 2, 2]), dimension: 2 }],
    annotations: {
      fam: {
        values: families,
        colors: families.map(colorFor),
        shapes: families.map(() => 'circle'),
      },
      shade: {
        values: ['X', 'Y'],
        colors: ['#123456', '#abcdef'],
        shapes: ['circle', 'square'],
      },
    },
    annotation_data: {
      fam: families.map((v) => [families.indexOf(v)]),
      shade: [[1], [0], [1]],
    },
  } as unknown as VisualizationData;
}

const point = (i: number): PlotDataPoint => ({ id: `p${i}`, x: i, y: i, originalIndex: i });

describe('style getters invalidation lifecycle (characterization lock)', () => {
  function primed(): Internals {
    const sp = document.createElement('protspace-scatterplot') as Internals;
    sp.data = famData();
    sp.selectedAnnotation = 'fam';
    sp._processData();
    return sp;
  }

  it('repeat _style.getters() returns the SAME instance while nothing invalidates', () => {
    const sp = primed();
    expect(sp._style.getters()).toBe(sp._style.getters());
  });

  it('a colormapping change forces fresh getters that return the new color', () => {
    const sp = primed();
    const before = sp._style.getters();
    expect(before.getColors(point(0))).toEqual(['#f00']);
    sp._handleColorMappingChange(
      new CustomEvent('legend-colormapping-change', {
        detail: { colorMapping: { A: '#00f', B: '#0f0' }, shapeMapping: {}, colorOnly: true },
      }),
    );
    const after = sp._style.getters();
    expect(after).not.toBe(before);
    expect(after.getColors(point(0))).toEqual(['#00f']);
  });

  it('a z-order change forces fresh getters that separate the reordered values', () => {
    const sp = primed();
    const before = sp._style.getters();
    expect(before.getDepth(point(0))).toBe(before.getDepth(point(2)));
    sp._handleZOrderChange(
      new CustomEvent('legend-zorder-change', { detail: { zOrderMapping: { A: 1, B: 0 } } }),
    );
    const after = sp._style.getters();
    expect(after).not.toBe(before);
    expect(after.getDepth(point(0))).not.toBe(after.getDepth(point(2)));
  });

  it('a selectedAnnotation refresh (via _refreshSelectedAnnotationValues) forces fresh getters on the new annotation', () => {
    const sp = primed();
    const before = sp._style.getters();
    // _processData does NOT null the cache; the real nulling path for a
    // selected-annotation switch is _refreshSelectedAnnotationValues.
    sp.selectedAnnotation = 'shade';
    sp._refreshSelectedAnnotationValues(sp.data);
    const after = sp._style.getters();
    expect(after).not.toBe(before);
    expect(after.getColors(point(0))).toEqual(['#abcdef']); // shade Y
    expect(after.getColors(point(1))).toEqual(['#123456']); // shade X
  });
});
