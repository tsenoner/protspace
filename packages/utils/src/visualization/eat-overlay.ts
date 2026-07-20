import type { AnnotationData, PredictedCell, VisualizationData } from '../types.js';
import {
  getFirstAnnotationIndex,
  getProteinAnnotationIndices,
  isSparseMultiValueAnnotationData,
} from './annotation-data-access.js';
import { isNAValue } from './missing-values.js';

export const EAT_COMPANION_SUFFIXES = {
  value: '__pred_value',
  confidence: '__pred_confidence',
  source: '__pred_source',
} as const;

export type EatCompanionKind = keyof typeof EAT_COMPANION_SUFFIXES;

export const EAT_CONFIDENCE_SUFFIX = '__eat_confidence';
export const DEFAULT_EAT_CONFIDENCE_THRESHOLD = 0.5;

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

function cloneWithPredictions(
  source: AnnotationData,
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
