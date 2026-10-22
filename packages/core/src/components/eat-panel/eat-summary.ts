import {
  getPredictedCellValues,
  getProteinAnnotationCount,
  getProteinAnnotationIndexAt,
  isNAValue,
  normalizeReliability,
} from '@protspace/utils';
import type { EatReliabilityState, VisualizationData } from '@protspace/utils';

/**
 * The numbers behind the EAT panel: an index built once per (dataset, annotation), then a
 * summary per reliability state that walks only the predicted cells.
 *
 * Reads the raw curated column and `annotation_predicted`, never the materialized overlay, so
 * the counts do not depend on whether Show predictions is on.
 */

export const EAT_BIN_COUNT = 20;

export interface EatIndex {
  annotation: string;
  /** `protein_ids.length`. */
  total: number;
  /** Protein indices with a prediction, ascending reliability, protein-id tie-break. */
  order: Int32Array;
  /** Reliability aligned with `order`. */
  confidence: Float64Array;
  /** The annotation's labels (non-null, non-N/A values, in `annotation.values` order). */
  labels: readonly string[];
  /** CSR: label indices of `order[k]` are `labelHits[labelOffsets[k] .. labelOffsets[k+1])`. */
  labelOffsets: Int32Array;
  labelHits: Int32Array;
  /** Proteins without a prediction holding at least one curated value; per protein index 0/1. */
  curated: Uint8Array;
  /** Curated label indices per protein (CSR over protein indices), for per-label curated counts. */
  curatedOffsets: Int32Array;
  curatedHits: Int32Array;
  /** Source protein id → number of predictions it lent (this annotation). */
  lentCount: ReadonlyMap<string, number>;
}

export interface EatLabelRow {
  label: string;
  curated: number;
  kept: number;
  /** Predictions outside the reliability range. */
  outside: number;
  total: number;
  predictedShare: number;
  medianReliability: number | null;
}

export interface EatSummary {
  /** Context size (`total` when the context is null). */
  inView: number;
  curated: number;
  predicted: number;
  kept: number;
  /** Predictions outside the reliability range. */
  outside: number;
  none: number;
  /** `EAT_BIN_COUNT` predicted counts per bin, in context. */
  bins: Uint32Array;
  /** One row per label present in context (`total > 0`); unsorted, the panel sorts. */
  rows: EatLabelRow[];
}

export type EatDrill = { bin: number } | { label: number };

const indexCache = new WeakMap<VisualizationData, Map<string, EatIndex | null>>();

/**
 * The index for `annotation`, cached per dataset object. Null when the annotation is not a
 * categorical column with at least one prediction.
 */
export function getEatIndex(data: VisualizationData, annotation: string): EatIndex | null {
  let perData = indexCache.get(data);
  if (!perData) {
    perData = new Map();
    indexCache.set(data, perData);
  }
  if (perData.has(annotation)) return perData.get(annotation) ?? null;
  const index = buildIndex(data, annotation);
  perData.set(annotation, index);
  return index;
}

function buildIndex(data: VisualizationData, annotation: string): EatIndex | null {
  const meta = data.annotations[annotation];
  const cells = data.annotation_predicted?.[annotation];
  if (!meta || meta.kind !== 'categorical' || !cells) return null;
  const total = data.protein_ids.length;

  const labels: string[] = [];
  const labelOfValue = new Int32Array(meta.values.length).fill(-1);
  const labelOfName = new Map<string, number>();
  meta.values.forEach((value, valueIndex) => {
    if (value == null || isNAValue(value)) return;
    let label = labelOfName.get(value);
    if (label === undefined) {
      label = labels.length;
      labelOfName.set(value, label);
      labels.push(value);
    }
    labelOfValue[valueIndex] = label;
  });

  const predicted: number[] = [];
  const lentCount = new Map<string, number>();
  const limit = Math.min(cells.length, total);
  for (let i = 0; i < limit; i++) {
    const cell = cells[i];
    if (!cell) continue;
    predicted.push(i);
    lentCount.set(cell.source, (lentCount.get(cell.source) ?? 0) + 1);
  }
  if (predicted.length === 0) return null;

  const ids = data.protein_ids;
  predicted.sort((a, b) => {
    const diff = cells[a]!.confidence - cells[b]!.confidence;
    if (diff !== 0) return diff;
    return ids[a] < ids[b] ? -1 : ids[a] > ids[b] ? 1 : a - b;
  });

  const order = Int32Array.from(predicted);
  const confidence = new Float64Array(order.length);
  const labelOffsets = new Int32Array(order.length + 1);
  const hits: number[] = [];
  for (let k = 0; k < order.length; k++) {
    const cell = cells[order[k]]!;
    confidence[k] = cell.confidence;
    for (const value of getPredictedCellValues(cell)) {
      const label = labelOfName.get(value);
      if (label === undefined || hitsInclude(hits, labelOffsets[k], label)) continue;
      hits.push(label);
    }
    labelOffsets[k + 1] = hits.length;
  }

  const curated = new Uint8Array(total);
  const curatedOffsets = new Int32Array(total + 1);
  const curatedList: number[] = [];
  const rows = data.annotation_data[annotation];
  for (let p = 0; p < total; p++) {
    if (rows && !cells[p]) {
      const start = curatedList.length;
      const count = getProteinAnnotationCount(rows, p);
      for (let h = 0; h < count; h++) {
        const valueIndex = getProteinAnnotationIndexAt(rows, p, h);
        const label = valueIndex >= 0 ? (labelOfValue[valueIndex] ?? -1) : -1;
        if (label >= 0 && !hitsInclude(curatedList, start, label)) curatedList.push(label);
      }
      if (curatedList.length > start) curated[p] = 1;
    }
    curatedOffsets[p + 1] = curatedList.length;
  }

  return {
    annotation,
    total,
    order,
    confidence,
    labels,
    labelOffsets,
    labelHits: Int32Array.from(hits),
    curated,
    curatedOffsets,
    curatedHits: Int32Array.from(curatedList),
    lentCount,
  };
}

