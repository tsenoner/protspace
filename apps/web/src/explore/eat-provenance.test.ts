import { describe, expect, it, vi } from 'vitest';
import type { VisualizationData } from '@protspace/utils';
import { getProvenanceConnectorStatus } from '../../../../packages/core/src/components/scatter-plot/provenance/connector-overlay-controller';
import { EatProvenanceResolver } from './eat-provenance';

function makeData(queryCount = 24): VisualizationData {
  const proteinIds = [
    'source',
    ...Array.from({ length: queryCount }, (_, index) => `query-${index}`),
  ];
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
          confidence: 1 - index / (queryCount + 1),
          source: 'source',
        })),
      ],
      family: [null, { value: 'PF1', confidence: 0.4, source: 'query-1' }],
    },
  };
}

describe('EatProvenanceResolver', () => {
  const allLegendEligible = () => true;

  it('uses the active annotation cell for a predicted-to-source click', () => {
    const data = makeData();
    const resolver = new EatProvenanceResolver();

    expect(resolver.resolve(data, 'family', 'query-0', 1, allLegendEligible)).toEqual({
      pairs: [
        {
          sourceProteinId: 'query-1',
          targetProteinId: 'query-0',
          confidence: 0.4,
        },
      ],
      totalCandidates: 1,
      unavailableCandidates: 0,
    });
  });

  it('rejects a predicted click when its source endpoint is legend-hidden', () => {
    const data = makeData();
    const resolver = new EatProvenanceResolver();
    expect(
      resolver.resolve(data, 'ec', 'query-0', 1, (proteinId) => proteinId !== 'source'),
    ).toBeNull();
  });

  it('rejects a source click when the predicted endpoint is legend-hidden', () => {
    const data = makeData();
    const resolver = new EatProvenanceResolver();
    const request = resolver.resolve(
      data,
      'ec',
      'source',
      0,
      (proteinId) => proteinId !== 'query-0',
    );

    expect(request?.pairs.map((pair) => pair.targetProteinId)).not.toContain('query-0');
    expect(request?.totalCandidates).toBe(23);
  });

  it('orders deterministically and caps retained fan-out identities at 20', () => {
    const data = makeData();
    const resolver = new EatProvenanceResolver();
    const request = resolver.resolve(data, 'ec', 'source', 0, allLegendEligible);

    expect(request?.totalCandidates).toBe(24);
    expect(request?.unavailableCandidates).toBe(0);
    expect(request?.pairs).toHaveLength(20);
    expect(request?.pairs.map((pair) => pair.targetProteinId)).toContain('query-2');
    expect(request?.pairs[0]).toMatchObject({ targetProteinId: 'query-0', confidence: 1 });
    expect(request?.pairs.map((pair) => pair.targetProteinId).slice(-2)).toEqual([
      'query-18',
      'query-19',
    ]);
  });

  it.each(['filtering', 'isolation'])(
    'fills the visible fan-out cap and restores confidence order after %s expands',
    () => {
      const data = makeData();
      const resolver = new EatProvenanceResolver();
      let queryTwoVisible = false;
      const isInCurrentView = (proteinIndex: number) => queryTwoVisible || proteinIndex !== 3;

      const constrained = resolver.resolve(
        data,
        'ec',
        'source',
        0,
        allLegendEligible,
        isInCurrentView,
      );
      expect(constrained).toMatchObject({
        totalCandidates: 24,
        unavailableCandidates: 1,
      });
      expect(constrained?.pairs).toHaveLength(20);
      expect(constrained?.pairs.map((pair) => pair.targetProteinId)).not.toContain('query-2');
      expect(constrained?.pairs.map((pair) => pair.targetProteinId)).toContain('query-20');

      queryTwoVisible = true;
      const expanded = resolver.resolve(
        data,
        'ec',
        'source',
        0,
        allLegendEligible,
        isInCurrentView,
      );
      expect(expanded).toMatchObject({
        totalCandidates: 24,
        unavailableCandidates: 0,
      });
      expect(expanded?.pairs).toHaveLength(20);
      expect(expanded?.pairs.map((pair) => pair.targetProteinId)).toContain('query-2');
      expect(expanded?.pairs.map((pair) => pair.targetProteinId)).not.toContain('query-20');
    },
  );

  it('reuses one source index for the same data reference and annotation', () => {
    const data = makeData();
    const resolver = new EatProvenanceResolver();

    const first = resolver.getSourceIndex(data, 'ec');
    const second = resolver.getSourceIndex(data, 'ec');
    const otherAnnotation = resolver.getSourceIndex(data, 'family');

    expect(second).toBe(first);
    expect(otherAnnotation).not.toBe(first);
  });

  it('reuses cached ordering and bounded allocation for repeated large fan-out clicks', () => {
    const data = makeData(50_000);
    const resolver = new EatProvenanceResolver();
    const sortSpy = vi.spyOn(Array.prototype, 'sort');
    const sourceIndex = resolver.getSourceIndex(data, 'ec');
    const sortCallsAfterIndexBuild = sortSpy.mock.calls.length;
    const cachedCandidates = sourceIndex.get('source');
    if (!cachedCandidates) throw new Error('large-fan-out source was not indexed');

    Object.defineProperties(cachedCandidates, {
      filter: {
        value: () => {
          throw new Error('source resolution must not allocate a full filtered candidate array');
        },
      },
      slice: {
        value: () => {
          throw new Error('source resolution must not slice the full cached candidate list');
        },
      },
      sort: {
        value: () => {
          throw new Error('source resolution must not re-sort cached candidates');
        },
      },
    });

    for (let click = 0; click < 3; click++) {
      const request = resolver.resolve(data, 'ec', 'source', 0, allLegendEligible);
      expect(request?.totalCandidates).toBe(50_000);
      expect(request?.pairs).toHaveLength(20);
      expect(request?.pairs[0]).toMatchObject({ targetProteinId: 'query-0', confidence: 1 });
    }
    expect(sortSpy).toHaveBeenCalledTimes(sortCallsAfterIndexBuild);
  });

  it('breaks equal-confidence ties by ascending protein id', () => {
    const data = makeData();
    const cells = data.annotation_predicted?.ec;
    if (!cells?.[1] || !cells[2]) throw new Error('invalid test fixture');
    cells[1].confidence = 0.99;
    cells[2].confidence = 0.99;
    const resolver = new EatProvenanceResolver();

    const request = resolver.resolve(data, 'ec', 'source', 0, allLegendEligible);

    expect(request?.pairs.slice(0, 2).map((pair) => pair.targetProteinId)).toEqual([
      'query-0',
      'query-1',
    ]);
  });

  it('uses a filtered point global index instead of its local rendered position', () => {
    const data = makeData();
    const resolver = new EatProvenanceResolver();

    const request = resolver.resolve(data, 'ec', 'query-7', 8, allLegendEligible);

    expect(request?.pairs[0]).toMatchObject({
      sourceProteinId: 'source',
      targetProteinId: 'query-7',
    });
  });

  it.each(['filtering', 'isolation'])(
    're-resolves semantic clicks across %s expansion in both click directions',
    () => {
      const data = makeData(1);
      const resolver = new EatProvenanceResolver();
      const constrained = [
        resolver.resolve(data, 'ec', 'source', 0, allLegendEligible, (index) => index === 0),
        resolver.resolve(data, 'ec', 'query-0', 1, allLegendEligible, (index) => index === 1),
      ];

      for (const request of constrained) {
        expect(request).toEqual({
          totalCandidates: 1,
          unavailableCandidates: 1,
          pairs: [],
        });
        expect(getProvenanceConnectorStatus(request!, 0).missingEndpoints).toBe(1);
      }

      const expanded = [
        resolver.resolve(data, 'ec', 'source', 0, allLegendEligible),
        resolver.resolve(data, 'ec', 'query-0', 1, allLegendEligible),
      ];
      for (const request of expanded) {
        expect(request).toMatchObject({
          totalCandidates: 1,
          unavailableCandidates: 0,
          pairs: [
            {
              sourceProteinId: 'source',
              targetProteinId: 'query-0',
            },
          ],
        });
        expect(getProvenanceConnectorStatus(request!, 1).missingEndpoints).toBe(0);
      }
    },
  );

  it('counts a filtered source once from resolver through accessible overlay status', () => {
    const data = makeData();
    const request = new EatProvenanceResolver().resolve(
      data,
      'ec',
      'query-0',
      1,
      allLegendEligible,
      (index) => index === 1,
    );
    expect(request).not.toBeNull();

    expect(getProvenanceConnectorStatus(request!, 0)).toEqual({
      shown: 0,
      total: 1,
      missingEndpoints: 1,
    });
  });

  it('resolves a producer-decoded reserved-character source id exactly', () => {
    const sourceId = 'P0|ref;literal%3B';
    const data = makeData(1);
    data.protein_ids = [sourceId, 'query'];
    data.annotation_predicted!.ec = [
      null,
      { value: 'EC-0', confidence: 0.9, source: sourceId, sourceIndex: 0 },
    ];
    const resolver = new EatProvenanceResolver();

    const request = resolver.resolve(data, 'ec', 'query', 1, allLegendEligible);

    expect(request?.pairs[0]).toMatchObject({
      sourceProteinId: sourceId,
      targetProteinId: 'query',
    });
  });
});
