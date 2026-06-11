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

  it('drops the z coordinate for 3D projections (rendered as 2D)', () => {
    const data: VisualizationData = {
      protein_ids: ['p0'],
      projections: [{ name: 't', data: [[1, 2, 3]] }],
      annotations: {},
      annotation_data: {},
    };
    const result = DataProcessor.processVisualizationData(data, 0);
    expect(result[0]).toEqual({ id: 'p0', x: 1, y: 2, originalIndex: 0 });
    expect(result[0]).not.toHaveProperty('z');
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

  it('combines query-filter and isolation: result is intersection with global originalIndex on non-prefix subset', () => {
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
    // query filter retains p1,p2,p3; isolation retains p0,p1,p2 → intersection = {p1, p2}
    const result = DataProcessor.processVisualizationData(
      data,
      0,
      true,
      [['p0', 'p1', 'p2']],
      new Set(['p1', 'p2', 'p3']),
    );
    expect(result).toHaveLength(2);
    // originalIndex must be the GLOBAL index into protein_ids, not a slice-local index
    expect(result[0]).toEqual({ id: 'p1', x: 1, y: 1, originalIndex: 1 });
    expect(result[1]).toEqual({ id: 'p2', x: 2, y: 2, originalIndex: 2 });
    // bare shape: no extra keys beyond {id, originalIndex, x, y}
    expect(Object.keys(result[0]).sort()).toEqual(['id', 'originalIndex', 'x', 'y']);
  });

  it('combines query-filter and multi-layer isolation: query-filter applied before all isolation layers', () => {
    const data: VisualizationData = {
      protein_ids: ['p0', 'p1', 'p2', 'p3', 'p4'],
      projections: [
        {
          name: 't',
          data: [
            [0, 0],
            [1, 1],
            [2, 2],
            [3, 3],
            [4, 4],
          ],
        },
      ],
      annotations: {},
      annotation_data: {},
    };
    // query filter retains p1,p2,p3,p4
    // isolation layer 0 retains p0,p1,p2,p3 → after intersect: p1,p2,p3
    // isolation layer 1 retains p2,p3,p4   → after intersect: p2,p3
    const result = DataProcessor.processVisualizationData(
      data,
      0,
      true,
      [
        ['p0', 'p1', 'p2', 'p3'],
        ['p2', 'p3', 'p4'],
      ],
      new Set(['p1', 'p2', 'p3', 'p4']),
    );
    expect(result.map((p) => p.id)).toEqual(['p2', 'p3']);
    expect(result[0].originalIndex).toBe(2);
    expect(result[1].originalIndex).toBe(3);
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

  it('null/undefined visibleProteinIds skips cull; empty Set culls to zero', () => {
    const data: VisualizationData = {
      protein_ids: ['p0', 'p1'],
      projections: [
        {
          name: 't',
          data: [
            [0, 0],
            [1, 1],
          ],
        },
      ],
      annotations: {},
      annotation_data: {},
    };
    // null/undefined → guard `if (visibleProteinIds)` is falsy → no filtering
    expect(
      DataProcessor.processVisualizationData(data, 0, false, undefined, undefined),
    ).toHaveLength(2);
    expect(DataProcessor.processVisualizationData(data, 0, false, undefined, null)).toHaveLength(2);
    // empty Set is truthy → filter runs → zero matches → empty result
    expect(
      DataProcessor.processVisualizationData(data, 0, false, undefined, new Set<string>()),
    ).toHaveLength(0);
  });
});
