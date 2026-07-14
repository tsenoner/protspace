import type { VisualizationData } from '../types.js';
import { sliceAnnotationData } from './annotation-data-access.js';

/**
 * Build a VisualizationData constrained to `keptIndices` (ascending positions into
 * `data.protein_ids`). Projections are copied per-index into fresh Float32Arrays;
 * annotation_data is resliced via sliceAnnotationData; numeric/scores/evidence are
 * resliced consistently (optional maps absent on the source stay absent). The
 * `annotations` metadata object is shared by reference (per-index data lives in
 * annotation_data, not annotations).
 *
 * Shared by the scatter-plot filtered-display path and the isolation path so the
 * two cannot drift (and so scores/evidence stay index-aligned with protein_ids).
 */
export function sliceVisualizationDataByIndices(
  data: VisualizationData,
  keptIndices: number[],
): VisualizationData {
  const sliceRows = <T>(rows: readonly T[]): T[] => {
    const out = new Array<T>(keptIndices.length);
    for (let k = 0; k < keptIndices.length; k++) out[k] = rows[keptIndices[k]];
    return out;
  };
  const sliceRecord = <T>(
    src: Record<string, readonly T[]> | undefined,
  ): Record<string, T[]> | undefined =>
    src
      ? Object.fromEntries(Object.entries(src).map(([name, rows]) => [name, sliceRows(rows)]))
      : undefined;

  return {
    ...data,
    protein_ids: keptIndices.map((index) => data.protein_ids[index]),
    projections: data.projections.map((projection) => {
      const dim = projection.dimension;
      const out = new Float32Array(keptIndices.length * dim);
      for (let k = 0; k < keptIndices.length; k++) {
        const base = keptIndices[k] * dim;
        const o = k * dim;
        out[o] = projection.data[base];
        out[o + 1] = projection.data[base + 1];
        if (dim === 3) out[o + 2] = projection.data[base + 2];
      }
      return { ...projection, data: out, dimension: dim };
    }),
    annotation_data: Object.fromEntries(
      Object.entries(data.annotation_data).map(([name, rows]) => [
        name,
        sliceAnnotationData(rows, keptIndices),
      ]),
    ),
    numeric_annotation_data: sliceRecord(data.numeric_annotation_data),
    annotation_predicted: sliceRecord(data.annotation_predicted),
    annotation_scores: sliceRecord(data.annotation_scores),
    annotation_evidence: sliceRecord(data.annotation_evidence),
  };
}
