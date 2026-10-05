// @vitest-environment jsdom
/**
 * F-27 characterization LOCK — `_style.model()` memo key.
 *
 * `PointStyleState.model()` (the host's `_style`) caches one VisibilityModel instance keyed by
 * reference/value identity on the 10 fields of `VisibilityModelMemoKey`:
 *   data, selectedAnnotation, hiddenAnnotationValues, selectedProteinIds,
 *   highlightedProteinIds, baseOpacity, selectedOpacity, fadedOpacity,
 *   eatOverlayEnabled, focusedValues.
 *
 * Leave every key field unchanged -> cache HIT (same model instance; the memo
 * is a perf contract, so identity is the only observable there).
 * Flip ANY one field -> cache MISS, and the fresh model's `opacityOf` reflects
 * the flip, so a rebuild over stale inputs fails as well as a missing key.
 *
 * Note that `data` is the materialized display data, which is rebuilt when
 * `eatOverlayEnabled` flips, so that flip also misses through `data`.
 *
 * The element is created via createElement WITHOUT being appended (mirrors the
 * neighbor locks scatter-plot.materialize-cache.test.ts / filter-render): Lit's
 * connectedCallback + reactive update cycle never run, so we drive the component
 * by setting public reactive props directly and calling the internal methods.
 *
 * The 3 opacity fields are read from `this._mergedConfig`. On an unattached
 * element Lit's `updated()` lifecycle — where `config` is merged into
 * `_mergedConfig` — never runs, so a synchronous `config` write would NOT change
 * `_mergedConfig`. We therefore set `_mergedConfig` directly: it IS the genuine
 * memo-key source the getter reads.
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

type Opacities = { baseOpacity: number; selectedOpacity: number; fadedOpacity: number };

type Internals = HTMLElement & {
  data: VisualizationData;
  selectedAnnotation: string;
  hiddenAnnotationValues: string[];
  selectedProteinIds: string[];
  highlightedProteinIds: string[];
  eatOverlayEnabled: boolean;
  _focusedValues: string[] | null;
  _mergedConfig: Opacities;
  _processData(): void;
  _style: { model(): { opacityOf(p: PlotDataPoint): number } };
};

const BASE = 0.8;
const SELECTED = 1;
const FADED = 0.2;

/**
 * Categorical fixture: p0–p2 family "A", p3–p5 family "B", plus:
 *  - a second annotation `other` (X/Y) that does not use "A", so switching to
 *    it while "A" is hidden un-hides p0;
 *  - an EAT prediction of "A" for p3, applied only while the overlay is on.
 */
function famData(fam = [0, 0, 0, 1, 1, 1]): VisualizationData {
  const n = fam.length;
  const coords = new Float32Array(n * 2);
  for (let i = 0; i < n; i++) {
    coords[i * 2] = i;
    coords[i * 2 + 1] = i;
  }
  return {
    protein_ids: fam.map((_, i) => `p${i}`),
    projections: [{ name: 'umap', data: coords, dimension: 2 }],
    annotations: {
      fam: {
        kind: 'categorical',
        values: ['A', 'B'],
        colors: ['#ff0000', '#00ff00'],
        shapes: ['circle', 'circle'],
      },
      other: {
        kind: 'categorical',
        values: ['X', 'Y'],
        colors: ['#0000ff', '#ffff00'],
        shapes: ['circle', 'circle'],
      },
    },
    annotation_data: {
      fam: Int32Array.from(fam),
      other: Int32Array.from([1, 1, 1, 0, 0, 0]),
    },
    annotation_predicted: {
      fam: [null, null, null, { value: 'A' }, null, null],
    },
  } as unknown as VisualizationData;
}

const point = (i: number): PlotDataPoint => ({ id: `p${i}`, x: i, y: i, originalIndex: i });

