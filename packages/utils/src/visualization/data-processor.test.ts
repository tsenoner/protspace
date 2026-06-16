import { describe, it, expect } from 'vitest';
import { DataProcessor } from './data-processor';
import { materializePlotDataPoint } from './plot-data';
import type { VisualizationData, PlotData } from '../types';

// Helper to build a minimal PlotData literal for createScales tests
function makePlotData(xs: number[], ys: number[], proteinIds?: string[]): PlotData {
  return {
    length: xs.length,
    xs: new Float32Array(xs),
    ys: new Float32Array(ys),
    zs: null,
    originalIndices: null,
    proteinIds: proteinIds ?? xs.map((_, i) => `p${i}`),
  };
}

describe('DataProcessor.processVisualizationData', () => {
  it('returns correct SoA shape for 2D coordinates', () => {
    const data: VisualizationData = {
      protein_ids: ['p0', 'p1'],
      projections: [
        {
          name: 't',
          data: Float32Array.of(1, 2, 3, 4),
          dimension: 2,
        },
      ],
      annotations: {},
      annotation_data: {},
    };
    const result = DataProcessor.processVisualizationData(data, 0);
    expect(result.length).toBe(2);
    expect(Array.from(result.xs)).toEqual([1, 3]);
    expect(Array.from(result.ys)).toEqual([2, 4]);
    expect(result.zs).toBeNull();
    expect(result.originalIndices).toBeNull();
    expect(result.proteinIds).toBe(data.protein_ids);
  });

  it('preserves z coordinate (in zs) for 3D projections', () => {
    const data: VisualizationData = {
      protein_ids: ['p0'],
      projections: [{ name: 't', data: Float32Array.of(1, 2, 3), dimension: 3 }],
      annotations: {},
      annotation_data: {},
    };
    const result = DataProcessor.processVisualizationData(data, 0);
    expect(result.length).toBe(1);
    expect(result.xs[0]).toBe(1);
    expect(result.ys[0]).toBe(2);
    expect(result.zs).not.toBeNull();
    expect(result.zs![0]).toBe(3);
    expect(result.originalIndices).toBeNull();
  });

  it('maps coordinates to xz plane when projectionPlane is "xz"', () => {
    const data: VisualizationData = {
      protein_ids: ['p0'],
      projections: [{ name: 't', data: Float32Array.of(10, 20, 30), dimension: 3 }],
      annotations: {},
      annotation_data: {},
    };
    const result = DataProcessor.processVisualizationData(data, 0, false, undefined, 'xz');
    expect(result.xs[0]).toBe(10);
    expect(result.ys[0]).toBe(30);
    expect(result.zs![0]).toBe(30);
  });

  it('maps coordinates to yz plane when projectionPlane is "yz"', () => {
    const data: VisualizationData = {
      protein_ids: ['p0'],
      projections: [{ name: 't', data: Float32Array.of(10, 20, 30), dimension: 3 }],
      annotations: {},
      annotation_data: {},
    };
    const result = DataProcessor.processVisualizationData(data, 0, false, undefined, 'yz');
    expect(result.xs[0]).toBe(20);
    expect(result.ys[0]).toBe(30);
    expect(result.zs![0]).toBe(30);
  });

  it('returns empty PlotData when projection index is out of range', () => {
    const data: VisualizationData = {
      protein_ids: ['p0'],
      projections: [],
      annotations: {},
      annotation_data: {},
    };
    const result = DataProcessor.processVisualizationData(data, 0);
    expect(result.length).toBe(0);
    expect(result.xs.length).toBe(0);
  });

  it('does not materialize annotation Records on slots', () => {
    const data: VisualizationData = {
      protein_ids: ['p0'],
      projections: [{ name: 't', data: Float32Array.of(0, 0), dimension: 2 }],
      annotations: {
        species: {
          kind: 'categorical',
          values: ['human'],
          colors: ['#f00'],
          shapes: ['circle'],
        },
      },
      annotation_data: { species: Int32Array.of(0) },
    };
    const result = DataProcessor.processVisualizationData(data, 0);
    expect(result.length).toBe(1);
    // SoA container only has the typed-array fields
    expect(result.xs[0]).toBe(0);
    expect(result.ys[0]).toBe(0);
  });
});

