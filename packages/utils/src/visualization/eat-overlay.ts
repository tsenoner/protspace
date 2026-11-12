import type {
  AnnotationData,
  CsrAnnotationData,
  PredictedCell,
  VisualizationData,
} from '../types.js';
import {
  getFirstAnnotationIndex,
  getProteinAnnotationCount,
  getProteinAnnotationIndexAt,
  isCsrAnnotationData,
  isSparseMultiValueAnnotationData,
} from './annotation-data-access.js';
import { EAT_NEIGHBOR_SUFFIX } from '../generated/shared-constants';
import { gatherCsr, syntheticHit } from './csr.js';
import { isNAValue } from './missing-values.js';
import { clamp01 } from './numeric-binning.js';

export const EAT_COMPANION_SUFFIXES = {
  value: '__pred_value',
  confidence: '__pred_confidence',
  source: '__pred_source',
} as const;

export type EatCompanionKind = keyof typeof EAT_COMPANION_SUFFIXES;

export const EAT_CONFIDENCE_SUFFIX = '__eat_confidence';

/**
 * The annotation a `<col>__neighbor` column (`protspace transfer --max-distance`: `near` or
 * `distant` per query) describes, or null for any other column.
 */
export function getEatNeighborBaseKey(key: string): string | null {
  return key.length > EAT_NEIGHBOR_SUFFIX.length && key.endsWith(EAT_NEIGHBOR_SUFFIX)
    ? key.slice(0, -EAT_NEIGHBOR_SUFFIX.length)
    : null;
}

/**
 * The EAT reliability filter: the range of reliabilities it keeps, both ends included (#380).
 * `0..1` keeps every prediction and is the default.
 *
 * Lives here rather than beside the query-condition translation in `core` because
 * the EAT panel, the legend and the app's EAT panel controller all need the
 * vocabulary, and none should have to import from another.
 */
export interface EatReliabilityState {
  /** Lower bound. 0 means "no lower bound". */
  min: number;
  /** Upper bound. 1 means "no upper bound". */
  max: number;
}

/**
 * The control once had three modes, `atLeast`, `atMost` and `between`, and a state could carry
 * the one it was in along with a bound that mode ignored. A state written then (by a test, a
 * caller or a saved view) still loads: `normalizeReliability` reads the mode's bounds and drops
 * the mode.
 */
type LegacyReliabilityMode = 'atLeast' | 'atMost' | 'between';
export type EatReliabilityInput = EatReliabilityState & { mode?: LegacyReliabilityMode };

/**
 * Each bound's "constrains nothing" position. Named once because it is the answer to
 * three separate questions — what an emptied input box falls back to, what the default
 * range is, and past which value a bound is worth stating as a query condition at all.
 */
export const NEUTRAL_BOUND = { min: 0, max: 1 } as const;

/**
 * Default reliability-slider position. `0` means "show everything": the slider
 * derives an `EAT_confidence >= x or N/A` filter only when dragged above 0, so a
 * fresh dataset (or a bundle without a saved position) shows all points and
 * leaves the filter box clean (#6b).
 */
export const DEFAULT_EAT_CONFIDENCE_THRESHOLD = NEUTRAL_BOUND.min;

/**
 * "Show everything": the full range. Constrains nothing, so it emits no query condition at
 * all and a fresh dataset — or a bundle with no saved position — leaves the filter box clean.
 */
export const DEFAULT_EAT_RELIABILITY: EatReliabilityState = {
  min: NEUTRAL_BOUND.min,
  max: NEUTRAL_BOUND.max,
};

/**
 * `clamp01` with a defined result for non-finite input. The shared `clamp01` passes
 * `NaN` through, and a bound can arrive as `NaN` from an emptied number input.
 *
 * `fallback` is the bound's own `NEUTRAL_BOUND` position, so an emptied box reads as
 * "no constraint on this side" rather than as a bound that hides everything.
 */
export function clampReliabilityBound(value: number, fallback: number = NEUTRAL_BOUND.min): number {
  return Number.isFinite(value) ? clamp01(value) : fallback;
}

/**
 * Canonical form: both bounds clamped to 0..1 and in order, and no legacy mode.
 *
 * The query round-trip always returns the canonical spelling; without this a caller handing
 * over an equal-in-meaning state unequal by `isSameReliability` defeats the mirror's de-dupe
 * guard, and every repeat call rewrites the query.
 *
 * Lives beside the type rather than beside the query translation because both ends
 * of the mirror — the EAT panel and the filter controller's reliability condition —
 * have to agree on what a state means, and a second hand-rolled copy is exactly how they drifted apart.
 */