function hitsInclude(list: readonly number[], start: number, value: number): boolean {
  for (let i = start; i < list.length; i++) if (list[i] === value) return true;
  return false;
}

function keeps(range: EatReliabilityState, confidence: number): boolean {
  return confidence >= range.min && confidence <= range.max;
}

/** Whether a prediction passes `state`: inclusive at both bounds, as the query's matcher is. */
export function isKept(state: EatReliabilityState, confidence: number): boolean {
  return keeps(normalizeReliability(state), confidence);
}

/** `isKept` for one `state`, normalized once, for a pass over many cells. */
export function keptBy(state: EatReliabilityState): (confidence: number) => boolean {
  const range = normalizeReliability(state);
  return (confidence) => keeps(range, confidence);
}

/**
 * The 5 % histogram bin of a reliability, 0..19. A reliability of exactly 1 falls in the last
 * bin; the epsilon keeps a decimal boundary such as 0.6 in the bin a reader expects.
 */
export function binOf(confidence: number): number {
  if (!(confidence > 0)) return 0;
  return Math.min(EAT_BIN_COUNT - 1, Math.floor(confidence * EAT_BIN_COUNT + 1e-9));
}

interface ContextTotals {
  inView: number;
  curated: number;
  /** Curated proteins per label, in context. */
  labelCurated: Uint32Array;
}

const contextCache = new WeakMap<
  EatIndex,
  { all?: ContextTotals; masks: WeakMap<Uint8Array, ContextTotals> }
>();

/**
 * The O(n) part of a summary, cached per (index, context mask). A caller hands a new mask
 * whenever the context changes; a mask edited in place reads stale totals.
 */
function contextTotals(index: EatIndex, context: Uint8Array | null): ContextTotals {
  let entry = contextCache.get(index);
  if (!entry) {
    entry = { masks: new WeakMap() };
    contextCache.set(index, entry);
  }
  const cached = context ? entry.masks.get(context) : entry.all;
  if (cached) return cached;

  const labelCurated = new Uint32Array(index.labels.length);
  let inView = 0;
  let curated = 0;
  for (let p = 0; p < index.total; p++) {
    if (context && !context[p]) continue;
    inView++;
    if (!index.curated[p]) continue;
    curated++;
    for (let h = index.curatedOffsets[p]; h < index.curatedOffsets[p + 1]; h++) {
      labelCurated[index.curatedHits[h]]++;
    }
  }
  const totals = { inView, curated, labelCurated };
  if (context) entry.masks.set(context, totals);
  else entry.all = totals;
  return totals;
}

/** Counts, histogram and per-label rows for `state`, restricted to `context` (null = all). */
export function summarizeEat(
  index: EatIndex,
  state: EatReliabilityState,
  context: Uint8Array | null,
): EatSummary {
  const keeper = normalizeReliability(state);
  const totals = contextTotals(index, context);
  const labelCount = index.labels.length;
  const labelKept = new Uint32Array(labelCount);
  const labelOutside = new Uint32Array(labelCount);
  const bins = new Uint32Array(EAT_BIN_COUNT);
  let kept = 0;
  let outside = 0;

  for (let k = 0; k < index.order.length; k++) {
    if (context && !context[index.order[k]]) continue;
    const confidence = index.confidence[k];
    const isIn = keeps(keeper, confidence);
    if (isIn) kept++;
    else outside++;
    bins[binOf(confidence)]++;
    const counts = isIn ? labelKept : labelOutside;
    for (let h = index.labelOffsets[k]; h < index.labelOffsets[k + 1]; h++) {
      counts[index.labelHits[h]]++;
    }
  }

  const medians = labelMedians(index, context, labelKept, labelOutside);
  const rows: EatLabelRow[] = [];
  for (let label = 0; label < labelCount; label++) {
    const curated = totals.labelCurated[label];
    const predictedHere = labelKept[label] + labelOutside[label];
    const total = curated + predictedHere;
    if (total === 0) continue;
    rows.push({
      label: index.labels[label],
      curated,
      kept: labelKept[label],
      outside: labelOutside[label],
      total,
      predictedShare: predictedHere / total,
      medianReliability: medians[label],
    });
  }

  const predicted = kept + outside;
  return {
    inView: totals.inView,
    curated: totals.curated,
    predicted,
    kept,
    outside,
    none: totals.inView - totals.curated - predicted,
    bins,
    rows,
  };
}

