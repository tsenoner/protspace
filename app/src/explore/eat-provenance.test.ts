import { describe, expect, it } from 'vitest';
import type { VisualizationData } from '@protspace/utils';
import { EatProvenanceResolver } from './eat-provenance';

function makeData(): VisualizationData {
  const proteinIds = ['source', ...Array.from({ length: 24 }, (_, index) => `query-${index}`)];
  return {
    protein_ids: proteinIds,
    projections: [{ name: 'pca', data: new Float32Array(proteinIds.length * 2), dimension: 2 }],
    annotations: {
      ec: { kind: 'categorical', values: [], colors: [], shapes: [] },
      family: { kind: 'categorical', values: [], colors: [], shapes: [] },
    },
    annotation_data: {
      ec: new Int32Array(proteinIds.length).fill(-1),
      family: new Int32Array(proteinIds.length).fill(-1),
    },
    annotation_predicted: {
      ec: [
        null,
        ...proteinIds.slice(1).map((_, index) => ({
          value: `EC-${index}`,
          confidence: 1 - index / 100,
          source: 'source',
        })),
      ],
      family: [null, { value: 'PF1', confidence: 0.4, source: 'other-source' }],
    },
  };
}

describe('EatProvenanceResolver', () => {
  it('uses the active annotation cell for a predicted-to-source click', () => {
    const data = makeData();
    const resolver = new EatProvenanceResolver();

    expect(resolver.resolve(data, 'family', 'query-0', new Set(data.protein_ids))).toEqual({
      pairs: [
        {
          sourceProteinId: 'other-source',
          targetProteinId: 'query-0',
          confidence: 0.4,
        },
      ],
      totalCandidates: 1,
    });
  });

  it('filters to the visible view, orders deterministically, and caps fan-out at 20', () => {
    const data = makeData();
    const resolver = new EatProvenanceResolver();
    const visible = new Set(data.protein_ids.filter((id) => id !== 'query-2'));

    const request = resolver.resolve(data, 'ec', 'source', visible);

    expect(request?.totalCandidates).toBe(23);
    expect(request?.pairs).toHaveLength(20);
    expect(request?.pairs.map((pair) => pair.targetProteinId)).not.toContain('query-2');
    expect(request?.pairs[0]).toMatchObject({ targetProteinId: 'query-0', confidence: 1 });
    expect(request?.pairs.map((pair) => pair.targetProteinId).slice(-2)).toEqual([
      'query-19',
      'query-20',
    ]);
  });

  it('reuses one source index for the same data reference and annotation', () => {
    const data = makeData();
    const resolver = new EatProvenanceResolver();

    const first = resolver.getSourceIndex(data, 'ec');
    const second = resolver.getSourceIndex(data, 'ec');
    const otherAnnotation = resolver.getSourceIndex(data, 'family');

    expect(second).toBe(first);
    expect(otherAnnotation).not.toBe(first);
  });

  it('breaks equal-confidence ties by ascending protein id', () => {
    const data = makeData();
    const cells = data.annotation_predicted?.ec;
    if (!cells?.[1] || !cells[2]) throw new Error('invalid test fixture');
    cells[1].confidence = 0.99;
    cells[2].confidence = 0.99;
    const resolver = new EatProvenanceResolver();

    const request = resolver.resolve(data, 'ec', 'source', new Set(data.protein_ids));

    expect(request?.pairs.slice(0, 2).map((pair) => pair.targetProteinId)).toEqual([
      'query-0',
      'query-1',
    ]);
  });
});
