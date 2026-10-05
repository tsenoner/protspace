/**
 * @vitest-environment jsdom
 *
 * Fast-path regression for `DataViews.materialized`.
 *
 * The hot per-point opacity path (getOpacity -> visibility model ->
 * materialized data) reaches `DataViews.materialized` once per point on a
 * WebGL buffer rebuild (~573K times on the flagship dataset). A cheap
 * reference/primitive fast-path returns the cached materialized object before
 * the `JSON.stringify(...Object.keys(...))` cache-key serialization runs.
 *
 * We observe whether the JSON-key slow path ran by spying on `JSON.stringify`:
 * `DataViews.materialized` is the only caller of JSON.stringify on this path in
 * an unattached element, so a delta of 0 across consecutive calls proves the
 * fast-path fired.
 *
 * Construct the element via createElement without appending it (so Lit's
 * connectedCallback / WebGL init never runs — same approach as
 * scatter-plot.filter-render.test.ts).
 */
import { vi, describe, it, expect, afterEach } from 'vitest';
import type { VisualizationData } from '@protspace/utils';

import { createPlot, makeFamilyData } from './test-support/plot-fixture';

/**
 * `other` is a second categorical annotation, so we can flip selectedAnnotation.
 * `score` is a numeric column (never the selected annotation here), so
 * materializeVisualizationData returns a FRESH object on each materialization
 * rather than echoing the source ref (its categorical-only short-circuit). This
 * lets the reference-change assertions below distinguish re-materialization.
 */
const FAMILY = { other: true, score: true };

/**
 * Fixture with a numeric annotation `score` so we can exercise the
 * numeric-rebin (wholesale-replace) path.
 */
function makeNumericData(): VisualizationData {
  const n = 6;
  const coords = new Float32Array(n * 2);
  for (let i = 0; i < n; i++) {
    coords[i * 2] = i;
    coords[i * 2 + 1] = i;
  }
  const scores = [0, 1, 2, 3, 4, 5];
  return {
    protein_ids: Array.from({ length: n }, (_, i) => `p${i}`),
    projections: [{ name: 'umap', data: coords, dimension: 2 }],
    annotations: {
      score: {
        kind: 'numeric',
        values: [],
        colors: [],
        shapes: [],
        numericType: 'float',
        numericMetadata: {
          strategy: 'linear',
          binCount: 3,
          numericType: 'float',
          signature: 'sig',
          topologySignature: 'topo',
          logSupported: false,
          bins: [
            { id: 'b0', label: '0–2', lowerBound: 0, upperBound: 2, count: 2 },
            { id: 'b1', label: '2–4', lowerBound: 2, upperBound: 4, count: 2 },
            { id: 'b2', label: '4–6', lowerBound: 4, upperBound: 6, count: 2 },
          ],
        },
      },
    },
    annotation_data: {
      score: scores.map(() => [0]),
    },
    numeric_annotation_data: {
      score: Float64Array.from(scores),
    },
  } as unknown as VisualizationData;
}

describe('scatter-plot getMaterializedData fast-path', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('repeated calls with unchanged inputs skip JSON.stringify', () => {
    const sp = createPlot({ data: makeFamilyData(FAMILY), selectedAnnotation: 'fam' });

    // Prime: the JSON-key slow path runs once and populates the cache + the
    // fast-path key fields.
    const first = sp.getMaterializedData();
    expect(first).toBeTruthy();

    const spy = vi.spyOn(JSON, 'stringify');
    const before = spy.mock.calls.length;

    const a = sp.getMaterializedData();
    const b = sp.getMaterializedData();
    const c = sp.getMaterializedData();

    // Fast-path fired: JSON.stringify was never called again.
    expect(spy.mock.calls.length).toBe(before);
    // All returns are the SAME cached object reference.
    expect(a).toBe(first);
    expect(b).toBe(first);
    expect(c).toBe(first);
  });

  it('fast-path miss: changing selectedAnnotation re-materializes', () => {
    const sp = createPlot({ data: makeFamilyData(FAMILY), selectedAnnotation: 'fam' });
    const first = sp.getMaterializedData();

    const spy = vi.spyOn(JSON, 'stringify');
    const before = spy.mock.calls.length;

    sp.selectedAnnotation = 'other';
    const next = sp.getMaterializedData();

    expect(spy.mock.calls.length).toBeGreaterThan(before);
    expect(next).not.toBe(first);
  });

  it('fast-path miss: changing this.data ref re-materializes', () => {
    const sp = createPlot({ data: makeFamilyData(FAMILY), selectedAnnotation: 'fam' });
    const first = sp.getMaterializedData();

    const spy = vi.spyOn(JSON, 'stringify');
    const before = spy.mock.calls.length;

    sp.data = makeFamilyData({
      ...FAMILY,
      idPrefix: 'q',
      families: { C: '#0000ff', D: '#ffff00' },
      spacing: 2,
    });
    const next = sp.getMaterializedData();

    expect(spy.mock.calls.length).toBeGreaterThan(before);
    expect(next).not.toBe(first);
  });

  it('numeric-rebin: replacing numericAnnotationSettings wholesale re-materializes (fast-path miss)', () => {
    const sp = createPlot({ data: makeNumericData(), selectedAnnotation: 'score' });
    sp.numericAnnotationSettings = {
      score: { binCount: 3, strategy: 'linear', paletteId: 'viridis', reverseGradient: false },
    };
    const first = sp.getMaterializedData();

    const spy = vi.spyOn(JSON, 'stringify');
    const before = spy.mock.calls.length;

    // Wholesale replace: a NEW map AND a NEW per-annotation settings object,
    // matching the scatterplot-sync-controller wholesale-replace contract.
    sp.numericAnnotationSettings = {
      ...sp.numericAnnotationSettings,
      score: { binCount: 5, strategy: 'quantile', paletteId: 'viridis', reverseGradient: false },
    };
    const next = sp.getMaterializedData();

    // The rebin MUST miss the fast-path (new per-annotation ref) and re-materialize.
    expect(spy.mock.calls.length).toBeGreaterThan(before);
    expect(next).not.toBe(first);
  });
});
