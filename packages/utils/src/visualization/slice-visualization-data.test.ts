import { describe, it, expect } from 'vitest';
import { sliceVisualizationDataByIndices } from './slice-visualization-data';
import { getProteinAnnotationIndices, isCsrAnnotationData } from './annotation-data-access';
import { getProteinEvidence, getProteinScores } from './plot-data-accessors';
import type { Annotation, VisualizationData } from '../types';

function baseViz(): VisualizationData {
  const famAnnotation: Annotation = {
    kind: 'categorical',
    values: ['a', 'b'],
    colors: ['#000', '#fff'],
    shapes: ['circle', 'square'],
  };
  return {
    protein_ids: ['p0', 'p1', 'p2', 'p3'],
    projections: [
      { name: 'umap', dimension: 2, data: new Float32Array([0, 0, 1, 1, 2, 2, 3, 3]) },
      { name: 'pca3', dimension: 3, data: new Float32Array([0, 0, 0, 1, 1, 1, 2, 2, 2, 3, 3, 3]) },
    ],
    annotations: { fam: famAnnotation },
    annotation_data: { fam: new Int32Array([0, 1, 0, 1]) },
    numeric_annotation_data: { plddt: [10, 20, 30, 40] },
    annotation_scores: { fam: [[[0.1]], [[0.2]], [[0.3]], [[0.4]]] },
    annotation_evidence: { fam: [['x'], ['y'], ['z'], ['w']] },
    annotation_predicted: {
      fam: [null, { value: 'b', confidence: 0.7, source: 'p0' }, null, null],
    },
  };
}

describe('sliceVisualizationDataByIndices', () => {
  it('keeps protein_ids in keptIndices order', () => {
    const out = sliceVisualizationDataByIndices(baseViz(), [1, 3]);
    expect(out.protein_ids).toEqual(['p1', 'p3']);
  });

  it('copies 2D and 3D projections per kept index into fresh Float32Arrays', () => {
    const src = baseViz();
    const out = sliceVisualizationDataByIndices(src, [1, 3]);
    expect(out.projections[0].dimension).toBe(2);
    expect(Array.from(out.projections[0].data)).toEqual([1, 1, 3, 3]);
    expect(out.projections[1].dimension).toBe(3);
    expect(Array.from(out.projections[1].data)).toEqual([1, 1, 1, 3, 3, 3]);
    // fresh buffer, not aliasing the source
    expect(out.projections[0].data).not.toBe(src.projections[0].data);
  });

  it('reslices annotation_data via sliceAnnotationData (Int32Array shape preserved)', () => {
    const out = sliceVisualizationDataByIndices(baseViz(), [1, 3]);
    expect(out.annotation_data.fam).toBeInstanceOf(Int32Array);
    expect(Array.from(out.annotation_data.fam as Int32Array)).toEqual([1, 1]);
  });

  it('reslices numeric_annotation_data to kept indices', () => {
    const out = sliceVisualizationDataByIndices(baseViz(), [1, 3]);
    expect(out.numeric_annotation_data!.plddt).toEqual([20, 40]);
  });

  it('reslices EAT cells in the same protein order', () => {
    const out = sliceVisualizationDataByIndices(baseViz(), [3, 1]);
    expect(out.annotation_predicted?.fam).toEqual([
      null,
      { value: 'b', confidence: 0.7, source: 'p0' },
    ]);
  });

  it('reslices annotation_scores AND annotation_evidence to kept indices (fixes drift)', () => {
    const out = sliceVisualizationDataByIndices(baseViz(), [1, 3]);
    expect(out.annotation_scores!.fam).toEqual([[[0.2]], [[0.4]]]);
    expect(out.annotation_evidence!.fam).toEqual([['y'], ['w']]);
  });

  it('omits optional maps that are absent on the source', () => {
    const src = baseViz();
    delete src.numeric_annotation_data;
    delete src.annotation_scores;
    delete src.annotation_evidence;
    const out = sliceVisualizationDataByIndices(src, [0]);
    expect(out.numeric_annotation_data).toBeUndefined();
    expect(out.annotation_scores).toBeUndefined();
    expect(out.annotation_evidence).toBeUndefined();
  });

  it('preserves annotations object by reference (not per-index data)', () => {
    const src = baseViz();
    const out = sliceVisualizationDataByIndices(src, [0]);
    expect(out.annotations).toBe(src.annotations);
  });
});

describe('sliceVisualizationDataByIndices over CSR storage (bundle format v3)', () => {
  // p0 → [a], p1 → [] , p2 → [b, a], p3 → [b]
  function csrViz(): VisualizationData {
    return {
      protein_ids: ['p0', 'p1', 'p2', 'p3'],
      projections: [{ name: 'umap', dimension: 2, data: new Float32Array(8) }],
      annotations: {
        fam: {
          kind: 'categorical',
          values: ['a', 'b'],
          colors: ['#000', '#fff'],
          shapes: ['circle', 'square'],
        },
      },
      annotation_data: {
        fam: {
          kind: 'csr',
          end: Int32Array.of(1, 1, 3, 4),
          codes: Int32Array.of(0, 1, 0, 1),
          length: 4,
        },
      },
      // Hits 0..3 in the same order as `codes`.
      annotation_scores_csr: {
        fam: {
          hitEnd: Int32Array.of(1, 1, 3, 4),
          values: Float64Array.of(0.5, 1.5, 2.5, 3.5),
        },
      },
      annotation_evidence_csr: {
        fam: { codes: Int32Array.of(0, -1, 1, 2), dict: ['IDA', 'IEA', 'IPI'] },
      },
    };
  }

  it('keeps the flat score/evidence payloads aligned with the sliced CSR rows', () => {
    const src = csrViz();
    // Reversed order and a dropped row, so a slice that just copies would be wrong.
    const out = sliceVisualizationDataByIndices(src, [3, 2, 1]);

    expect(isCsrAnnotationData(out.annotation_data.fam)).toBe(true);
    expect(getProteinAnnotationIndices(out.annotation_data.fam, 0)).toEqual([1]); // was p3
    expect(getProteinAnnotationIndices(out.annotation_data.fam, 1)).toEqual([1, 0]); // was p2
    expect(getProteinAnnotationIndices(out.annotation_data.fam, 2)).toEqual([]); // was p1

    // Same answers the source gave for the same proteins.
    for (const [before, after] of [
      [3, 0],
      [2, 1],
      [1, 2],
    ]) {
      expect(getProteinScores(out, after, 'fam')).toEqual(getProteinScores(src, before, 'fam'));
      expect(getProteinEvidence(out, after, 'fam')).toEqual(getProteinEvidence(src, before, 'fam'));
    }
    expect(getProteinScores(src, 2, 'fam')).toEqual([null, [1.5, 2.5]]);
    expect(getProteinEvidence(src, 2, 'fam')).toEqual([null, 'IEA']);
    expect(getProteinEvidence(src, 3, 'fam')).toEqual(['IPI']);
  });

  it('omits the flat payloads when the source has none', () => {
    const out = sliceVisualizationDataByIndices(baseViz(), [0]);
    expect(out.annotation_scores_csr).toBeUndefined();
    expect(out.annotation_evidence_csr).toBeUndefined();
  });
});