describe('_style.model() memo key (F-27 characterization lock)', () => {
  function primed(): Internals {
    const sp = document.createElement('protspace-scatterplot') as Internals;
    sp.data = famData();
    sp.selectedAnnotation = 'fam';
    sp.hiddenAnnotationValues = [];
    sp.selectedProteinIds = [];
    sp.highlightedProteinIds = [];
    sp._mergedConfig = {
      ...sp._mergedConfig,
      baseOpacity: BASE,
      selectedOpacity: SELECTED,
      fadedOpacity: FADED,
    };
    sp._processData();
    return sp;
  }

  const setOpacity = (sp: Internals, patch: Partial<Opacities>) => {
    sp._mergedConfig = { ...sp._mergedConfig, ...patch };
  };

  it('no input change → cache HIT (same model instance)', () => {
    const sp = primed();
    expect(sp._style.model()).toBe(sp._style.model());
  });

  // Each key field, when flipped, must produce a cache MISS whose opacityOf(probe)
  // moves from `before` to `after`. `setup` (applied before the first read)
  // makes the flip observable where the default state would hide it.
  type Flip = {
    setup?: (sp: Internals) => void;
    flip: (sp: Internals) => void;
    probe: number;
    before: number;
    after: number;
  };
  const flips: Array<[string, Flip]> = [
    [
      'hiddenAnnotationValues',
      { flip: (sp) => (sp.hiddenAnnotationValues = ['A']), probe: 0, before: BASE, after: 0 },
    ],
    [
      'selectedProteinIds',
      { flip: (sp) => (sp.selectedProteinIds = ['p0']), probe: 3, before: BASE, after: FADED },
    ],
    [
      'highlightedProteinIds',
      {
        flip: (sp) => (sp.highlightedProteinIds = ['p1']),
        probe: 1,
        before: BASE,
        after: SELECTED,
      },
    ],
    [
      'selectedAnnotation',
      {
        setup: (sp) => (sp.hiddenAnnotationValues = ['A']),
        flip: (sp) => (sp.selectedAnnotation = 'other'),
        probe: 0,
        before: 0,
        after: BASE,
      },
    ],
    [
      'baseOpacity',
      { flip: (sp) => setOpacity(sp, { baseOpacity: 0.5 }), probe: 0, before: BASE, after: 0.5 },
    ],
    [
      'selectedOpacity',
      {
        setup: (sp) => (sp.selectedProteinIds = ['p0']),
        flip: (sp) => setOpacity(sp, { selectedOpacity: 0.7 }),
        probe: 0,
        before: SELECTED,
        after: 0.7,
      },
    ],
    [
      'fadedOpacity',
      {
        setup: (sp) => (sp.selectedProteinIds = ['p0']),
        flip: (sp) => setOpacity(sp, { fadedOpacity: 0.1 }),
        probe: 3,
        before: FADED,
        after: 0.1,
      },
    ],
    [
      'data',
      {
        setup: (sp) => (sp.hiddenAnnotationValues = ['A']),
        flip: (sp) => (sp.data = famData([1, 0, 0, 1, 1, 1])), // p0 is now "B"
        probe: 0,
        before: 0,
        after: BASE,
      },
    ],
    [
      'eatOverlayEnabled',
      {
        // p3's predicted "A" is hidden while the overlay applies it.
        setup: (sp) => (sp.hiddenAnnotationValues = ['A']),
        flip: (sp) => (sp.eatOverlayEnabled = false),
        probe: 3,
        before: 0,
        after: BASE,
      },
    ],
    [
      'focusedValues',
      { flip: (sp) => (sp._focusedValues = ['A']), probe: 4, before: BASE, after: FADED },
    ],
  ];

  it.each(flips)('flipping %s → cache MISS with the new opacity', (_field, c) => {
    const sp = primed();
    c.setup?.(sp);
    const before = sp._style.model();
    expect(before.opacityOf(point(c.probe))).toBe(c.before);
    c.flip(sp);
    const after = sp._style.model();
    expect(after).not.toBe(before);
    expect(after.opacityOf(point(c.probe))).toBe(c.after);
  });
});
