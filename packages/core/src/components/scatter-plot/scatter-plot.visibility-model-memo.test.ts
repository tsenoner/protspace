// @vitest-environment jsdom
/**
 * F-27 characterization LOCK — `_getVisibilityModel` 8-field memo key.
 *
 * `_getVisibilityModel` (scatter-plot.ts L2073-2124) caches one VisibilityModel
 * instance keyed by reference/value identity on 8 inputs:
 *   data, selectedAnnotation, hiddenAnnotationValues, selectedProteinIds,
 *   highlightedProteinIds, baseOpacity, selectedOpacity, fadedOpacity.
 * (read L2088-2095, store L2113-2122).
 *
 * Leave every key field unchanged -> cache HIT (same model instance).
 * Flip ANY one field to a new reference/value -> cache MISS (fresh model).
 * This catches a missing or extra key field introduced by any B6/B8/B10 refactor.
 *
 * The element is created via createElement WITHOUT being appended (mirrors the
 * neighbor locks scatter-plot.materialize-cache.test.ts / filter-render): Lit's
 * connectedCallback + reactive update cycle never run, so we drive the component
 * by setting public reactive props directly and calling the internal methods.
 *
 * NAME ADJUSTMENTS vs the plan sketch (assertions unchanged):
 *  - Real VisualizationData uses `annotations` + `annotation_data` (index arrays),
 *    NOT `features`/`feature_data`; projections carry `dimension`, not
 *    `metadata.dimensions`. Fixture mirrors makeFamilyData in the
 *    scatter-plot.materialize-cache.test.ts neighbor, with a 2nd `other`
 *    annotation so the selectedAnnotation flip is legal.
 *  - selectedAnnotation flip targets the real 2nd annotation `'other'` (not 'fam2').
 *  - The 3 opacity fields are read from `this._mergedConfig` (L2080-2082). On an
 *    unattached element Lit's `updated()` lifecycle — where `config` is merged
 *    into `_mergedConfig` (L610-612) — never runs, so a synchronous `config`
 *    write would NOT change `_mergedConfig` and the flip would not be observable.
 *    We therefore flip `_mergedConfig` directly: it IS the genuine memo-key
 *    source the getter reads, so the assertion (MISS on change) is unchanged.
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
  hiddenAnnotationValues: string[];
  selectedProteinIds: string[];
  highlightedProteinIds: string[];
  _mergedConfig: { baseOpacity: number; selectedOpacity: number; fadedOpacity: number };
  _processData(): void;
  _getVisibilityModel(): object;
};

const RED = '#ff0000';
const GREEN = '#00ff00';

/**
 * Categorical fixture: p0–p2 family "A", p3–p5 family "B", plus a second
 * categorical annotation `other` so the selectedAnnotation flip is legal.
 * Shape mirrors makeFamilyData in scatter-plot.materialize-cache.test.ts.
 */
function famData(): VisualizationData {
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
      other: {
        values: families,
        colors: families.map(colorFor),
        shapes: families.map(() => 'circle'),
      },
    },
    annotation_data: {
      fam: families.map((v) => [families.indexOf(v)]),
      other: families.map((v) => [families.indexOf(v)]),
    },
  } as unknown as VisualizationData;
}

describe('_getVisibilityModel memo key (F-27 characterization lock)', () => {
  function primed(): Internals {
    const sp = document.createElement('protspace-scatterplot') as Internals;
    sp.data = famData();
    sp.selectedAnnotation = 'fam';
    sp.hiddenAnnotationValues = [];
    sp.selectedProteinIds = [];
    sp.highlightedProteinIds = [];
    sp._processData();
    return sp;
  }

  it('no input change → cache HIT (same model instance)', () => {
    const sp = primed();
    expect(sp._getVisibilityModel()).toBe(sp._getVisibilityModel());
  });

  // Each key field, when flipped to a NEW reference/value, must produce a cache MISS.
  const flips: Array<[string, (sp: Internals) => void]> = [
    [
      'hiddenAnnotationValues',
      (sp) => {
        sp.hiddenAnnotationValues = ['A'];
      },
    ],
    [
      'selectedProteinIds',
      (sp) => {
        sp.selectedProteinIds = ['p0'];
      },
    ],
    [
      'highlightedProteinIds',
      (sp) => {
        sp.highlightedProteinIds = ['p1'];
      },
    ],
    [
      'selectedAnnotation',
      (sp) => {
        sp.selectedAnnotation = 'other';
      },
    ],
    [
      'baseOpacity',
      (sp) => {
        sp._mergedConfig = { ...sp._mergedConfig, baseOpacity: 0.5 };
      },
    ],
    [
      'selectedOpacity',
      (sp) => {
        sp._mergedConfig = { ...sp._mergedConfig, selectedOpacity: 0.9 };
      },
    ],
    [
      'fadedOpacity',
      (sp) => {
        sp._mergedConfig = { ...sp._mergedConfig, fadedOpacity: 0.1 };
      },
    ],
  ];

  for (const [field, flip] of flips) {
    it(`flipping ${field} → cache MISS (fresh model)`, () => {
      const sp = primed();
      const before = sp._getVisibilityModel();
      flip(sp);
      expect(sp._getVisibilityModel()).not.toBe(before);
    });
  }
});
