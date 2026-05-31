import { describe, it, expect } from 'vitest';
import { DataProcessor } from './data-processor';
import type { VisualizationData, PlotDataPoint } from '../types';

describe('DataProcessor.processVisualizationData', () => {
  it('returns one bare PlotDataPoint per protein for 2D coordinates', () => {
    const data: VisualizationData = {
      protein_ids: ['p0', 'p1'],
      projections: [
        {
          name: 't',
          data: [
            [1, 2],
            [3, 4],
          ],
        },
      ],
      annotations: {},
      annotation_data: {},
    };
    const result = DataProcessor.processVisualizationData(data, 0);
    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({ id: 'p0', x: 1, y: 2, originalIndex: 0 });
    expect(result[1]).toEqual({ id: 'p1', x: 3, y: 4, originalIndex: 1 });
  });

  it('preserves z coordinate for 3D projections', () => {
    const data: VisualizationData = {
      protein_ids: ['p0'],
      projections: [{ name: 't', data: [[1, 2, 3]] }],
      annotations: {},
      annotation_data: {},
    };
    const result = DataProcessor.processVisualizationData(data, 0);
    expect(result[0]).toEqual({ id: 'p0', x: 1, y: 2, z: 3, originalIndex: 0 });
  });

  it('maps coordinates to xz plane when projectionPlane is "xz"', () => {
    const data: VisualizationData = {
      protein_ids: ['p0'],
      projections: [{ name: 't', data: [[10, 20, 30]] }],
      annotations: {},
      annotation_data: {},
    };
    const result = DataProcessor.processVisualizationData(data, 0, false, undefined, 'xz');
    expect(result[0]).toEqual({ id: 'p0', x: 10, y: 30, z: 30, originalIndex: 0 });
  });

  it('maps coordinates to yz plane when projectionPlane is "yz"', () => {
    const data: VisualizationData = {
      protein_ids: ['p0'],
      projections: [{ name: 't', data: [[10, 20, 30]] }],
      annotations: {},
      annotation_data: {},
    };
    const result = DataProcessor.processVisualizationData(data, 0, false, undefined, 'yz');
    expect(result[0]).toEqual({ id: 'p0', x: 20, y: 30, z: 30, originalIndex: 0 });
  });

  it('returns empty array when projection index is out of range', () => {
    const data: VisualizationData = {
      protein_ids: ['p0'],
      projections: [],
      annotations: {},
      annotation_data: {},
    };
    expect(DataProcessor.processVisualizationData(data, 0)).toEqual([]);
  });

  it('filters points using isolation history', () => {
    const data: VisualizationData = {
      protein_ids: ['p0', 'p1', 'p2'],
      projections: [
        {
          name: 't',
          data: [
            [0, 0],
            [1, 1],
            [2, 2],
          ],
        },
      ],
      annotations: {},
      annotation_data: {},
    };
    const result = DataProcessor.processVisualizationData(data, 0, true, [['p0', 'p2']]);
    expect(result.map((p) => p.id)).toEqual(['p0', 'p2']);
  });

  it('applies multiple isolation history layers (intersection)', () => {
    const data: VisualizationData = {
      protein_ids: ['p0', 'p1', 'p2', 'p3'],
      projections: [
        {
          name: 't',
          data: [
            [0, 0],
            [1, 1],
            [2, 2],
            [3, 3],
          ],
        },
      ],
      annotations: {},
      annotation_data: {},
    };
    const result = DataProcessor.processVisualizationData(data, 0, true, [
      ['p0', 'p1', 'p2'],
      ['p1', 'p2', 'p3'],
    ]);
    expect(result.map((p) => p.id)).toEqual(['p1', 'p2']);
  });

  it('does not materialize annotation Records on points', () => {
    const data: VisualizationData = {
      protein_ids: ['p0'],
      projections: [{ name: 't', data: [[0, 0]] }],
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
    expect(result).toHaveLength(1);
    expect(Object.keys(result[0]).sort()).toEqual(['id', 'originalIndex', 'x', 'y']);
  });
});

describe('DataProcessor.processVisualizationData — isolation (Set-based, MODEL-O5b)', () => {
  const fixture: VisualizationData = {
    protein_ids: ['a', 'b', 'c', 'd'],
    projections: [
      {
        name: 't',
        data: [
          [1, 2],
          [3, 4],
          [5, 6],
          [7, 8],
        ],
      },
    ],
    annotations: {},
    annotation_data: {},
  };

  it('single-layer isolation keeps only ids present in that layer', () => {
    const result = DataProcessor.processVisualizationData(fixture, 0, true, [['a', 'c']]);
    expect(result.map((p) => p.id)).toEqual(['a', 'c']);
  });

  it('single-layer isolation excludes ids absent from the layer', () => {
    const result = DataProcessor.processVisualizationData(fixture, 0, true, [['b']]);
    expect(result.map((p) => p.id)).toEqual(['b']);
    expect(result.find((p) => p.id === 'a')).toBeUndefined();
  });

  it('multi-layer isolation returns intersection (points in ALL layers only)', () => {
    // layer0 = {a,b,c}, layer1 = {b,c,d} → intersection = {b,c}
    const result = DataProcessor.processVisualizationData(fixture, 0, true, [
      ['a', 'b', 'c'],
      ['b', 'c', 'd'],
    ]);
    expect(result.map((p) => p.id)).toEqual(['b', 'c']);
  });

  it('point in first layer but not second is removed', () => {
    // 'a' is in layer0 but absent from layer1 → must not appear
    const result = DataProcessor.processVisualizationData(fixture, 0, true, [
      ['a', 'b'],
      ['b', 'c'],
    ]);
    expect(result.find((p) => p.id === 'a')).toBeUndefined();
    expect(result.map((p) => p.id)).toEqual(['b']);
  });

  it('empty isolation layer returns empty result', () => {
    const result = DataProcessor.processVisualizationData(fixture, 0, true, [[]]);
    expect(result).toHaveLength(0);
  });

  it('empty isolation layer in second position returns empty result', () => {
    const result = DataProcessor.processVisualizationData(fixture, 0, true, [['a', 'b'], []]);
    expect(result).toHaveLength(0);
  });

  it('isolationMode false returns all processed points unchanged', () => {
    const result = DataProcessor.processVisualizationData(fixture, 0, false, [['a']]);
    expect(result).toHaveLength(4);
  });

  it('empty isolationHistory returns all processed points unchanged', () => {
    const result = DataProcessor.processVisualizationData(fixture, 0, true, []);
    expect(result).toHaveLength(4);
  });

  it('no isolationHistory argument returns all processed points unchanged', () => {
    const result = DataProcessor.processVisualizationData(fixture, 0, true, undefined);
    expect(result).toHaveLength(4);
  });

  it('surviving points preserve originalIndex (index in protein_ids, not filtered position)', () => {
    // 'c' is at index 2 and 'd' at index 3 in protein_ids
    const result = DataProcessor.processVisualizationData(fixture, 0, true, [['c', 'd']]);
    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({ id: 'c', originalIndex: 2, x: 5, y: 6 });
    expect(result[1]).toMatchObject({ id: 'd', originalIndex: 3, x: 7, y: 8 });
  });
});

describe('DataProcessor.createScales', () => {
  const margin = { top: 10, right: 20, bottom: 30, left: 40 };

  it('returns null for empty plotData', () => {
    const result = DataProcessor.createScales([], 800, 600, margin);
    expect(result).toBeNull();
  });

  it('returns correct domain and range for a known fixture', () => {
    // x in [0, 10], y in [-5, 5]
    const plotData: PlotDataPoint[] = [
      { id: 'a', x: 0, y: -5, originalIndex: 0 },
      { id: 'b', x: 10, y: 5, originalIndex: 1 },
    ];
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
    const plotData: PlotDataPoint[] = [{ id: 'only', x: 7, y: 3, originalIndex: 0 }];
    const scales = DataProcessor.createScales(plotData, 800, 600, margin);
    expect(scales).not.toBeNull();
    // padding = abs(7 - 7) * 0.05 = 0
    expect(scales!.x.domain()).toEqual([7, 7]);
    expect(scales!.y.domain()).toEqual([3, 3]);
    // construction must not throw — scale still returned
  });

  it('RESIZE path: same array reference → domain identical, range reflects new dimensions', () => {
    const plotData: PlotDataPoint[] = [
      { id: 'a', x: 0, y: 0, originalIndex: 0 },
      { id: 'b', x: 10, y: 10, originalIndex: 1 },
    ];
    const margin1 = { top: 10, right: 20, bottom: 30, left: 40 };

    // First call: 800×600
    const scales1 = DataProcessor.createScales(plotData, 800, 600, margin1);
    expect(scales1).not.toBeNull();
    const domain1X = scales1!.x.domain();
    const domain1Y = scales1!.y.domain();

    // Second call: SAME array, different dimensions (simulates resize)
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

  it('different plotData arrays with different coordinate ranges → different domains', () => {
    const plotData1: PlotDataPoint[] = [
      { id: 'a', x: 0, y: 0, originalIndex: 0 },
      { id: 'b', x: 10, y: 10, originalIndex: 1 },
    ];
    const plotData2: PlotDataPoint[] = [
      { id: 'c', x: 100, y: 200, originalIndex: 0 },
      { id: 'd', x: 300, y: 400, originalIndex: 1 },
    ];
    const width = 800;
    const height = 600;

    const scales1 = DataProcessor.createScales(plotData1, width, height, margin);
    const scales2 = DataProcessor.createScales(plotData2, width, height, margin);

    expect(scales1).not.toBeNull();
    expect(scales2).not.toBeNull();

    // Domains must differ — separate arrays, separate cache entries
    expect(scales1!.x.domain()).not.toEqual(scales2!.x.domain());
    expect(scales1!.y.domain()).not.toEqual(scales2!.y.domain());

    // Verify exact domains for each
    // plotData1: x in [0,10] → padding 0.5 → domain [-0.5, 10.5]
    expect(scales1!.x.domain()).toEqual([-0.5, 10.5]);
    // plotData2: x in [100,300] → range 200 → padding 10 → domain [90, 310]
    expect(scales2!.x.domain()).toEqual([90, 310]);
  });
});
