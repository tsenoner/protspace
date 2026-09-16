import type {
  AnnotationData,
  CsrAnnotationData,
  SparseMultiValueAnnotationData,
} from '../types.js';

export function isSparseMultiValueAnnotationData(
  data: AnnotationData,
): data is SparseMultiValueAnnotationData {
  return 'kind' in data && data.kind === 'sparse-multi';
}

/**
 * Tagged storage is checked before any `instanceof`: a CSR container is a plain
 * object holding typed arrays, not a typed array itself.
 */
export function isCsrAnnotationData(data: AnnotationData): data is CsrAnnotationData {
  return 'kind' in data && data.kind === 'csr';
}

/**
 * Half-open `[start, stop)` range of hits owned by a protein in CSR storage.
 * Out-of-range and negative protein indices yield an empty range.
 *
 * Also the hit numbering for the parallel `annotation_scores_csr` /
 * `annotation_evidence_csr` payloads, which is why this is exported.
 */
export function getCsrHitRange(
  data: CsrAnnotationData,
  proteinIdx: number,
): readonly [number, number] {
  if (proteinIdx < 0 || proteinIdx >= data.length) return [0, 0];
  return [proteinIdx === 0 ? 0 : data.end[proteinIdx - 1], data.end[proteinIdx]];
}

/**
 * Memo for {@link isMultilabelAnnotationDataCached}.
 *
 * Sound because no producer mutates an `AnnotationData` in place — every one
 * builds a fresh object (conversion, the EAT overlay, numeric binning, and the
 * isolation path all return new storage), so object identity implies unchanged
 * content. A WeakMap keeps a released dataset collectable.
 */
const multilabelMemo = new WeakMap<object, boolean>();

/**
 * {@link isMultilabelAnnotationData}, memoized per storage object.
 *
 * The uncached form is O(N) for dense array storage, and callers want it on
 * every style-getter rebuild — which happens on a legend hide, a selection, a
 * projection switch. At 573K proteins that is a full sweep for a question whose
 * answer cannot change without the storage object itself changing.
 *
 * `Int32Array` storage answers in O(1) and the sparse form scans only its
 * overrides, so those paths are cheap either way; the memo is for the dense one.
 */
export function isMultilabelAnnotationDataCached(data: AnnotationData): boolean {
  const cached = multilabelMemo.get(data as object);
  if (cached !== undefined) return cached;
  const result = isMultilabelAnnotationData(data);
  multilabelMemo.set(data as object, result);
  return result;
}

/** Return whether any protein has more than one categorical value. */
export function isMultilabelAnnotationData(data: AnnotationData): boolean {
  if (isSparseMultiValueAnnotationData(data)) {
    for (const values of data.overrides.values()) {
      if (values.length > 1) return true;
    }
    return false;
  }
  if (isCsrAnnotationData(data)) {
    for (let i = 0; i < data.length; i++) {
      if (data.end[i] - (i === 0 ? 0 : data.end[i - 1]) > 1) return true;
    }
    return false;
  }
  if (data instanceof Int32Array) return false;
  return data.some((values) => values.length > 1);
}

/**
 * Returns the list of category indices for a given protein.
 * - For Int32Array storage: a fresh single-element array (or `[]` if missing).
 * - For (readonly number[])[] storage: the inner array (do not mutate).
 *
 * Hot paths needing just the first index should use `getFirstAnnotationIndex`
 * to avoid the wrapper allocation.
 */
export function getProteinAnnotationIndices(
  data: AnnotationData,
  proteinIdx: number,
): readonly number[] {
  if (isSparseMultiValueAnnotationData(data)) {
    const override = data.overrides.get(proteinIdx);
    if (override) return override;
    if (proteinIdx < 0 || proteinIdx >= data.base.length) return [];
    const value = data.base[proteinIdx];
    return value < 0 ? [] : [value];
  }
  if (isCsrAnnotationData(data)) {
    // A subarray view would be cheaper, but callers run `.map`/`.flatMap`/`.some`
    // on the result, so the contract stays `readonly number[]`.
    const [start, stop] = getCsrHitRange(data, proteinIdx);
    return start === stop ? [] : Array.from(data.codes.subarray(start, stop));
  }
  if (data instanceof Int32Array) {
    if (proteinIdx < 0 || proteinIdx >= data.length) return [];
    const value = data[proteinIdx];
    return value < 0 ? [] : [value];
  }
  if (proteinIdx < 0 || proteinIdx >= data.length) return [];
  return data[proteinIdx];
}

