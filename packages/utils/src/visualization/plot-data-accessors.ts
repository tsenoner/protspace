import type { VisualizationData, NumericAnnotationType, PredictedCell } from '../types.js';
import {
  getCsrHitRange,
  getProteinAnnotationIndices,
  isCsrAnnotationData,
} from './annotation-data-access.js';
import { isAutoClusterColumnName } from './annotation-statistics.js';
import { getPredictedCell, getPredictedCellValues } from './eat-overlay.js';
import { getNumericBinLabelMap } from './numeric-binning.js';
import { toInternalValue } from './missing-values.js';

/**
 * Hot path — used per-protein per render frame.
 * Returns the raw annotation value strings for a protein on a given key.
 * Empty array when the protein has no value for this key.
 */
export function getProteinAnnotationValues(
  data: VisualizationData,
  proteinIdx: number,
  annotationKey: string,
): string[] {
  const annotation = data.annotations[annotationKey];
  const annotationRows = data.annotation_data?.[annotationKey];
  if (!annotation || !annotationRows || !Array.isArray(annotation.values)) return [];
  const indices = getProteinAnnotationIndices(annotationRows, proteinIdx);
  if (indices.length === 0) return [];
  const out: string[] = new Array(indices.length);
  for (let k = 0; k < indices.length; k++) {
    out[k] = toInternalValue(annotation.values[indices[k]]);
  }
  return out;
}

/**
 * Tooltip — display values run through the numeric-bin label map.
 */
export function getProteinDisplayValues(
  data: VisualizationData,
  proteinIdx: number,
  annotationKey: string,
): string[] {
  const annotation = data.annotations[annotationKey];
  const values = getProteinAnnotationValues(data, proteinIdx, annotationKey);
  if (!annotation || values.length === 0) return values;
  const labelMap = getNumericBinLabelMap(annotation);
  if (labelMap.size === 0) return values;
  return values.map((v) => labelMap.get(v) ?? v);
}

export function getProteinNumericValue(
  data: VisualizationData,
  proteinIdx: number,
  annotationKey: string,
): number | null {
  return data.numeric_annotation_data?.[annotationKey]?.[proteinIdx] ?? null;
}

export function getProteinNumericType(
  data: VisualizationData,
  annotationKey: string,
): NumericAnnotationType {
  const annotation = data.annotations[annotationKey];
  return annotation?.numericType ?? annotation?.numericMetadata?.numericType ?? 'float';
}

/**
 * Hit range this protein owns, for the flat v3 score/evidence payloads. Empty
 * unless the column's storage is CSR — the flat payloads are numbered by CSR hit,
 * so there is nothing to index them by otherwise.
 */
function getCsrHitRangeFor(
  data: VisualizationData,
  proteinIdx: number,
  annotationKey: string,
): readonly [number, number] {
  const rows = data.annotation_data?.[annotationKey];
  return rows && isCsrAnnotationData(rows) ? getCsrHitRange(rows, proteinIdx) : [0, 0];
}

export function getProteinScores(
  data: VisualizationData,
  proteinIdx: number,
  annotationKey: string,
): (number[] | null)[] {
  const scores = data.annotation_scores?.[annotationKey]?.[proteinIdx];
  if (Array.isArray(scores)) return scores;
  const csr = data.annotation_scores_csr?.[annotationKey];
  if (!csr) return [];
  const [start, stop] = getCsrHitRangeFor(data, proteinIdx, annotationKey);
  const out: (number[] | null)[] = [];
  for (let hit = start; hit < stop; hit++) {
    const from = hit === 0 ? 0 : csr.hitEnd[hit - 1];
    const to = csr.hitEnd[hit];
    out.push(to > from ? Array.from(csr.values.subarray(from, to)) : null);
  }
  return out;
}

export function getProteinEvidence(
  data: VisualizationData,
  proteinIdx: number,
  annotationKey: string,
): (string | null)[] {
  const evidence = data.annotation_evidence?.[annotationKey]?.[proteinIdx];
  if (Array.isArray(evidence)) return evidence;
  const csr = data.annotation_evidence_csr?.[annotationKey];
  if (!csr) return [];
  const [start, stop] = getCsrHitRangeFor(data, proteinIdx, annotationKey);
  const out: (string | null)[] = [];
  for (let hit = start; hit < stop; hit++) {
    const code = csr.codes[hit];
    out.push(code >= 0 ? (csr.dict[code] ?? null) : null);
  }
  return out;
}