describe('DataProcessor.processVisualizationData — isolation (Set-based, MODEL-O5b)', () => {
  const fixture: VisualizationData = {
    protein_ids: ['a', 'b', 'c', 'd'],
    projections: [
      {
        name: 't',
        data: Float32Array.of(1, 2, 3, 4, 5, 6, 7, 8),
        dimension: 2,
      },
    ],
    annotations: {},
    annotation_data: {},
  };

  it('single-layer isolation keeps only ids present in that layer', () => {
    const result = DataProcessor.processVisualizationData(fixture, 0, true, [['a', 'c']]);
    expect(result.length).toBe(2);
    expect(result.proteinIds[result.originalIndices![0]]).toBe('a');
    expect(result.proteinIds[result.originalIndices![1]]).toBe('c');
  });

  it('single-layer isolation excludes ids absent from the layer', () => {
    const result = DataProcessor.processVisualizationData(fixture, 0, true, [['b']]);
    expect(result.length).toBe(1);
    expect(result.proteinIds[result.originalIndices![0]]).toBe('b');
  });

  it('multi-layer isolation returns intersection (points in ALL layers only)', () => {
    // layer0 = {a,b,c}, layer1 = {b,c,d} → intersection = {b,c}
    const result = DataProcessor.processVisualizationData(fixture, 0, true, [
      ['a', 'b', 'c'],
      ['b', 'c', 'd'],
    ]);
    expect(result.length).toBe(2);
    const ids = Array.from(
      { length: result.length },
      (_, k) => result.proteinIds[result.originalIndices![k]],
    );
    expect(ids).toEqual(['b', 'c']);
  });

  it('point in first layer but not second is removed', () => {
    // 'a' is in layer0 but absent from layer1 → must not appear
    const result = DataProcessor.processVisualizationData(fixture, 0, true, [
      ['a', 'b'],
      ['b', 'c'],
    ]);
    expect(result.length).toBe(1);
    expect(result.proteinIds[result.originalIndices![0]]).toBe('b');
  });

  it('empty isolation layer returns empty result', () => {
    const result = DataProcessor.processVisualizationData(fixture, 0, true, [[]]);
    expect(result.length).toBe(0);
  });

  it('empty isolation layer in second position returns empty result', () => {
    const result = DataProcessor.processVisualizationData(fixture, 0, true, [['a', 'b'], []]);
    expect(result.length).toBe(0);
  });

  it('isolationMode false returns all processed points unchanged', () => {
    const result = DataProcessor.processVisualizationData(fixture, 0, false, [['a']]);
    expect(result.length).toBe(4);
    expect(result.originalIndices).toBeNull();
  });

  it('empty isolationHistory returns all processed points unchanged', () => {
    const result = DataProcessor.processVisualizationData(fixture, 0, true, []);
    expect(result.length).toBe(4);
    expect(result.originalIndices).toBeNull();
  });

  it('no isolationHistory argument returns all processed points unchanged', () => {
    const result = DataProcessor.processVisualizationData(fixture, 0, true, undefined);
    expect(result.length).toBe(4);
    expect(result.originalIndices).toBeNull();
  });

  it('surviving slots preserve originalIndex (protein index in protein_ids)', () => {
    // 'c' is at index 2 and 'd' at index 3 in protein_ids
    const result = DataProcessor.processVisualizationData(fixture, 0, true, [['c', 'd']]);
    expect(result.length).toBe(2);
    expect(result.originalIndices![0]).toBe(2);
    expect(result.originalIndices![1]).toBe(3);
    expect(result.xs[0]).toBe(5);
    expect(result.ys[0]).toBe(6);
    expect(result.xs[1]).toBe(7);
    expect(result.ys[1]).toBe(8);
  });
});