/**
 * Each label's median reliability in context. `order` is ascending, so a second walk meets
 * each label's predictions already sorted and stops counting at its middle.
 */
function labelMedians(
  index: EatIndex,
  context: Uint8Array | null,
  labelKept: Uint32Array,
  labelOutside: Uint32Array,
): (number | null)[] {
  const n = index.labels.length;
  const counts = new Uint32Array(n);
  for (let label = 0; label < n; label++) counts[label] = labelKept[label] + labelOutside[label];
  const seen = new Uint32Array(n);
  const lower = new Float64Array(n);
  const medians: (number | null)[] = new Array<number | null>(n).fill(null);
  for (let k = 0; k < index.order.length; k++) {
    if (context && !context[index.order[k]]) continue;
    for (let h = index.labelOffsets[k]; h < index.labelOffsets[k + 1]; h++) {
      const label = index.labelHits[h];
      const position = seen[label]++;
      const count = counts[label];
      if (position === (count - 1) >> 1) lower[label] = index.confidence[k];
      if (position === count >> 1) medians[label] = (lower[label] + index.confidence[k]) / 2;
    }
  }
  return medians;
}

/**
 * A prediction's place among this annotation's predictions in the whole dataset: how many have
 * a strictly lower reliability, and how many a strictly higher one. Null when the protein has no
 * prediction.
 */
export function rankOf(
  index: EatIndex,
  proteinIndex: number,
): { below: number; above: number; total: number } | null {
  const k = index.order.indexOf(proteinIndex);
  if (k < 0) return null;
  const value = index.confidence[k];
  const total = index.order.length;
  let lo = 0;
  let hi = k;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (index.confidence[mid] < value) lo = mid + 1;
    else hi = mid;
  }
  const below = lo;
  lo = k + 1;
  hi = total;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (index.confidence[mid] <= value) lo = mid + 1;
    else hi = mid;
  }
  return { below, above: total - lo, total };
}

function inDrill(index: EatIndex, drill: EatDrill | undefined, k: number): boolean {
  if (!drill) return true;
  if ('bin' in drill) return binOf(index.confidence[k]) === drill.bin;
  for (let h = index.labelOffsets[k]; h < index.labelOffsets[k + 1]; h++) {
    if (index.labelHits[h] === drill.label) return true;
  }
  return false;
}

/** The label names of the prediction at `order[k]`. */
export function labelsAt(index: EatIndex, k: number): string[] {
  const labels: string[] = [];
  for (let h = index.labelOffsets[k]; h < index.labelOffsets[k + 1]; h++) {
    labels.push(index.labels[index.labelHits[h]]);
  }
  return labels;
}

/**
 * The weakest predictions behind a histogram bar or a label, weakest first, as positions `k` in
 * `order` (the protein is `order[k]`, its reliability `confidence[k]`).
 */
export function weakestIn(
  index: EatIndex,
  drill: EatDrill,
  context: Uint8Array | null,
  limit = 5,
): Int32Array {
  const found: number[] = [];
  for (let k = 0; k < index.order.length && found.length < limit; k++) {
    if (context && !context[index.order[k]]) continue;
    if (inDrill(index, drill, k)) found.push(k);
  }
  return Int32Array.from(found);
}

/** Predictions behind a bar or a label in context, and how many of them `state` keeps. */
export function countIn(
  index: EatIndex,
  drill: EatDrill,
  context: Uint8Array | null,
  state: EatReliabilityState,
): { total: number; kept: number } {
  const keeper = normalizeReliability(state);
  let total = 0;
  let kept = 0;
  for (let k = 0; k < index.order.length; k++) {
    if (context && !context[index.order[k]]) continue;
    if (!inDrill(index, drill, k)) continue;
    total++;
    if (keeps(keeper, index.confidence[k])) kept++;
  }
  return { total, kept };
}

/** Protein ids of the kept predictions or those outside the range, in reliability order. */
export function predictionIds(
  index: EatIndex,
  data: VisualizationData,
  state: EatReliabilityState,
  which: 'kept' | 'outside',
  context: Uint8Array | null,
  drill?: EatDrill,
): string[] {
  const keeper = normalizeReliability(state);
  const wantKept = which === 'kept';
  const ids: string[] = [];
  for (let k = 0; k < index.order.length; k++) {
    const protein = index.order[k];
    if (context && !context[protein]) continue;
    if (keeps(keeper, index.confidence[k]) !== wantKept) continue;
    if (inDrill(index, drill, k)) ids.push(data.protein_ids[protein]);
  }
  return ids;
}