export function getProteinAnnotationCount(data: AnnotationData, proteinIdx: number): number {
  if (isSparseMultiValueAnnotationData(data)) {
    const override = data.overrides.get(proteinIdx);
    if (override) return override.length;
    if (proteinIdx < 0 || proteinIdx >= data.base.length) return 0;
    return data.base[proteinIdx] < 0 ? 0 : 1;
  }
  if (isCsrAnnotationData(data)) {
    // Range inlined rather than via getCsrHitRange: this and getFirstAnnotationIndex
    // run per point per frame, and the tuple would be an allocation each.
    if (proteinIdx < 0 || proteinIdx >= data.length) return 0;
    return data.end[proteinIdx] - (proteinIdx === 0 ? 0 : data.end[proteinIdx - 1]);
  }
  if (data instanceof Int32Array) {
    if (proteinIdx < 0 || proteinIdx >= data.length) return 0;
    return data[proteinIdx] < 0 ? 0 : 1;
  }
  if (proteinIdx < 0 || proteinIdx >= data.length) return 0;
  return data[proteinIdx].length;
}

/**
 * Returns the first category index for a protein, or -1 if missing/none.
 * Allocation-free: prefer this on hot paths (per-point coloring, sorting).
 */
export function getFirstAnnotationIndex(data: AnnotationData, proteinIdx: number): number {
  if (isSparseMultiValueAnnotationData(data)) {
    const override = data.overrides.get(proteinIdx);
    if (override) return override[0] ?? -1;
    if (proteinIdx < 0 || proteinIdx >= data.base.length) return -1;
    return data.base[proteinIdx];
  }
  if (isCsrAnnotationData(data)) {
    if (proteinIdx < 0 || proteinIdx >= data.length) return -1;
    const start = proteinIdx === 0 ? 0 : data.end[proteinIdx - 1];
    return start === data.end[proteinIdx] ? -1 : data.codes[start];
  }
  if (data instanceof Int32Array) {
    if (proteinIdx < 0 || proteinIdx >= data.length) return -1;
    return data[proteinIdx];
  }
  if (proteinIdx < 0 || proteinIdx >= data.length) return -1;
  const list = data[proteinIdx];
  return list.length === 0 ? -1 : list[0];
}

/**
 * Slice an AnnotationData by the given array of original indices (e.g. keptIndices).
 * Returns the same storage shape as the input.
 */
export function sliceAnnotationData(data: AnnotationData, indices: number[]): AnnotationData {
  if (isSparseMultiValueAnnotationData(data)) {
    const base = sliceAnnotationData(data.base, indices) as Int32Array;
    const overrides = new Map<number, readonly number[]>();
    for (let outputIndex = 0; outputIndex < indices.length; outputIndex++) {
      const override = data.overrides.get(indices[outputIndex]);
      if (override) overrides.set(outputIndex, override);
    }
    return overrides.size > 0
      ? { kind: 'sparse-multi', base, overrides, length: base.length }
      : base;
  }
  if (isCsrAnnotationData(data)) {
    const end = new Int32Array(indices.length);
    let total = 0;
    for (let i = 0; i < indices.length; i++) {
      const [start, stop] = getCsrHitRange(data, indices[i]);
      total += stop - start;
      end[i] = total;
    }
    const codes = new Int32Array(total);
    let cursor = 0;
    for (let i = 0; i < indices.length; i++) {
      const [start, stop] = getCsrHitRange(data, indices[i]);
      if (start === stop) continue;
      codes.set(data.codes.subarray(start, stop), cursor);
      cursor += stop - start;
    }
    return { kind: 'csr', end, codes, length: indices.length };
  }
  if (data instanceof Int32Array) {
    const out = new Int32Array(indices.length);
    for (let i = 0; i < indices.length; i++) {
      const idx = indices[i];
      out[i] = idx >= 0 && idx < data.length ? data[idx] : -1;
    }
    return out;
  }
  return indices.map((idx) => (idx >= 0 && idx < data.length ? data[idx] : []));
}
