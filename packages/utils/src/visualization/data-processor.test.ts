import { describe, it, expect } from 'vitest';
import { DataProcessor } from './data-processor';
import type { VisualizationData } from '../types';

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
