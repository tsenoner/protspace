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
  return sliceWith(data, keptIndices, false);
}

/**
 * `sliceVisualizationDataByIndices`, except that each per-annotation column and each
 * projection's coordinates are sliced on their first read. For the scatter plot's filtered
 * and isolated views: they are handed around whole (`data-change`, `getCurrentData()`), but
 * their readers mostly touch the selected annotation's column and the selected projection
 * (the plot itself draws from the unsliced data). Slicing every column up front cost ~100 ms
 * per isolate at Swiss-Prot scale, and every projection ~1 GB per isolate at 21M proteins
 * with six 2-D projections.
 *
 * A deferred slice keeps its source (column or coordinates) and `keptIndices` alive until it
 * is read, and drops them then; `keptIndices` must not change in the meantime. Everything
 * that reads the whole view (a spread, `structuredClone`, an export) slices what it touches.
 */
export function viewVisualizationDataByIndices(
  data: VisualizationData,
  keptIndices: readonly number[],
): VisualizationData {
  return sliceWith(data, keptIndices, true);
}

/**
 * Sets `target[key]` to `slice()`, or with `lazy` to an enumerable, assignable property that
 * calls `slice` on its first read and hands that same value back on every later one (so
 * readers can compare it by reference). An assignment replaces it. `slice` is dropped once
 * it has run, releasing the source it closes over.
 */
function setSliced<T>(target: object, key: string, slice: () => T, lazy: boolean): void {
  if (!lazy) {
    (target as Record<string, T>)[key] = slice();
    return;
  }
  let pending: (() => T) | null = slice;
  let value: T;
  Object.defineProperty(target, key, {
    enumerable: true,
    configurable: true,
    get: () => {
      if (pending) {
        value = pending();
        pending = null;
      }
      return value;
    },
    set: (next: T) => {
      pending = null;
      value = next;
    },
  });
}

function sliceColumns<S, T>(
  src: Record<string, S>,
  slice: (column: S) => T,
  lazy: boolean,
): Record<string, T> {
  const out: Record<string, T> = {};
  for (const [name, column] of Object.entries(src)) {
    setSliced(out, name, () => slice(column), lazy);
  }
  return out;
}

function sliceWith(
  data: VisualizationData,
  keptIndices: readonly number[],
  lazy: boolean,
): VisualizationData {
  const sliceRows = <T>(rows: readonly T[]): T[] => {
    const out = new Array<T>(keptIndices.length);
    for (let k = 0; k < keptIndices.length; k++) out[k] = rows[keptIndices[k]];
    return out;
  };
  const sliceRecord = <T>(
    src: Record<string, readonly T[]> | undefined,
  ): Record<string, T[]> | undefined => (src ? sliceColumns(src, sliceRows, lazy) : undefined);

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
      // The other fields stay eager; setSliced replaces `data` in its key position.
      const out = { ...projection };
      setSliced(out, 'data', () => sliceCoordinates(projection, keptIndices), lazy);
      return out;
    }),
    annotation_data: sliceColumns(
      data.annotation_data,
      (rows) => sliceAnnotationData(rows, keptIndices),
      lazy,
    ),
    numeric_annotation_data: data.numeric_annotation_data
      ? sliceColumns(
          data.numeric_annotation_data,
          (values) => sliceFloat64(values, keptIndices),
          lazy,
        )
      : undefined,
    annotation_predicted: sliceRecord(data.annotation_predicted),
    annotation_scores: sliceRecord(data.annotation_scores),
    annotation_evidence: sliceRecord(data.annotation_evidence),
  };
}

/** Gather each kept point's `dimension` coordinates into a fresh Float32Array. */
function sliceCoordinates(
  projection: VisualizationData['projections'][number],
  keptIndices: readonly number[],
): Float32Array {
  const { data: coords, dimension: dim } = projection;
  const out = new Float32Array(keptIndices.length * dim);
  for (let k = 0; k < keptIndices.length; k++) {
    const base = keptIndices[k] * dim;
    const o = k * dim;
    out[o] = coords[base];
    out[o + 1] = coords[base + 1];
    if (dim === 3) out[o + 2] = coords[base + 2];
  }
  return out;
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
