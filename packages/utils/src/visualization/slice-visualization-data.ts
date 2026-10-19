import type { VisualizationData } from '../types.js';
import { sliceAnnotationData } from './annotation-data-access.js';

/**
 * Build a VisualizationData constrained to `keptIndices` (ascending positions into
 * `data.protein_ids`). Projections are copied per-index into fresh Float32Arrays;
 * annotation_data is resliced via sliceAnnotationData (a CSR column's scores and
 * evidence with it); numeric/scores/evidence are resliced consistently (optional maps
 * absent on the source stay absent). The `annotations` metadata object is shared by
 * reference (per-index data lives in annotation_data, not annotations).
 *
 * Shared with `viewVisualizationDataByIndices` so the two cannot drift (and so
 * scores/evidence stay index-aligned with protein_ids).
 */
export function sliceVisualizationDataByIndices(
  data: VisualizationData,
  keptIndices: number[],
): VisualizationData {
  return sliceWith(data, keptIndices, eagerColumns);
}

/**
 * `sliceVisualizationDataByIndices`, except that each per-annotation column is sliced on
 * its first read. For the scatter plot's filtered and isolated views: they are handed
 * around whole (`data-change`, `getCurrentData()`), but their readers mostly touch the
 * selected annotation's column, and slicing all of them up front cost ~100 ms per isolate
 * at Swiss-Prot scale. The view keeps `data` and `keptIndices` alive until every column
 * has been read, so `keptIndices` must not change afterwards.
 */
export function viewVisualizationDataByIndices(
  data: VisualizationData,
  keptIndices: readonly number[],
): VisualizationData {
  return sliceWith(data, keptIndices, lazyColumns);
}

type ColumnMapper = <S, T>(src: Record<string, S>, slice: (column: S) => T) => Record<string, T>;

const eagerColumns: ColumnMapper = (src, slice) =>
  Object.fromEntries(Object.entries(src).map(([name, column]) => [name, slice(column)]));

/** Enumerable, assignable properties that slice their column on the first read. */
const lazyColumns: ColumnMapper = <S, T>(src: Record<string, S>, slice: (column: S) => T) => {
  const out: Record<string, T> = {};
  for (const [name, column] of Object.entries(src)) {
    let sliced: { value: T } | null = null;
    Object.defineProperty(out, name, {
      enumerable: true,
      configurable: true,
      get: () => (sliced ??= { value: slice(column) }).value,
      set: (value: T) => {
        sliced = { value };
      },
    });
  }
  return out;
};

function sliceWith(
  data: VisualizationData,
  keptIndices: readonly number[],
  columns: ColumnMapper,
): VisualizationData {
  const sliceRows = <T>(rows: readonly T[]): T[] => {
    const out = new Array<T>(keptIndices.length);
    for (let k = 0; k < keptIndices.length; k++) out[k] = rows[keptIndices[k]];
    return out;
  };
  const sliceRecord = <T>(
    src: Record<string, readonly T[]> | undefined,
  ): Record<string, T[]> | undefined => (src ? columns(src, sliceRows) : undefined);

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
    annotation_data: columns(data.annotation_data, (rows) =>
      sliceAnnotationData(rows, keptIndices),
    ),
    numeric_annotation_data: data.numeric_annotation_data
      ? columns(data.numeric_annotation_data, (values) => sliceFloat64(values, keptIndices))
      : undefined,
    annotation_predicted: sliceRecord(data.annotation_predicted),
    annotation_scores: sliceRecord(data.annotation_scores),
    annotation_evidence: sliceRecord(data.annotation_evidence),
  };
}

/**
 * Gather `values[keptIndices[k]]` into a fresh Float64Array. A preallocated indexed loop,
 * not `Float64Array.from(keptIndices, mapFn)`: the iterator + mapFn path is ~35x slower at
 * Swiss-Prot scale and this runs once per numeric column on every slice.
 */
function sliceFloat64(values: Float64Array, keptIndices: readonly number[]): Float64Array {
  const out = new Float64Array(keptIndices.length);
  for (let k = 0; k < keptIndices.length; k++) out[k] = values[keptIndices[k]];
  return out;
}
