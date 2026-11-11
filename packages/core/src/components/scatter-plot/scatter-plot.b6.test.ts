/**
 * @vitest-environment jsdom
 *
 * Component characterization for the materialization, filtered display-data
 * and updated() effect-ordering changes.
 *
 * These tests pin the externally observable contract of these changes so the
 * refactor stays behavior-preserving. They follow the pattern of the cache tests: the
 * element is constructed via `createElement` and NEVER appended, so Lit's
 * `connectedCallback` / WebGL init never runs (no WebGL context exists in
 * jsdom). The reactive `updated()` dispatcher is exercised by calling it
 * directly with an explicit `changedProperties` Map — this drives the real
 * `_processData` / data-change-emit / re-default logic without the Lit render
 * lifecycle. `_processData()` populates `_plotData` via
 * `DataProcessor.processVisualizationData` and needs no GPU.
 *
 * Fixture shape mirrors the neighbour cache tests
 * (scatter-plot.materialize-cache.test.ts / scatter-plot.scales-cache.test.ts):
 * { protein_ids, projections:[{name,data:Float32Array,dimension:2}],
 *   annotations:{key:{values,colors,shapes}}, annotation_data:{key:[...]},
 *   numeric_annotation_data:{...} } — NOT a makeViz factory.
 *
 * What the tests pin:
 *  - `getCurrentData` slices to the filtered ids, returns the memoized slice
 *    while its inputs are unchanged, rebuilds when the filteredProteinIds
 *    reference changes, and skips the memo entirely for
 *    `includeFilteredProteinIds: false`.
 *  - `updated()` emits data-change only for a geometry input, and re-defaults
 *    selectedAnnotation when the new data lacks it.
 *
 * Covered elsewhere, so not repeated here:
 *  - materialize ref fast-path         : scatter-plot.materialize-cache.test.ts
 *  - filter clear before reprocess     : scatter-plot.filter-render.test.ts
 *                                        ("dataset-swap clears stale query filter")
 *  - virtualization cache: #456 deleted the cull it served. The point index is
 *    covered by the hover, click, brush and lasso tests that use it.
 */
import { vi, describe, it, expect, afterEach } from 'vitest';
import type { VisualizationData } from '@protspace/utils';
import { createPlot, makeFamilyData, type PlotInternals } from './test-support/plot-fixture';

const RED = '#ff0000';

/**
 * Two families plus a numeric column that is NEVER the selected annotation: it
 * forces materializeVisualizationData to return a FRESH object on each
 * materialization (its categorical-only short-circuit echoes the source ref
 * otherwise), so the reference-identity assertions below are meaningful.
 */
const WITH_SCORE = { other: true, score: true };

/** Fixture whose single annotation key is `only` (for the selectedAnnotation re-default). */
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
// Memoize the filtered display-data rebuild
// ---------------------------------------------------------------------------
describe('filtered display-data memoization', () => {
  function primed(): PlotInternals {
    const el = createPlot();
    el.data = makeFamilyData(WITH_SCORE);
    el.selectedAnnotation = 'fam';
    el.filteredProteinIds = ['p1', 'p3'];
    el.filtersActive = true;
    return el;
  }

  it('slices the display data to the filtered ids', () => {
    const el = primed();
    const a = el.getCurrentData();
    expect(a).not.toBeNull();
    expect(a!.protein_ids).toEqual(['p1', 'p3']);
  });

  it('returns the SAME filtered object on repeated calls with unchanged inputs', () => {
    const el = primed();
    const a = el.getCurrentData();
    const b = el.getCurrentData();
    expect(b).toBe(a);
  });

  it('recomputes when filteredProteinIds ref changes', () => {
    const el = primed();
    const a = el.getCurrentData();
    el.filteredProteinIds = ['p2'];
    el.filtersActive = true;
    const b = el.getCurrentData();
    expect(b).not.toBe(a);
    expect(b!.protein_ids).toEqual(['p2']);
  });

  it('includeFilteredProteinIds:false bypasses the cache and returns the materialized object', () => {
    const el = primed();
    const mat = el.getMaterializedData();
    const out = el.getCurrentData({ includeFilteredProteinIds: false });
    expect(out).toBe(mat);
  });
});

// ---------------------------------------------------------------------------
// updated() data-change gate & selectedAnnotation re-default
//
// updated() is driven directly with an explicit changedProperties Map (the
// element is never appended). This exercises the real dispatcher: the
// data-change emit gate and the selectedAnnotation re-default. The
// filter-clear-before-reprocess order is pinned in
// scatter-plot.filter-render.test.ts.
// ---------------------------------------------------------------------------
describe('updated() data-change gate & selectedAnnotation re-default', () => {
  it('emits data-change exactly when a re-processing geometry input changes', () => {
    const el = createPlot();
    el.data = makeFamilyData(WITH_SCORE);
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

  it('re-defaults selectedAnnotation to annotationKeys[0] when data lacks it', () => {
    const el = createPlot();
    el.data = makeFamilyData(WITH_SCORE);
    el.selectedAnnotation = 'fam';
    el._processData();

    el.selectedAnnotation = 'does-not-exist';
    el.data = makeSingleAnnotationData(4);
    el.updated(changed(['data']));

    expect(el.selectedAnnotation).toBe('only');
  });
});
