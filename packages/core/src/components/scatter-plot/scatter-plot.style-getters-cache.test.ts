// @vitest-environment jsdom
/**
 * F-26 characterization lock — `_styleGettersCache` invalidation lifecycle.
 *
 * `_getStyleGetters` (scatter-plot.ts L2241) rebuilds the cached getters ONLY
 * when `_styleGettersCache` is null. The documented invalidation entry points
 * null it:
 *   - `_handleColorMappingChange` (L499)  — legend color/shape mapping change
 *   - `_handleZOrderChange`        (L481)  — legend z-order change
 *   - `_refreshSelectedAnnotationValues` (L826) — selected-annotation switch
 *
 * NOTE (plan B7/F-26): `_processData` itself does NOT null `_styleGettersCache`
 * (verified against the unmodified tree — the only nullers are L481/499/826/1168).
 * The audit cites L826 in `_refreshSelectedAnnotationValues`, so the
 * selected-annotation case is driven through that real nulling path rather than
 * through `_processData`.
 *
 * The lock asserts: while nothing invalidates, repeat `_getStyleGetters()`
 * returns the SAME instance; each documented entry point yields a FRESH one.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import type { VisualizationData } from '@protspace/utils';

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

type Internals = HTMLElement & {
  data: VisualizationData;
  selectedAnnotation: string;
  _processData(): void;
  _refreshSelectedAnnotationValues(dataToUse: VisualizationData): void;
  _getStyleGetters(): object;
  _handleColorMappingChange(e: Event): void;
};

/**
 * Categorical fixture mirroring the real VisualizationData shape used by the
 * neighbor locks (scatter-plot.materialize-cache.test.ts): `annotations` /
 * `annotation_data` (NOT `features`/`feature_data`), projection `dimension: 2`.
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
    },
    annotation_data: {
      fam: families.map((v) => [families.indexOf(v)]),
    },
  } as unknown as VisualizationData;
}

describe('_styleGettersCache invalidation lifecycle (F-26 characterization lock)', () => {
  function primed(): Internals {
    const sp = document.createElement('protspace-scatterplot') as Internals;
    sp.data = famData();
    sp.selectedAnnotation = 'fam';
    sp._processData();
    return sp;
  }

  it('repeat _getStyleGetters() returns the SAME instance while nothing invalidates', () => {
    const sp = primed();
    expect(sp._getStyleGetters()).toBe(sp._getStyleGetters());
  });

  it('a colormapping change forces a FRESH getter instance', () => {
    const sp = primed();
    const before = sp._getStyleGetters();
    sp._handleColorMappingChange(
      new CustomEvent('legend-colormapping-change', {
        detail: { colorMapping: { A: '#00f', B: '#0f0' }, shapeMapping: {}, colorOnly: true },
      }),
    );
    expect(sp._getStyleGetters()).not.toBe(before);
  });

  it('a selectedAnnotation refresh (via _refreshSelectedAnnotationValues) forces a fresh getter instance', () => {
    const sp = primed();
    const before = sp._getStyleGetters();
    // _processData does NOT null the cache; the real nulling path for a
    // selected-annotation switch is _refreshSelectedAnnotationValues (L826).
    sp._refreshSelectedAnnotationValues(sp.data);
    expect(sp._getStyleGetters()).not.toBe(before);
  });
});