/**
 * Tooltip view — assembled once per hover, never per-protein.
 * `blocks` is ordered: the primary annotation is first (when provided),
 * followed by any extra annotations the user has opted into.
 */
export interface AnnotationBlock {
  key: string;
  displayValues: string[];
  numericValue: number | null;
  numericType: NumericAnnotationType;
  scores: (number[] | null)[];
  evidence: (string | null)[];
  predicted: PredictedCell | null;
}

export interface TooltipView {
  proteinId: string;
  geneName: string[];
  proteinName: string[];
  uniprotKbId: string[];
  blocks: AnnotationBlock[];
}

function getHeaderValues(
  data: VisualizationData,
  proteinIdx: number,
  primaryKey: string,
  fallbackKey: string,
): string[] {
  if (data.annotations[primaryKey]) {
    return getProteinAnnotationValues(data, proteinIdx, primaryKey);
  }
  if (data.annotations[fallbackKey]) {
    return getProteinAnnotationValues(data, proteinIdx, fallbackKey);
  }
  return [];
}

function buildAnnotationBlock(
  data: VisualizationData,
  proteinIdx: number,
  key: string,
  includeEatProvenance: boolean,
): AnnotationBlock {
  const predicted = includeEatProvenance ? getPredictedCell(data, proteinIdx, key) : null;
  // An auto-cluster membership column carries each point's own silhouette after the
  // `|`. The legend strips already report every cluster's silhouette, on the scale
  // the rest of the app uses, so the point-level number is dropped rather than making
  // cluster columns the one annotation that shows a separation score per protein.
  // Dropped on read, not only at write time, because bundles prepared before this
  // still carry the suffix.
  //
  // Judged from the column name, never from `data.statisticsRows`: a filtered or isolated
  // view clears those rows, so a bundle exported from one still carries this column and its
  // suffix but nothing to recognise it by — and the score would come back mislabelled
  // "Bitscore", which `getAnnotationHeaderType` assigns to any surviving score.
  let scores: (number[] | null)[] = [];
  if (!isAutoClusterColumnName(key)) {
    scores = predicted
      ? (predicted.scores?.map((values) => (values ? [...values] : null)) ?? [])
      : getProteinScores(data, proteinIdx, key);
  }
  return {
    key,
    displayValues: predicted
      ? [...getPredictedCellValues(predicted)]
      : getProteinDisplayValues(data, proteinIdx, key),
    numericValue: getProteinNumericValue(data, proteinIdx, key),
    numericType: getProteinNumericType(data, key),
    scores,
    evidence: predicted
      ? [...(predicted.evidence ?? [])]
      : getProteinEvidence(data, proteinIdx, key),
    predicted,
  };
}

export function buildTooltipView(
  data: VisualizationData,
  proteinIdx: number,
  primaryAnnotation: string | null,
  extraAnnotations: readonly string[] = [],
  includeEatProvenance = false,
): TooltipView {
  const proteinId = data.protein_ids[proteinIdx] ?? '';
  const geneName = getHeaderValues(data, proteinIdx, 'gene_name', 'Gene name');
  const proteinName = getHeaderValues(data, proteinIdx, 'protein_name', 'Protein name');
  const uniprotKbId = data.annotations.uniprot_kb_id
    ? getProteinAnnotationValues(data, proteinIdx, 'uniprot_kb_id')
    : [];

  const blocks: AnnotationBlock[] = [];
  const seen = new Set<string>();
  if (primaryAnnotation && data.annotations[primaryAnnotation]) {
    blocks.push(buildAnnotationBlock(data, proteinIdx, primaryAnnotation, includeEatProvenance));
    seen.add(primaryAnnotation);
  }
  for (const key of extraAnnotations) {
    if (seen.has(key)) continue;
    if (!data.annotations[key]) continue;
    blocks.push(buildAnnotationBlock(data, proteinIdx, key, false));
    seen.add(key);
  }

  return {
    proteinId,
    geneName,
    proteinName,
    uniprotKbId,
    blocks,
  };
}
