// @vitest-environment jsdom
//
// F-22 characterization lock for the `_scales` cache.
//
// `_scales` (a getter) recomputes ONLY when plotDataLength / width / height /
// margin change. A same-length coordinate swap (switching projection or
// projectionPlane) changes none of those deps, so the SOLE guard that forces a
// fresh ScalePair is the `_processData() -> _invalidateScalesCache()` call.
// This test drives `_processData()` directly (the filter-render.test.ts pattern,
// element created via createElement and never appended so Lit's
// connectedCallback / WebGL init never runs) and asserts that a same-length
// projection swap yields a fresh ScalePair whose x-domain reflects the new,
// wider coordinate extent.
import { describe, it, expect, beforeAll } from 'vitest';
import type { VisualizationData } from '@protspace/utils';
import type { ScalePair } from './webgl/types';

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
  selectedProjectionIndex: number;
  _processData(): void;
  readonly _scales: ScalePair | null;
};

// Two projections, SAME length (3 points), DIFFERENT coordinate extents.
// Fixture shape mirrors makeFamilyData in scatter-plot.materialize-cache.test.ts:
// projections[].data + dimension, annotations + annotation_data (NOT the
// features/feature_data / metadata.dimensions names from the plan sketch).
function twoProjectionData(): VisualizationData {
  const families = ['A', 'A', 'B'];
  return {
    protein_ids: ['p0', 'p1', 'p2'],
    projections: [
      { name: 'proj_a', data: new Float32Array([0, 0, 1, 1, 2, 2]), dimension: 2 },
      { name: 'proj_b', data: new Float32Array([0, 0, 50, 50, 100, 100]), dimension: 2 },
    ],
    annotations: {
      fam: {
        values: families,
        colors: families.map((v) => (v === 'A' ? '#f00' : '#0f0')),
        shapes: families.map(() => 'circle'),
      },
    },
    annotation_data: {
      fam: families.map((v) => [families.indexOf(v)]),
    },
  } as unknown as VisualizationData;
}

describe('_scales cache invalidation (F-22 characterization lock)', () => {
  it('switching projection (same length, new coords) yields a fresh ScalePair with the new domain', () => {
    const sp = document.createElement('protspace-scatterplot') as Internals;
    sp.data = twoProjectionData();
    sp.selectedAnnotation = 'fam';
    sp.selectedProjectionIndex = 0;
    sp._processData();
    const scalesA = sp._scales!;
    const domainA = scalesA.x.domain();

    sp.selectedProjectionIndex = 1;
    sp._processData(); // _invalidateScalesCache() must fire here
    const scalesB = sp._scales!;
    const domainB = scalesB.x.domain();

    expect(scalesB).not.toBe(scalesA); // cache miss -> recomputed
    expect(domainB).not.toEqual(domainA); // domain reflects proj_b's wider extent
    expect(Math.max(...domainB)).toBeGreaterThan(Math.max(...domainA));
  });
});
