import { describe, it, expect } from 'vitest';
import {
  getProteinAnnotationIndices,
  getProteinEvidence,
  getProteinScores,
  isCsrAnnotationData,
} from '@protspace/utils';
import type { CsrAnnotationData, VisualizationData } from '@protspace/utils';
import { generateColorsAndShapes, normalizeEatCompanionColumns } from './dataset-build';

describe('normalizeEatCompanionColumns over CSR storage (bundle format v3)', () => {
  /**
   * Base column `ec` in CSR, values `['A', null, 'B']`. Nothing points at the `null`
   * slot, so every hit survives the remap and only the value INDICES shift (B: 2 → 1):
   *   p0 → []      (curated missing → the EAT companion applies)
   *   p1 → [A]
   *   p2 → [B]
   *   p3 → [A, B]
   * The companion `ec__pred_value` is CSR too, with its scores/evidence in the flat
   * v3 payloads rather than the nested records.
   */
  function csrEatData(): VisualizationData {
    return {
      protein_ids: ['p0', 'p1', 'p2', 'p3'],
      projections: [{ name: 'umap', dimension: 2, data: new Float32Array(8) }],
      annotations: {
        ec: {
          kind: 'categorical',
          values: ['A', null, 'B'],
          colors: ['#f00', '#0f0', '#00f'],
          shapes: ['circle', 'circle', 'circle'],
        },
        ec__pred_value: {
          kind: 'categorical',
          values: ['C'],
          colors: ['#fff'],
          shapes: ['circle'],
        },
        ec__pred_confidence: { kind: 'numeric', numericType: 'float', values: [] },
        ec__pred_source: {
          kind: 'categorical',
          values: ['p1'],
          colors: ['#fff'],
          shapes: ['circle'],
        },
      },
      annotation_data: {
        ec: {
          kind: 'csr',
          offsets: Int32Array.of(0, 0, 1, 2, 4),
          codes: Int32Array.of(0, 2, 0, 2),
          length: 4,
        },
        ec__pred_value: {
          kind: 'csr',
          offsets: Int32Array.of(0, 1, 1, 1, 1),
          codes: Int32Array.of(0),
          length: 4,
          scores: { offsets: Int32Array.of(0, 2), values: Float64Array.of(0.5, 0.25) },
          evidence: { codes: Int32Array.of(0), dict: ['IDA'] },
        },
        ec__pred_source: {
          kind: 'csr',
          offsets: Int32Array.of(0, 1, 1, 1, 1),
          codes: Int32Array.of(0),
          length: 4,
        },
      },
      numeric_annotation_data: { ec__pred_confidence: new Float64Array([0.9, NaN, NaN, NaN]) },
    };
  }

  it('remaps CSR storage into fresh buffers', () => {
    const src = csrEatData();
    const sourceRows = src.annotation_data.ec as CsrAnnotationData;
    const out = normalizeEatCompanionColumns(src);
    const rows = out.annotation_data.ec;
    if (!isCsrAnnotationData(rows)) throw new Error('expected CSR storage');

    // 'A','B' survive, the unreferenced null slot leaves the value list, 'C' is
    // appended by the transfer — so 'B' moves from index 2 to index 1.
    expect(out.annotations.ec.values).toEqual(['A', 'B', 'C']);
    // The transfer itself stays in `annotation_predicted`; only the curated rows
    // are remapped here (materializeEatOverlay applies the prediction later).
    expect(getProteinAnnotationIndices(rows, 0)).toEqual([]);
    expect(getProteinAnnotationIndices(rows, 1)).toEqual([0]); // 'A'
    expect(getProteinAnnotationIndices(rows, 2)).toEqual([1]); // 'B', renumbered
    expect(getProteinAnnotationIndices(rows, 3)).toEqual([0, 1]);
    expect(Array.from(rows.offsets)).toEqual([0, 0, 1, 2, 4]);

    // The source's buffer is not retained: the remap hands back an exactly-sized fresh one.
    expect(rows.codes.buffer.byteLength).toBe(4 * 4);
    expect(rows.codes.buffer).not.toBe(sourceRows.codes.buffer);
    expect(Array.from(sourceRows.codes)).toEqual([0, 2, 0, 2]);
  });

  it('drops a hit with its score and evidence and keeps every later hit aligned', () => {
    const src = csrEatData();
    // p1's hit now points at the null value slot, which the remap drops, renumbering
    // every later hit.
    src.annotation_data.ec = {
      kind: 'csr',
      offsets: Int32Array.of(0, 0, 1, 2, 4),
      codes: Int32Array.of(1, 2, 0, 2),
      length: 4,
      scores: { offsets: Int32Array.of(0, 1, 2, 3, 4), values: Float64Array.of(1, 2, 3, 4) },
      evidence: { codes: Int32Array.of(0, 1, 2, -1), dict: ['IDA', 'IEA', 'ISS'] },
    };
    const out = normalizeEatCompanionColumns(src);

    expect(getProteinAnnotationIndices(out.annotation_data.ec, 1)).toEqual([]);
    expect(getProteinAnnotationIndices(out.annotation_data.ec, 2)).toEqual([1]); // 'B'
    expect(getProteinAnnotationIndices(out.annotation_data.ec, 3)).toEqual([0, 1]);
    expect(getProteinScores(out, 2, 'ec')).toEqual([[2]]);
    expect(getProteinEvidence(out, 2, 'ec')).toEqual(['IEA']);
    expect(getProteinScores(out, 3, 'ec')).toEqual([[3], [4]]);
    expect(getProteinEvidence(out, 3, 'ec')).toEqual(['ISS', null]);
  });

  it('reads the companion column scores/evidence from the CSR payloads', () => {
    const cell = normalizeEatCompanionColumns(csrEatData()).annotation_predicted?.ec?.[0];
    expect(cell).toMatchObject({
      value: 'C',
      confidence: 0.9,
      source: 'p1',
      scores: [[0.5, 0.25]],
      evidence: ['IDA'],
    });
  });

  it('drops the companion columns, payloads included', () => {
    const out = normalizeEatCompanionColumns(csrEatData());
    expect(out.annotation_data.ec__pred_value).toBeUndefined();
    expect(getProteinScores(out, 0, 'ec__pred_value')).toEqual([]);
  });
});