describe('DataProcessor.processVisualizationData — query filter (visibleProteinIds)', () => {
  const fixture: VisualizationData = {
    protein_ids: ['p0', 'p1', 'p2', 'p3', 'p4'],
    projections: [
      {
        name: 't',
        data: Float32Array.of(0, 0, 1, 1, 2, 2, 3, 3, 4, 4),
        dimension: 2,
      },
    ],
    annotations: {},
    annotation_data: {},
  };

  it('null/undefined visibleProteinIds skips the cull; empty Set culls to zero', () => {
    expect(
      DataProcessor.processVisualizationData(fixture, 0, false, undefined, 'xy', undefined).length,
    ).toBe(5);
    expect(
      DataProcessor.processVisualizationData(fixture, 0, false, undefined, 'xy', null).length,
    ).toBe(5);
    // empty Set is truthy → cull runs → zero matches → empty result
    expect(
      DataProcessor.processVisualizationData(fixture, 0, false, undefined, 'xy', new Set<string>())
        .length,
    ).toBe(0);
  });

  it('query filter keeps GLOBAL originalIndices on a non-prefix subset', () => {
    const result = DataProcessor.processVisualizationData(
      fixture,
      0,
      false,
      undefined,
      'xy',
      new Set(['p1', 'p3']),
    );
    expect(result.length).toBe(2);
    // originalIndices must be GLOBAL indices into protein_ids, not slice-local —
    // style getters and tooltips resolve annotation values by that index.
    expect(Array.from(result.originalIndices!)).toEqual([1, 3]);
    expect(Array.from(result.xs)).toEqual([1, 3]);
    expect(Array.from(result.ys)).toEqual([1, 3]);
  });

  it('combines query-filter and isolation: intersection with global originalIndices', () => {
    // query filter retains p1,p2,p3; isolation retains p0,p1,p2 → intersection = {p1, p2}
    const result = DataProcessor.processVisualizationData(
      fixture,
      0,
      true,
      [['p0', 'p1', 'p2']],
      'xy',
      new Set(['p1', 'p2', 'p3']),
    );
    expect(result.length).toBe(2);
    expect(Array.from(result.originalIndices!)).toEqual([1, 2]);
  });

  it('combines query-filter and multi-layer isolation (intersection across all layers)', () => {
    // query filter retains p1..p4; layer0 retains p0..p3; layer1 retains p2,p3,p4 → {p2, p3}
    const result = DataProcessor.processVisualizationData(
      fixture,
      0,
      true,
      [
        ['p0', 'p1', 'p2', 'p3'],
        ['p2', 'p3', 'p4'],
      ],
      'xy',
      new Set(['p1', 'p2', 'p3', 'p4']),
    );
    expect(result.length).toBe(2);
    expect(Array.from(result.originalIndices!)).toEqual([2, 3]);
  });
});

describe('materializePlotDataPoint', () => {
  it('reconstructs {id,x,y,originalIndex} for a non-isolated (identity) PlotData', () => {
    const data: VisualizationData = {
      protein_ids: ['p0', 'p1'],
      projections: [
        {
          name: 't',
          data: Float32Array.of(1, 2, 3, 4),
          dimension: 2,
        },
      ],
      annotations: {},
      annotation_data: {},
    };
    const pd = DataProcessor.processVisualizationData(data, 0);
    const p0 = materializePlotDataPoint(pd, 0);
    expect(p0).toEqual({ id: 'p0', x: 1, y: 2, originalIndex: 0 });
    const p1 = materializePlotDataPoint(pd, 1);
    expect(p1).toEqual({ id: 'p1', x: 3, y: 4, originalIndex: 1 });
  });

  it('reconstructs correct originalIndex for an isolated PlotData', () => {
    // protein_ids = [a, b, c, d]; isolate [c, d] → slot 0 = protein index 2 (c), slot 1 = protein index 3 (d)
    const data: VisualizationData = {
      protein_ids: ['a', 'b', 'c', 'd'],
      projections: [
        {
          name: 't',
          data: Float32Array.of(1, 2, 3, 4, 5, 6, 7, 8),
          dimension: 2,
        },
      ],
      annotations: {},
      annotation_data: {},
    };
    const pd = DataProcessor.processVisualizationData(data, 0, true, [['c', 'd']]);
    const slot0 = materializePlotDataPoint(pd, 0);
    expect(slot0.id).toBe('c');
    expect(slot0.originalIndex).toBe(2);
    expect(slot0.x).toBe(5);
    expect(slot0.y).toBe(6);

    const slot1 = materializePlotDataPoint(pd, 1);
    expect(slot1.id).toBe('d');
    expect(slot1.originalIndex).toBe(3);
  });

  it('includes z field for 3D PlotData', () => {
    const data: VisualizationData = {
      protein_ids: ['p0'],
      projections: [{ name: 't', data: Float32Array.of(1, 2, 3), dimension: 3 }],
      annotations: {},
      annotation_data: {},
    };
    const pd = DataProcessor.processVisualizationData(data, 0);
    const p = materializePlotDataPoint(pd, 0);
    expect(p.z).toBe(3);
  });
});

