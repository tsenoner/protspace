/**
 * @vitest-environment jsdom
 *
 * B6 component characterization for the wired scatter-plot changes
 * (F-60, F-40, F-17, F-18).
 *
 * These tests pin the externally observable contract of the B6 batch so the
 * refactor stays behavior-preserving. They follow the proven B7 pattern: the
 * element is constructed via `createElement` and NEVER appended, so Lit's
 * `connectedCallback` / WebGL init never runs (no WebGL context exists in
 * jsdom). The reactive `updated()` dispatcher is exercised by calling it
 * directly with an explicit `changedProperties` Map — this drives the real
 * `_processData` / filter-clear / data-change-emit logic without the Lit render
 * lifecycle. `_processData()` populates `_plotData` via
 * `DataProcessor.processVisualizationData` and needs no GPU.
 *
 * Fixture shape mirrors the neighbour B7 tests
 * (scatter-plot.materialize-cache.test.ts / scatter-plot.scales-cache.test.ts):
 * { protein_ids, projections:[{name,data:Float32Array,dimension:2}],
 *   annotations:{key:{values,colors,shapes}}, annotation_data:{key:[...]},
 *   numeric_annotation_data:{...} } — NOT a makeViz factory.
 *
 * RED/GREEN status on the UNMODIFIED tree:
 *  - F-60 (ref fast-path)                  : GREEN  (existing behavior)
 *  - F-40 includeFilteredProteinIds:false  : GREEN  (existing fast path)
 *  - F-40 filtered correctness             : GREEN  (existing slice)
 *  - F-40 filtered memoization (toBe)      : RED    (not-yet-wired memo)
 *  - F-40 recompute on ref change          : GREEN  (rebuilds anyway today)
 *  - F-17 generation bump                  : RED    (_quadtreeGeneration absent)
 *  - F-17 cacheKey folds generation        : RED    (rebuild ignores virt key)
 *  - F-18 filter clear before reprocess    : GREEN  (existing order)
 *  - F-18 data-change emit gating          : GREEN  (existing gate)
 *  - F-18 INV-10 re-default                : GREEN  (existing default)
 */
import { vi, describe, it, expect, afterEach } from 'vitest';
import type {
  VisualizationData,
  NumericAnnotationDisplaySettingsMap,
  PlotData,
} from '@protspace/utils';

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

type Internals = HTMLElement & {
  // public reactive props
  data: VisualizationData;
  selectedAnnotation: string;
  selectedProjectionIndex: number;
  projectionPlane: string;
  filteredProteinIds: string[];
  filtersActive: boolean;
  selectedProteinIds: string[];
  numericAnnotationSettings: NumericAnnotationDisplaySettingsMap;
  // internals under test
  _plotData: PlotData;
  _quadtreeGeneration: number;
  _virtualizationCacheKey: string | null;
  updated(changed: Map<string, unknown>): void;
  _processData(): void;
  _buildQuadtree(): void;
  _getMaterializedData(): VisualizationData | null;
  _getCurrentDisplayData(options?: {
    includeFilteredProteinIds?: boolean;
  }): VisualizationData | null;
};

/**
 * Categorical family fixture with N points across two families plus a numeric
 * column that is NEVER the selected annotation — this forces
 * materializeVisualizationData to return a FRESH object on each materialization
 * (its categorical-only short-circuit echoes the source ref otherwise), so the
 * reference-identity assertions below are meaningful. Mirrors makeFamilyData in
 * scatter-plot.materialize-cache.test.ts.
 */
function makeFamilyData(opts?: { n?: number; idPrefix?: string }): VisualizationData {
  const n = opts?.n ?? 6;
  const idPrefix = opts?.idPrefix ?? 'p';
  const families = Array.from({ length: n }, (_, i) => (i < Math.ceil(n / 2) ? 'A' : 'B'));
  const colorFor = (v: string) => (v === 'A' ? RED : GREEN);
  const coords = new Float32Array(n * 2);
  for (let i = 0; i < n; i++) {
    coords[i * 2] = i;
    coords[i * 2 + 1] = i;
  }
  return {
    protein_ids: families.map((_, i) => `${idPrefix}${i}`),
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
    numeric_annotation_data: {
      score: families.map((_, i) => i),
    },
  } as unknown as VisualizationData;
}

