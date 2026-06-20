import { describe, it, expect } from 'vitest';
import { sliceVisualizationDataByIndices } from './slice-visualization-data';
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
