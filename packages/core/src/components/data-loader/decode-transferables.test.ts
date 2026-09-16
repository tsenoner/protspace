import { describe, it, expect } from 'vitest';
import { isCsrAnnotationData, type VisualizationData } from '@protspace/utils';
import { collectTransferables } from './decode-transferables';

/**
 * Hand-built CSR dataset. `end` and `codes` deliberately share one ArrayBuffer, which
 * is the case that makes deduplication load-bearing: `postMessage` throws
 * `DataCloneError` on a transfer list that names the same buffer twice.
 */
function csrDataset(): { data: VisualizationData; shared: ArrayBuffer } {
  const shared = new ArrayBuffer(6 * 4);
  const end = new Int32Array(shared, 0, 3); // 3 proteins
  const codes = new Int32Array(shared, 12, 3);
  end.set([1, 2, 3]);
  codes.set([0, 1, 0]);

  return {
    shared,
    data: {
      protein_ids: ['P1', 'P2', 'P3'],
      projections: [
        { name: 'pca2', data: new Float32Array(6), dimension: 2 },
        { name: 'umap3', data: new Float32Array(9), dimension: 3 },
      ],
      annotations: {
        go_bp: { kind: 'categorical', values: ['a', 'b'], colors: [], shapes: [] },
        organism: { kind: 'categorical', values: ['x'], colors: [], shapes: [] },
      },
      annotation_data: {
        go_bp: { kind: 'csr', end, codes, length: 3 },
        organism: new Int32Array([0, 0, 0]),
      },
      annotation_scores_csr: {
        go_bp: { hitEnd: new Int32Array([1, 1, 2]), values: new Float32Array([0.5, 0.25]) },
      },
      annotation_evidence_csr: {
        go_bp: { codes: new Int32Array([-1, 0, -1]), dict: ['IDA'] },
      },
    },
  };
}

/** Every typed array `collectTransferables` names a buffer for, in a stable order. */
const bulkViews = (data: VisualizationData): (Int32Array | Float32Array)[] => [
  ...data.projections.map((projection) => projection.data as Float32Array),
  ...Object.values(data.annotation_data).flatMap((value) =>
    value instanceof Int32Array
      ? [value]
      : isCsrAnnotationData(value)
        ? [value.end, value.codes]
        : [],
  ),
  ...Object.values(data.annotation_scores_csr ?? {}).flatMap((scores) => [
    scores.hitEnd,
    scores.values,
  ]),
  ...Object.values(data.annotation_evidence_csr ?? {}).map((evidence) => evidence.codes),
];

describe('collectTransferables', () => {
  it('names every bulk buffer exactly once, even when two views share one', () => {
    const { data, shared } = csrDataset();
    const transfer = collectTransferables(data);

    expect(new Set(transfer).size).toBe(transfer.length);
    expect(transfer).toContain(shared);
    // 2 projections + the shared CSR buffer + organism codes + score hitEnd + score
    // values + evidence codes. Without deduplication this would be 8: `end` and
    // `codes` would each name `shared`.
    expect(transfer).toHaveLength(7);
  });

  it('actually transfers: the clone holds the bytes and every source is detached', () => {
    const { data } = csrDataset();
    const transfer = collectTransferables(data);
    const sources = bulkViews(data);
    const before = sources.map((view) => Array.from(view));

    const clone = structuredClone(data, { transfer });

    expect(clone.protein_ids).toEqual(['P1', 'P2', 'P3']);
    expect(sources.every((array) => array.byteLength === 0)).toBe(true);
    // A detached sender proves only that something moved. What has to survive is the
    // content, including the two views that share one buffer at different offsets.
    expect(bulkViews(clone).map((view) => Array.from(view))).toEqual(before);
    expect(before).toEqual([
      [0, 0, 0, 0, 0, 0],
      [0, 0, 0, 0, 0, 0, 0, 0, 0],
      [1, 2, 3],
      [0, 1, 0],
      [0, 0, 0],
      [1, 1, 2],
      [0.5, 0.25],
      [-1, 0, -1],
    ]);
  });

  it('leaves a v1/v2 dataset with only its projection and Int32Array buffers', () => {
    const data: VisualizationData = {
      protein_ids: ['P1'],
      projections: [{ name: 'pca2', data: new Float32Array(2), dimension: 2 }],
      annotations: { organism: { kind: 'categorical', values: ['x'], colors: [], shapes: [] } },
      annotation_data: { organism: new Int32Array([0]), multi: [[0]] },
    };

    expect(collectTransferables(data)).toHaveLength(2);
  });
});