/** Fixture whose single annotation key is `only` (for the INV-10 re-default). */
function makeSingleAnnotationData(n = 4): VisualizationData {
  const values = Array.from({ length: n }, (_, i) => (i % 2 === 0 ? 'x' : 'y'));
  const coords = new Float32Array(n * 2);
  for (let i = 0; i < n; i++) {
    coords[i * 2] = i;
    coords[i * 2 + 1] = i;
  }
  return {
    protein_ids: values.map((_, i) => `s${i}`),
    projections: [{ name: 'umap', data: coords, dimension: 2 }],
    annotations: {
      only: {
        values,
        colors: values.map(() => RED),
        shapes: values.map(() => 'circle'),
      },
    },
    annotation_data: {
      only: values.map((v) => [v === 'x' ? 0 : 1]),
    },
    numeric_annotation_data: {
      score: values.map((_, i) => i),
    },
  } as unknown as VisualizationData;
}

function makeScatter(): Internals {
  return document.createElement('protspace-scatterplot') as Internals;
}

/** Build a changedProperties Map mirroring Lit's contract (key -> oldValue). */
function changed(keys: string[]): Map<string, unknown> {
  const m = new Map<string, unknown>();
  for (const k of keys) m.set(k, undefined);
  return m;
}

afterEach(() => {
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// F-60 — single numeric-column read in _getMaterializedData (ref fast-path)
// ---------------------------------------------------------------------------
describe('B6 F-60 _getMaterializedData single numeric read', () => {
  it('returns a stable reference on repeated calls with unchanged inputs (GREEN)', () => {
    const el = makeScatter();
    el.data = makeFamilyData({ n: 6 });
    el.selectedAnnotation = 'fam';

    // Prime: first call populates the cache + fast-path key fields.
    const first = el._getMaterializedData();
    expect(first).toBeTruthy();

    // Repeated calls with unchanged inputs hit the ref/primitive fast-path and
    // return the SAME cached object reference (the merge of the two numeric
    // reads into one local must keep this fast-path intact).
    const a = el._getMaterializedData();
    const b = el._getMaterializedData();
    expect(a).toBe(first);
    expect(b).toBe(first);
  });

  it('fast-path miss: changing selectedAnnotation re-materializes (GREEN)', () => {
    const el = makeScatter();
    el.data = makeFamilyData({ n: 6 });
    el.selectedAnnotation = 'fam';
    const first = el._getMaterializedData();

    el.selectedAnnotation = 'other';
    const next = el._getMaterializedData();
    expect(next).not.toBe(first);
  });
});

// ---------------------------------------------------------------------------
// F-40 — memoize the filtered display-data rebuild
// ---------------------------------------------------------------------------
describe('B6 F-40 filtered display-data memoization', () => {
  function primed(): Internals {
    const el = makeScatter();
    el.data = makeFamilyData({ n: 6 });
    el.selectedAnnotation = 'fam';
    el.filteredProteinIds = ['p1', 'p3'];
    el.filtersActive = true;
    return el;
  }

  it('filtered slice preserves correctness (GREEN)', () => {
    const el = primed();
    const a = el._getCurrentDisplayData();
    expect(a).not.toBeNull();
    expect(a!.protein_ids).toEqual(['p1', 'p3']);
  });

  it('returns the SAME filtered object on repeated calls with unchanged inputs (RED pre-wire — memoization)', () => {
    const el = primed();
    const a = el._getCurrentDisplayData();
    const b = el._getCurrentDisplayData();
    expect(b).toBe(a);
  });

  it('recomputes when filteredProteinIds ref changes (GREEN)', () => {
    const el = primed();
    const a = el._getCurrentDisplayData();
    el.filteredProteinIds = ['p2'];
    el.filtersActive = true;
    const b = el._getCurrentDisplayData();
    expect(b).not.toBe(a);
    expect(b!.protein_ids).toEqual(['p2']);
  });

  it('includeFilteredProteinIds:false bypasses the cache and returns the materialized object (GREEN)', () => {
    const el = primed();
    const mat = el._getMaterializedData();
    const out = el._getCurrentDisplayData({ includeFilteredProteinIds: false });
    expect(out).toBe(mat);
  });
});

// ---------------------------------------------------------------------------
// F-17 — virtualization cache invalidation on quadtree rebuild (sanctioned bug fix)
//
// The >=1M-point regime is not unit-reproducible cheaply, so we test the
// MECHANISM directly: a quadtree rebuild must advance a generation counter that
// is folded into the virtualization cacheKey, forcing the next visible-points
// read to miss even when the transform is unchanged.
// ---------------------------------------------------------------------------
describe('B6 F-17 virtualization cache invalidated on quadtree rebuild', () => {
  function withPlotData(): Internals {
    const el = makeScatter();
    el.data = makeFamilyData({ n: 8 });
    el.selectedAnnotation = 'fam';
    // Build _plotData + _scales so _buildQuadtree takes the real rebuild path
    // (not the empty early-return).
    el._processData();
    return el;
  }

  it('bumps the quadtree generation when the quadtree is rebuilt (RED pre-wire — field absent)', () => {
    const el = withPlotData();
    const before = el._quadtreeGeneration;
    el._buildQuadtree();
    const after = el._quadtreeGeneration;
    expect(after).toBe(before + 1);
  });

  it('virtualization cacheKey is invalidated by a quadtree rebuild (RED pre-wire — rebuild ignores virt key)', () => {
    const el = withPlotData();
    // Prime with a sentinel key; a rebuild must invalidate it (key cleared OR
    // generation advanced so the next computed key differs from the sentinel).
    el._virtualizationCacheKey = 'STALE';
    el._buildQuadtree();
    expect(el._virtualizationCacheKey).not.toBe('STALE');
  });
});

// ---------------------------------------------------------------------------
// F-18 — updated() effect ordering & INV-11 gate
//
// updated() is driven directly with an explicit changedProperties Map (the
// element is never appended). This exercises the real dispatcher: the
// filter-clear-before-reprocess order, the data-change emit gate, and the
// INV-10 selectedAnnotation re-default.
// ---------------------------------------------------------------------------
describe('B6 F-18 updated() effect ordering & INV-11 gate', () => {
  it('clears stale filters before reprocessing on a data swap (GREEN)', () => {
    const el = makeScatter();
    el.data = makeFamilyData({ n: 6 });
    el.selectedAnnotation = 'fam';
    el.filteredProteinIds = ['p1'];
    el.filtersActive = true;
    el._processData();

    // Swap to a new dataset whose ids do not overlap p*.
    el.data = makeFamilyData({ n: 5, idPrefix: 'q' });
    el.updated(changed(['data']));

    // The data-swap filter reset (INV) must fire BEFORE _processData, so the
    // new plot is built from the full 5-point set, not blanked by a stale set.
    expect(el.filtersActive).toBe(false);
    expect(el.filteredProteinIds).toEqual([]);
    expect(el._plotData.length).toBe(5);
  });

  it('emits data-change exactly when an INV-11 geometry input changes (GREEN)', () => {
    const el = makeScatter();
    el.data = makeFamilyData({ n: 6 });
    el.selectedAnnotation = 'fam';
    el._processData();

    const seen: string[] = [];
    el.addEventListener('data-change', () => seen.push('data-change'));

    // Selection-only change: NOT a geometry change → no data-change emit.
    el.selectedProteinIds = ['p0'];
    el.updated(changed(['selectedProteinIds']));
    expect(seen).toHaveLength(0);

    // filteredProteinIds + filtersActive: geometry change → exactly one emit.
    el.filteredProteinIds = ['p1'];
    el.filtersActive = true;
    el.updated(changed(['filteredProteinIds', 'filtersActive']));
    expect(seen).toEqual(['data-change']);
  });

  it('re-defaults selectedAnnotation to annotationKeys[0] when data lacks it (INV-10, GREEN)', () => {
    const el = makeScatter();
    el.data = makeFamilyData({ n: 6 });
    el.selectedAnnotation = 'fam';
    el._processData();

    el.selectedAnnotation = 'does-not-exist';
    el.data = makeSingleAnnotationData(4);
    el.updated(changed(['data']));

    expect(el.selectedAnnotation).toBe('only');
  });
});