export function normalizeReliability(state: EatReliabilityInput): EatReliabilityState {
  // An old one-sided mode ignored its other bound, whatever value it carried.
  // Each bound falls back to its OWN neutral position. Defaulting both to 0 blanked an
  // emptied upper box into `<= 0`, which hides every prediction — the opposite of the
  // "no constraint on this side" the fallback exists to express.
  const min =
    state.mode === 'atMost'
      ? NEUTRAL_BOUND.min
      : clampReliabilityBound(state.min, NEUTRAL_BOUND.min);
  const max =
    state.mode === 'atLeast'
      ? NEUTRAL_BOUND.max
      : clampReliabilityBound(state.max, NEUTRAL_BOUND.max);
  // The two handles move independently, so a crossed pair (`0.8 .. 0.5`) would be read by
  // the numeric matcher as `v >= 0.8 && v <= 0.5` — unsatisfiable. Order them.
  return { min: Math.min(min, max), max: Math.max(min, max) };
}

/** Structural equality over the reliability model. */
export function isSameReliability(a: EatReliabilityState, b: EatReliabilityState): boolean {
  return a.min === b.min && a.max === b.max;
}

const EAT_COMPANION_RE = /^(.*)__pred_(value|confidence|source)$/;

export function parseEatCompanionColumn(
  column: string,
): { base: string; kind: EatCompanionKind } | null {
  const match = EAT_COMPANION_RE.exec(column);
  if (!match?.[1]) return null;
  return { base: match[1], kind: match[2] as EatCompanionKind };
}

export function getEatCompanionColumn(base: string, kind: EatCompanionKind): string {
  return `${base}${EAT_COMPANION_SUFFIXES[kind]}`;
}

export function getEatConfidenceAnnotationKey(base: string): string {
  return `${base}${EAT_CONFIDENCE_SUFFIX}`;
}

export function isEatConfidenceAnnotationKey(key: string): boolean {
  return key.length > EAT_CONFIDENCE_SUFFIX.length && key.endsWith(EAT_CONFIDENCE_SUFFIX);
}

/**
 * True when an annotation is a synthesized EAT-confidence column (filter-only, never color-by).
 * Uses the authoritative `runtime.role` capability, which — unlike the `__eat_confidence` suffix —
 * also matches the collision-renamed `__eat_confidence__runtime_N` variant.
 */
export function isEatConfidenceAnnotation(
  annotation: { runtime?: { role?: string } } | null | undefined,
): boolean {
  return annotation?.runtime?.role === 'eat-confidence';
}

export function getEatBaseAnnotationKey(key: string): string | null {
  return isEatConfidenceAnnotationKey(key) ? key.slice(0, -EAT_CONFIDENCE_SUFFIX.length) : null;
}

export function getPredictedCell(
  data: VisualizationData,
  proteinIdx: number,
  annotationKey: string,
): PredictedCell | null {
  return data.annotation_predicted?.[annotationKey]?.[proteinIdx] ?? null;
}

/** Decoded display labels, retaining backwards compatibility with single-value runtime cells. */
export function getPredictedCellValues(cell: PredictedCell): readonly string[] {
  return cell.values && cell.values.length > 0 ? cell.values : [cell.value];
}

export function hasEatPredictionsForAnnotation(
  data: Pick<VisualizationData, 'annotation_predicted'> | null | undefined,
  annotationKey: string | null | undefined,
): boolean {
  return Boolean(
    annotationKey && data?.annotation_predicted?.[annotationKey]?.some((cell) => cell !== null),
  );
}

export function hasEatPredictions(
  data: Pick<VisualizationData, 'annotation_predicted'> | null | undefined,
): boolean {
  if (!data?.annotation_predicted) return false;
  return Object.values(data.annotation_predicted).some((cells) => cells.some(Boolean));
}

/** Resolve a predicted cell's display labels to their (valid) annotation value indices. */
function predictedIndices(
  cell: PredictedCell,
  valueToIndex: ReadonlyMap<string, number>,
): number[] {
  return getPredictedCellValues(cell)
    .map((value) => valueToIndex.get(value) ?? -1)
    .filter((index) => index >= 0);
}

/** Which rows a prediction actually replaces, and with which value indices. */
function predictedReplacements(
  predictedCells: readonly (PredictedCell | null)[],
  valueToIndex: ReadonlyMap<string, number>,
  rowCount: number,
): Map<number, readonly number[]> {
  const replacements = new Map<number, readonly number[]>();
  for (let i = 0; i < predictedCells.length && i < rowCount; i++) {
    const cell = predictedCells[i];
    if (!cell) continue;
    const indices = predictedIndices(cell, valueToIndex);
    if (indices.length > 0) replacements.set(i, indices);
  }
  return replacements;
}

/**
 * CSR rebuild for the overlay.
 *
 * Rebuilt as CSR, never densified to `number[][]`: a 573K column would otherwise become one
 * array per protein. Predicted rows replace the source row's hits wholesale; a prediction
 * that resolves to nothing leaves the row alone, as the Int32Array and sparse-multi branches
 * do (CSR has no way to store the `-1` the dense branch falls back to).
 *
 * Through {@link gatherCsr}, so a preserved row keeps its hits' scores and evidence and a
 * predicted value gets none: an EAT transfer carries no curated score or evidence of its own.
 */
