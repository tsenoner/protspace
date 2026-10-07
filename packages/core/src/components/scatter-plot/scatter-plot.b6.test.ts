/**
 * @vitest-environment jsdom
 *
 * B6 component characterization for the wired scatter-plot changes
 * (F-40, F-18).
 *
 * These tests pin the externally observable contract of the B6 batch so the
 * refactor stays behavior-preserving. They follow the proven B7 pattern: the
 * element is constructed via `createElement` and NEVER appended, so Lit's
 * `connectedCallback` / WebGL init never runs (no WebGL context exists in
 * jsdom). The reactive `updated()` dispatcher is exercised by calling it
 * directly with an explicit `changedProperties` Map — this drives the real
 * `_processData` / data-change-emit / re-default logic without the Lit render
 * lifecycle. `_processData()` populates `_plotData` via
 * `DataProcessor.processVisualizationData` and needs no GPU.
 *
 * Fixture shape mirrors the neighbour B7 tests
 * (scatter-plot.materialize-cache.test.ts / scatter-plot.scales-cache.test.ts):
 * { protein_ids, projections:[{name,data:Float32Array,dimension:2}],
 *   annotations:{key:{values,colors,shapes}}, annotation_data:{key:[...]},
 *   numeric_annotation_data:{...} } — NOT a makeViz factory.
 *
 * What the tests pin:
 *  - F-40: `_getCurrentDisplayData` slices to the filtered ids, returns the
 *    memoized slice while its inputs are unchanged, rebuilds when the
 *    filteredProteinIds reference changes, and skips the memo entirely for
 *    `includeFilteredProteinIds: false`.
 *  - F-18: `updated()` emits data-change only for a geometry (INV-11) input,
 *    and re-defaults selectedAnnotation (INV-10) when the new data lacks it.
 *
 * Covered elsewhere, so not repeated here:
 *  - F-60 (materialize ref fast-path)  : scatter-plot.materialize-cache.test.ts
 *  - F-18 filter clear before reprocess: scatter-plot.filter-render.test.ts
 *                                        ("dataset-swap clears stale query filter")
 *  - F-17 (virtualization cache): #456 deleted the cull it served. The point
 *    index is covered by the hover, click, brush and lasso tests that use it.
 */
import { vi, describe, it, expect, afterEach } from 'vitest';
import type { VisualizationData, NumericAnnotationDisplaySettingsMap } from '@protspace/utils';

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
  updated(changed: Map<string, unknown>): void;
  _processData(): void;
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
function makeFamilyData(opts?: { n?: number }): VisualizationData {
  const n = opts?.n ?? 6;
  const families = Array.from({ length: n }, (_, i) => (i < Math.ceil(n / 2) ? 'A' : 'B'));
  const colorFor = (v: string) => (v === 'A' ? RED : GREEN);
  const coords = new Float32Array(n * 2);
  for (let i = 0; i < n; i++) {
    coords[i * 2] = i;
    coords[i * 2 + 1] = i;
  }
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
    numeric_annotation_data: {
      score: Float64Array.from(families, (_, i) => i),
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
      score: Float64Array.from(values, (_, i) => i),
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

  it('slices the display data to the filtered ids', () => {
    const el = primed();
    const a = el._getCurrentDisplayData();
    expect(a).not.toBeNull();
    expect(a!.protein_ids).toEqual(['p1', 'p3']);
  });

  it('returns the SAME filtered object on repeated calls with unchanged inputs', () => {
    const el = primed();
    const a = el._getCurrentDisplayData();
    const b = el._getCurrentDisplayData();
    expect(b).toBe(a);
  });

  it('recomputes when filteredProteinIds ref changes', () => {
    const el = primed();
    const a = el._getCurrentDisplayData();
    el.filteredProteinIds = ['p2'];
    el.filtersActive = true;
    const b = el._getCurrentDisplayData();
    expect(b).not.toBe(a);
    expect(b!.protein_ids).toEqual(['p2']);
  });

  it('includeFilteredProteinIds:false bypasses the cache and returns the materialized object', () => {
    const el = primed();
    const mat = el._getMaterializedData();
    const out = el._getCurrentDisplayData({ includeFilteredProteinIds: false });
    expect(out).toBe(mat);
  });
});

// ---------------------------------------------------------------------------
// F-18 — updated() INV-11 gate & INV-10 re-default
//
// updated() is driven directly with an explicit changedProperties Map (the
// element is never appended). This exercises the real dispatcher: the
// data-change emit gate and the INV-10 selectedAnnotation re-default. The
// filter-clear-before-reprocess order is pinned in
// scatter-plot.filter-render.test.ts.
// ---------------------------------------------------------------------------
describe('B6 F-18 updated() INV-11 gate & INV-10 re-default', () => {
  it('emits data-change exactly when an INV-11 geometry input changes', () => {
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

  it('re-defaults selectedAnnotation to annotationKeys[0] when data lacks it (INV-10)', () => {
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