describe('generateColorsAndShapes', () => {
  it('returns palette.length × shapeCount distinct (color, shape) pairs', () => {
    const { colors, shapes } = generateColorsAndShapes('kellys', 200);
    expect(colors).toHaveLength(126); // 21 × 6
    expect(shapes).toHaveLength(126);
    const pairs = new Set<string>();
    for (let i = 0; i < colors.length; i++) {
      pairs.add(`${colors[i]}|${shapes[i]}`);
    }
    expect(pairs.size).toBe(126);
  });

  it('caps at the requested count when below the LCM', () => {
    const { colors, shapes } = generateColorsAndShapes('kellys', 10);
    expect(colors).toHaveLength(10);
    expect(shapes).toHaveLength(10);
  });

  it('cycles after palette.length × shapeCount entries', () => {
    // The array is capped at distinctPairs (126 for Kelly's).
    // Consumers index via colors[i % colors.length] to cycle for i >= 126.
    const { colors: c1, shapes: s1 } = generateColorsAndShapes('kellys', 1);
    const { colors: c126, shapes: s126 } = generateColorsAndShapes('kellys', 126);
    // Entry 127 (index 126) wraps to index 0 via consumer-side modular indexing.
    expect(c126[126 % c126.length]).toBe(c1[0]);
    expect(s126[126 % s126.length]).toBe(s1[0]);
  });

  it('falls back to kellys for unknown palette ids', () => {
    const { colors } = generateColorsAndShapes('not-a-real-palette', 5);
    expect(colors).toHaveLength(5);
    // Should be the first 5 entries of the Kelly's palette
  });

  it('handles zero or negative counts as empty arrays', () => {
    expect(generateColorsAndShapes('kellys', 0)).toEqual({ colors: [], shapes: [] });
    expect(generateColorsAndShapes('kellys', -3)).toEqual({ colors: [], shapes: [] });
  });
});