function cloneCsrWithPredictions(
  source: CsrAnnotationData,
  predictedCells: readonly (PredictedCell | null)[],
  valueToIndex: ReadonlyMap<string, number>,
): CsrAnnotationData {
  const replacements = predictedReplacements(predictedCells, valueToIndex, source.length);

  const offsets = new Int32Array(source.length + 1);
  for (let i = 0; i < source.length; i++) {
    const replacement = replacements.get(i);
    offsets[i + 1] =
      offsets[i] + (replacement ? replacement.length : getProteinAnnotationCount(source, i));
  }

  const hits = new Int32Array(offsets[source.length]);
  let dst = 0;
  for (let i = 0; i < source.length; i++) {
    const replacement = replacements.get(i);
    if (replacement) {
      for (const index of replacement) hits[dst++] = syntheticHit(index);
    } else {
      for (let hit = source.offsets[i]; hit < source.offsets[i + 1]; hit++) hits[dst++] = hit;
    }
  }

  return gatherCsr(source, { offsets, hits });
}

function cloneWithPredictions(
  source: Exclude<AnnotationData, CsrAnnotationData>,
  predictedCells: readonly (PredictedCell | null)[],
  valueToIndex: ReadonlyMap<string, number>,
): AnnotationData {
  if (source instanceof Int32Array) {
    const hasMultiValuePrediction = predictedCells.some(
      (cell) => cell !== null && getPredictedCellValues(cell).length > 1,
    );
    if (hasMultiValuePrediction) {
      const base = source.slice();
      const overrides = new Map<number, readonly number[]>();
      for (let i = 0; i < predictedCells.length; i++) {
        const cell = predictedCells[i];
        if (!cell) continue;
        const indices = predictedIndices(cell, valueToIndex);
        if (indices.length > 1) {
          base[i] = indices[0];
          overrides.set(i, indices);
        } else if (indices.length === 1) {
          base[i] = indices[0];
        }
      }
      return { kind: 'sparse-multi', base, overrides, length: base.length };
    }
    const clone = source.slice();
    for (let i = 0; i < predictedCells.length; i++) {
      const cell = predictedCells[i];
      if (cell) clone[i] = valueToIndex.get(getPredictedCellValues(cell)[0]) ?? clone[i];
    }
    return clone;
  }

  if (isSparseMultiValueAnnotationData(source)) {
    const base = source.base.slice();
    const overrides = new Map(source.overrides);
    for (let i = 0; i < predictedCells.length; i++) {
      const cell = predictedCells[i];
      if (!cell) continue;
      const indices = predictedIndices(cell, valueToIndex);
      if (indices.length > 1) {
        base[i] = indices[0];
        overrides.set(i, indices);
      } else if (indices.length === 1) {
        base[i] = indices[0];
        overrides.delete(i);
      }
    }
    return { kind: 'sparse-multi', base, overrides, length: base.length };
  }

  const clone = source.slice();
  for (let i = 0; i < predictedCells.length; i++) {
    const cell = predictedCells[i];
    if (cell) {
      const indices = predictedIndices(cell, valueToIndex);
      clone[i] = indices.length > 0 ? indices : [getFirstAnnotationIndex(source, i)];
    }
  }
  return clone;
}

/**
 * Materialize one selected EAT base annotation for display. The curated source data and all
 * unrelated annotation arrays remain shared, so turning the overlay off is lossless and cheap.
 */
export function materializeEatOverlay(
  data: VisualizationData,
  annotationKey: string | null | undefined,
  overlayEnabled: boolean,
): VisualizationData {
  if (!overlayEnabled || !annotationKey) return data;
  const predictedCells = data.annotation_predicted?.[annotationKey];
  const annotation = data.annotations[annotationKey];
  const source = data.annotation_data[annotationKey];
  if (!predictedCells || !annotation || annotation.kind !== 'categorical' || !source) return data;

  const valueToIndex = new Map<string, number>();
  annotation.values.forEach((value, index) => {
    if (value != null) valueToIndex.set(value, index);
  });

  return {
    ...data,
    annotation_data: {
      ...data.annotation_data,
      [annotationKey]: isCsrAnnotationData(source)
        ? cloneCsrWithPredictions(source, predictedCells, valueToIndex)
        : cloneWithPredictions(source, predictedCells, valueToIndex),
    },
  };
}

/** Internal conversion helper: whether a curated base cell is available. */
export function isCuratedAnnotationMissing(
  data: VisualizationData,
  annotationKey: string,
  proteinIdx: number,
): boolean {
  const annotation = data.annotations[annotationKey];
  const rows = data.annotation_data[annotationKey];
  if (!annotation || !rows) return true;
  const count = getProteinAnnotationCount(rows, proteinIdx);
  for (let k = 0; k < count; k++) {
    const value = annotation.values[getProteinAnnotationIndexAt(rows, proteinIdx, k)];
    if (value != null && !isNAValue(value)) return false;
  }
  return true;
}
