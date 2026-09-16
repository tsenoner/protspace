import type {
  AnnotationData,
  CsrAnnotationData,
  CsrEvidence,
  CsrScores,
  PredictedCell,
  VisualizationData,
} from '../types.js';
import {
  getFirstAnnotationIndex,
  getProteinAnnotationIndices,
  isCsrAnnotationData,
  isSparseMultiValueAnnotationData,
} from './annotation-data-access.js';
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
 * Which side(s) of the reliability scale the EAT filter constrains (#380).
 *
 * Lives here rather than beside the query-condition translation in `core` because
 * both the legend control and the control bar need the vocabulary, and neither
 * should have to import from the other.
 */
export type EatReliabilityMode = 'atLeast' | 'atMost' | 'between';

export interface EatReliabilityState {
  mode: EatReliabilityMode;
  /** Lower bound, used by `atLeast` and `between`. 0 means "no lower bound". */
  min: number;
  /** Upper bound, used by `atMost` and `between`. 1 means "no upper bound". */
  max: number;
}

/**
 * Each bound's "constrains nothing" position. Named once because it is the answer to
 * three separate questions — what an unused bound is blanked to, what an emptied
 * input box falls back to, and below which value a bound is worth stating as a query
 * condition at all — and every place that spelled it out by hand was a place the two
 * ends of the mirror could drift apart on what "no constraint" means.
 */
export const NEUTRAL_BOUND = { min: 0, max: 1 } as const;

/**
 * Which bounds each mode actually filters on. Stated once: `normalizeReliability`
 * blanks the bound a mode does not use, the legend renders one thumb and one percent
 * box per bound it does, and the query translation picks its operator from the pair.
 * A fourth mode is then one entry here rather than four coordinated edits.
 */
export const RELIABILITY_BOUNDS: Record<EatReliabilityMode, { min: boolean; max: boolean }> = {
  atLeast: { min: true, max: false },
  atMost: { min: false, max: true },
  between: { min: true, max: true },
};

/**
 * Default reliability-slider position. `0` means "show everything": the slider
 * derives an `EAT_confidence >= x or N/A` filter only when dragged above 0, so a
 * fresh dataset (or a bundle without a saved position) shows all points and
 * leaves the filter box clean (#6b).
 */
export const DEFAULT_EAT_CONFIDENCE_THRESHOLD = NEUTRAL_BOUND.min;

/**
 * "Show everything." Constrains nothing, so it emits no query condition at all and a
 * fresh dataset — or a bundle with no saved position — leaves the filter box clean.
 */
export const DEFAULT_EAT_RELIABILITY: EatReliabilityState = {
  mode: 'atLeast',
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
 * Canonical form: clamp each bound the mode uses and blank the one it does not.
 *
 * A mode carries a bound it ignores (`atLeast` has no upper bound, `atMost` no
 * lower), and the query round-trip always returns the canonical spelling. Without
 * this, a caller that leaves the unused bound at its previous value hands over a
 * state that is equal in meaning but unequal by `isSameReliability`, so the mirror's
 * de-dupe guard never fires and every repeat call rewrites the query.
 *
 * Lives beside the type rather than beside the query translation because both ends
 * of the mirror — the legend control and the control bar — have to agree on what a
 * state means, and a second hand-rolled copy is exactly how they drifted apart.
 */
export function normalizeReliability(state: EatReliabilityState): EatReliabilityState {
  const uses = RELIABILITY_BOUNDS[state.mode];
  // Each bound falls back to its OWN neutral position. Defaulting both to 0 blanked an
  // emptied upper box into `<= 0`, which hides every prediction — the opposite of the
  // "no constraint on this side" the fallback exists to express.
  const min = uses.min ? clampReliabilityBound(state.min, NEUTRAL_BOUND.min) : NEUTRAL_BOUND.min;
  const max = uses.max ? clampReliabilityBound(state.max, NEUTRAL_BOUND.max) : NEUTRAL_BOUND.max;
  // Order the bounds whenever the mode holds both. The two thumbs move independently,
  // so dragging the lower one past the upper produced `between 0.8 .. 0.5`, which the
  // numeric matcher reads as `v >= 0.8 && v <= 0.5` — unsatisfiable, collapsing the
  // plot to the curated points (or, with none, tripping the empty-result guard and
  // showing everything). Neither is the band on screen.
  return uses.min && uses.max
    ? { mode: state.mode, min: Math.min(min, max), max: Math.max(min, max) }
    : { mode: state.mode, min, max };
}

/** Structural equality over the reliability model. */
export function isSameReliability(a: EatReliabilityState, b: EatReliabilityState): boolean {
  return a.mode === b.mode && a.min === b.min && a.max === b.max;
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
 * CSR rebuild for the overlay — codes AND the flat per-hit payloads, in one lockstep pass.
 *
 * Rebuilt as CSR, never densified to `number[][]`: a 573K column would otherwise become one
 * array per protein. Predicted rows replace the source row's hits wholesale; a prediction
 * that resolves to nothing leaves the row alone, as the Int32Array and sparse-multi branches
 * do (CSR has no way to store the `-1` the dense branch falls back to).
 *
 * `annotation_scores_csr` / `annotation_evidence_csr` are numbered by GLOBAL hit, so a
 * predicted row whose hit count differs from the curated one renumbers every LATER hit.
 * Rebuilding the codes alone left those payloads addressing other proteins' hits, and
 * silently: the accessors read past the end of `hitEnd` / `codes` and return null instead of
 * throwing. So they are rebuilt here alongside the codes — a preserved row copies its hit
 * spans verbatim, a replaced row emits one empty score range and one `-1` evidence code per
 * predicted value (an EAT transfer carries no curated score or evidence of its own).
 */
function cloneCsrWithPredictions(
  source: CsrAnnotationData,
  predictedCells: readonly (PredictedCell | null)[],
  valueToIndex: ReadonlyMap<string, number>,
  sourceScores: CsrScores | undefined,
  sourceEvidence: CsrEvidence | undefined,
): { rows: CsrAnnotationData; scores?: CsrScores; evidence?: CsrEvidence } {
  const replacements = predictedReplacements(predictedCells, valueToIndex, source.length);

  const end = new Int32Array(source.length);
  let total = 0;
  for (let i = 0; i < source.length; i++) {
    const replacement = replacements.get(i);
    total += replacement ? replacement.length : source.end[i] - (i === 0 ? 0 : source.end[i - 1]);
    end[i] = total;
  }

  const codes = new Int32Array(total);
  // The payloads can only shrink (a replaced row drops its own values), so the source
  // length is a safe upper bound and the trailing slack is sliced off at the end.
  const values = new Float64Array(sourceScores ? sourceScores.values.length : 0);
  const hitEnd = new Int32Array(sourceScores ? total : 0);
  const evidenceCodes = new Int32Array(sourceEvidence ? total : 0);

  let dst = 0;
  let written = 0;
  for (let i = 0; i < source.length; i++) {
    const start = i === 0 ? 0 : source.end[i - 1];
    const stop = source.end[i];
    const replacement = replacements.get(i);
    if (replacement) {
      for (const index of replacement) {
        codes[dst] = index;
        // Repeating the running cursor is the empty range that says "no score".
        if (sourceScores) hitEnd[dst] = written;
        if (sourceEvidence) evidenceCodes[dst] = -1;
        dst++;
      }
      continue;
    }
    if (!sourceScores && !sourceEvidence) {
      // No payload to walk, so a preserved row is one bulk copy.
      if (stop > start) codes.set(source.codes.subarray(start, stop), dst);
      dst += stop - start;
      continue;
    }
    for (let hit = start; hit < stop; hit++) {
      codes[dst] = source.codes[hit];
      if (sourceScores) {
        const from = hit === 0 ? 0 : sourceScores.hitEnd[hit - 1];
        const to = sourceScores.hitEnd[hit];
        for (let v = from; v < to; v++) values[written++] = sourceScores.values[v];
        hitEnd[dst] = written;
      }
      if (sourceEvidence) evidenceCodes[dst] = sourceEvidence.codes[hit];
      dst++;
    }
  }

  return {
    rows: { kind: 'csr', end, codes, length: source.length },
    ...(sourceScores ? { scores: { hitEnd, values: values.slice(0, written) } } : {}),
    ...(sourceEvidence ? { evidence: { codes: evidenceCodes, dict: sourceEvidence.dict } } : {}),
  };
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

  if (isCsrAnnotationData(source)) {
    // The payloads come back from the same pass as the codes and are returned here rather
    // than left to the `...data` spread: a stale `annotation_scores_csr` carried through by
    // reference is numbered against the OLD hit layout, which shows one protein's score and
    // evidence on the next protein's tooltip without any visible failure.
    const rebuilt = cloneCsrWithPredictions(
      source,
      predictedCells,
      valueToIndex,
      data.annotation_scores_csr?.[annotationKey],
      data.annotation_evidence_csr?.[annotationKey],
    );
    return {
      ...data,
      annotation_data: { ...data.annotation_data, [annotationKey]: rebuilt.rows },
      ...(rebuilt.scores
        ? {
            annotation_scores_csr: {
              ...data.annotation_scores_csr,
              [annotationKey]: rebuilt.scores,
            },
          }
        : {}),
      ...(rebuilt.evidence
        ? {
            annotation_evidence_csr: {
              ...data.annotation_evidence_csr,
              [annotationKey]: rebuilt.evidence,
            },
          }
        : {}),
    };
  }

  return {
    ...data,
    annotation_data: {
      ...data.annotation_data,
      [annotationKey]: cloneWithPredictions(source, predictedCells, valueToIndex),
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
  const indices = getProteinAnnotationIndices(rows, proteinIdx);
  return (
    indices.length === 0 ||
    indices.every((index) => {
      const value = annotation.values[index];
      return value == null || isNAValue(value);
    })
  );
}