describe('DataProcessor.createScales', () => {
  const margin = { top: 10, right: 20, bottom: 30, left: 40 };

  it('returns null for empty plotData', () => {
    const result = DataProcessor.createScales(makePlotData([], []), 800, 600, margin);
    expect(result).toBeNull();
  });

  it('returns correct domain and range for a known fixture', () => {
    // x in [0, 10], y in [-5, 5]
    const plotData = makePlotData([0, 10], [-5, 5]);
    const width = 800;
    const height = 600;
    const scales = DataProcessor.createScales(plotData, width, height, margin);
    expect(scales).not.toBeNull();

    // xRange = 10 - 0 = 10, xPadding = 0.5
    const xDomainMin = 0 - 0.5;
    const xDomainMax = 10 + 0.5;
    expect(scales!.x.domain()).toEqual([xDomainMin, xDomainMax]);
    expect(scales!.x.range()).toEqual([margin.left, width - margin.right]);

    // yRange = 5 - (-5) = 10, yPadding = 0.5
    const yDomainMin = -5 - 0.5;
    const yDomainMax = 5 + 0.5;
    expect(scales!.y.domain()).toEqual([yDomainMin, yDomainMax]);
    expect(scales!.y.range()).toEqual([height - margin.bottom, margin.top]);

    // spot-check: x(0) should map near margin.left (but slightly inside due to padding)
    const xAtMin = scales!.x(0);
    expect(xAtMin).toBeGreaterThan(margin.left);
    expect(xAtMin).toBeLessThan(width - margin.right);

    // spot-check: x(10) should map near width - margin.right
    const xAtMax = scales!.x(10);
    expect(xAtMax).toBeGreaterThan(margin.left);
    expect(xAtMax).toBeLessThan(width - margin.right);
  });

  it('handles single point (min === max) — zero padding, domain equals the point value', () => {
    const plotData = makePlotData([7], [3]);
    const scales = DataProcessor.createScales(plotData, 800, 600, margin);
    expect(scales).not.toBeNull();
    // padding = abs(7 - 7) * 0.05 = 0
    expect(scales!.x.domain()).toEqual([7, 7]);
    expect(scales!.y.domain()).toEqual([3, 3]);
    // construction must not throw — scale still returned
  });

  it('RESIZE path: same PlotData reference → domain identical, range reflects new dimensions', () => {
    const plotData = makePlotData([0, 10], [0, 10]);
    const margin1 = { top: 10, right: 20, bottom: 30, left: 40 };

    // First call: 800×600
    const scales1 = DataProcessor.createScales(plotData, 800, 600, margin1);
    expect(scales1).not.toBeNull();
    const domain1X = scales1!.x.domain();
    const domain1Y = scales1!.y.domain();

    // Second call: SAME PlotData ref, different dimensions (simulates resize)
    const scales2 = DataProcessor.createScales(plotData, 1200, 900, margin1);
    expect(scales2).not.toBeNull();
    const domain2X = scales2!.x.domain();
    const domain2Y = scales2!.y.domain();

    // Domain must be identical — extents reused from cache
    expect(domain2X).toEqual(domain1X);
    expect(domain2Y).toEqual(domain1Y);

    // Range must reflect new dimensions
    expect(scales1!.x.range()).toEqual([margin1.left, 800 - margin1.right]);
    expect(scales2!.x.range()).toEqual([margin1.left, 1200 - margin1.right]);
    expect(scales1!.y.range()).toEqual([600 - margin1.bottom, margin1.top]);
    expect(scales2!.y.range()).toEqual([900 - margin1.bottom, margin1.top]);
  });

  it('different PlotData objects with different coordinate ranges → different domains', () => {
    const plotData1 = makePlotData([0, 10], [0, 10]);
    const plotData2 = makePlotData([100, 300], [200, 400]);
    const width = 800;
    const height = 600;

    const scales1 = DataProcessor.createScales(plotData1, width, height, margin);
    const scales2 = DataProcessor.createScales(plotData2, width, height, margin);

    expect(scales1).not.toBeNull();
    expect(scales2).not.toBeNull();

    // Domains must differ — separate PlotData objects, separate cache entries
    expect(scales1!.x.domain()).not.toEqual(scales2!.x.domain());
    expect(scales1!.y.domain()).not.toEqual(scales2!.y.domain());

    // Verify exact domains for each
    // plotData1: x in [0,10] → padding 0.5 → domain [-0.5, 10.5]
    expect(scales1!.x.domain()).toEqual([-0.5, 10.5]);
    // plotData2: x in [100,300] → range 200 → padding 10 → domain [90, 310]
    expect(scales2!.x.domain()).toEqual([90, 310]);
  });
});
