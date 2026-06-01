import type { VisualizationData, NumericAnnotationType } from '../types.js';
import { getProteinAnnotationIndices } from './annotation-data-access.js';
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

export function getProteinScores(
  data: VisualizationData,
  proteinIdx: number,
  annotationKey: string,
): (number[] | null)[] {
  const scores = data.annotation_scores?.[annotationKey]?.[proteinIdx];
  return Array.isArray(scores) ? scores : [];
}

export function getProteinEvidence(
  data: VisualizationData,
  proteinIdx: number,
  annotationKey: string,
): (string | null)[] {
  const evidence = data.annotation_evidence?.[annotationKey]?.[proteinIdx];
  return Array.isArray(evidence) ? evidence : [];
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
): AnnotationBlock {
  return {
    key,
    displayValues: getProteinDisplayValues(data, proteinIdx, key),
    numericValue: getProteinNumericValue(data, proteinIdx, key),
    numericType: getProteinNumericType(data, key),
    scores: getProteinScores(data, proteinIdx, key),
    evidence: getProteinEvidence(data, proteinIdx, key),
  };
}

export function buildTooltipView(
  data: VisualizationData,
  proteinIdx: number,
  primaryAnnotation: string | null,
  extraAnnotations: readonly string[] = [],
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
    blocks.push(buildAnnotationBlock(data, proteinIdx, primaryAnnotation));
    seen.add(primaryAnnotation);
  }
  for (const key of extraAnnotations) {
    if (seen.has(key)) continue;
    if (!data.annotations[key]) continue;
    blocks.push(buildAnnotationBlock(data, proteinIdx, key));
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
