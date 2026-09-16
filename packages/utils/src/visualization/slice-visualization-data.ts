import type { AnnotationData, CsrEvidence, CsrScores, VisualizationData } from '../types.js';
import {
  getCsrHitRange,
  isCsrAnnotationData,
  sliceAnnotationData,
} from './annotation-data-access.js';

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

  /**
   * Source hit numbers the kept proteins own, in kept order — the same order
   * `sliceAnnotationData` concatenates their codes in, so the sliced flat payloads
   * stay aligned with the sliced CSR storage. `null` when the column is not CSR,
   * in which case there is no hit numbering to slice by.
   */
  const keptHits = (rows: AnnotationData | undefined): Int32Array | null => {
    if (!rows || !isCsrAnnotationData(rows)) return null;
    let total = 0;
    for (const index of keptIndices) {
      const [start, stop] = getCsrHitRange(rows, index);
      total += stop - start;
    }
    const hits = new Int32Array(total);
    let cursor = 0;
    for (const index of keptIndices) {
      const [start, stop] = getCsrHitRange(rows, index);
      for (let hit = start; hit < stop; hit++) hits[cursor++] = hit;
    }
    return hits;
  };
  const sliceScoresCsr = (
    src: Record<string, CsrScores> | undefined,
  ): Record<string, CsrScores> | undefined =>
    src &&
    Object.fromEntries(
      Object.entries(src).map(([name, csr]) => {
        const hits = keptHits(data.annotation_data[name]);
        if (!hits) return [name, csr];
        let total = 0;
        for (const hit of hits) total += csr.hitEnd[hit] - (hit === 0 ? 0 : csr.hitEnd[hit - 1]);
        const hitEnd = new Int32Array(hits.length);
        const values = new Float64Array(total);
        let cursor = 0;
        for (let k = 0; k < hits.length; k++) {
          const hit = hits[k];
          const from = hit === 0 ? 0 : csr.hitEnd[hit - 1];
          const to = csr.hitEnd[hit];
          if (to > from) values.set(csr.values.subarray(from, to), cursor);
          cursor += to - from;
          hitEnd[k] = cursor;
        }
        return [name, { hitEnd, values }];
      }),
    );
  const sliceEvidenceCsr = (
    src: Record<string, CsrEvidence> | undefined,
  ): Record<string, CsrEvidence> | undefined =>
    src &&
    Object.fromEntries(
      Object.entries(src).map(([name, csr]) => {
        const hits = keptHits(data.annotation_data[name]);
        if (!hits) return [name, csr];
        const codes = new Int32Array(hits.length);
        for (let k = 0; k < hits.length; k++) codes[k] = csr.codes[hits[k]];
        return [name, { codes, dict: csr.dict }];
      }),
    );

  return {
    ...data,
    // Statistics are scored over the whole dataset; carried onto a slice they would claim to
    // describe the subset. Dropping them here makes every subset self-describing, so no
    // exporter or consumer of sliced data has to re-derive that rule.
    //
    // Both representations must go together: `statistics` is what an export re-emits and
    // `statisticsRows` is what the UI renders, so keeping either one would leave a slice
    // that lies in one of the two directions. This is the only place they are cleared.
    statistics: undefined,
    statisticsRows: undefined,
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
    annotation_scores_csr: sliceScoresCsr(data.annotation_scores_csr),
    annotation_evidence_csr: sliceEvidenceCsr(data.annotation_evidence_csr),
  };
}
