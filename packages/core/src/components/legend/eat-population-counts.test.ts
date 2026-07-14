import { describe, expect, it } from 'vitest';
import { sliceVisualizationDataByIndices, type VisualizationData } from '@protspace/utils';
import { computeEatPopulationCounts } from './eat-population-counts';

function makeData(): VisualizationData {
  return {
    protein_ids: ['o1', 'o2', 'p1', 'p2', 'm1', 'm2'],
    projections: [{ name: 'pca', dimension: 2, data: new Float32Array(12) }],
    annotations: {
      ec: {
        kind: 'categorical',
        values: ['observed', '__NA__'],
        colors: ['#000', '#ccc'],
        shapes: ['circle', 'circle'],
      },
    },
    annotation_data: { ec: new Int32Array([0, 0, 1, 1, 1, 1]) },
    annotation_predicted: {
      ec: [
        null,
        null,
        { value: 'predicted', confidence: 0.9, source: 'o1' },
        { value: 'predicted', confidence: 0.8, source: 'o1' },
        null,
        null,
      ],
    },
  };
}

describe('EAT population accounting', () => {
  it.each([
    ['full', [0, 1, 2, 3, 4, 5], { observed: 2, predicted: 2, missing: 2, total: 6 }],
    ['filtered', [0, 2, 4], { observed: 1, predicted: 1, missing: 1, total: 3 }],
    ['isolated', [1, 3], { observed: 1, predicted: 1, missing: 0, total: 2 }],
  ] as const)('partitions the %s represented view', (_view, indices, expected) => {
    const view = sliceVisualizationDataByIndices(makeData(), [...indices]);
    const counts = computeEatPopulationCounts(view, 'ec', true);

    expect(counts).toEqual(expected);
    expect(counts!.observed + counts!.predicted + counts!.missing).toBe(counts!.total);
  });
});
