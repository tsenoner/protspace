// The dataset-building steps the v3 reader shares with the v1/v2 conversion (legacy/).
import type {
  Annotation,
  AnnotationData,
  PredictedCell,
  ProjectionStatisticRow,
  VisualizationData,
  EAT_COMPANION_SUFFIXES,
} from '@protspace/utils';
import {
  COLOR_SCHEMES,
  getEatConfidenceAnnotationKey,
  getProteinAnnotationIndices,
  getProteinEvidence,
  getProteinScores,
  isCsrAnnotationData,
  isSparseMultiValueAnnotationData,
  isCuratedAnnotationMissing,
  isNAValue,
  parseEatCompanionColumn,
  readNumericValue,
  remapCsr,
  sanitizeValue,
  sliceVisualizationDataByIndices,
  normalizeMissingValue,
  NA_VALUE,
  NA_DEFAULT_COLOR,
} from '@protspace/utils';
import type { Rows } from './types';

/** Keys to exclude when building metadata */
const METADATA_EXCLUDED_KEYS = new Set(['projection_name', 'name', 'info_json']);

export function createNumericAnnotation(
  numericType: 'int' | 'float',
  runtime?: Annotation['runtime'],
): Annotation {
  return {
    kind: 'numeric',
    numericType,
    values: [],
    colors: [],
    shapes: [],
    runtime,
  };
}

function allocateEatConfidenceAnnotationKey(
  annotations: Readonly<Record<string, Annotation>>,
  base: string,
): string {
  const preferred = getEatConfidenceAnnotationKey(base);
  if (!(preferred in annotations)) return preferred;

  let suffix = 2;
  while (`${preferred}__runtime_${suffix}` in annotations) suffix += 1;
  return `${preferred}__runtime_${suffix}`;
}

function readCategoricalStorageValues(
  data: VisualizationData,
  annotationKey: string,
  proteinIdx: number,
): string[] {
  const annotation = data.annotations[annotationKey];
  const rows = data.annotation_data[annotationKey];
  if (!annotation || !rows || annotation.kind !== 'categorical') return [];
  return getProteinAnnotationIndices(rows, proteinIdx)
    .map((index) => annotation.values[index])
    .filter((value): value is string => value != null && !isNAValue(value))
    .map((value) => normalizeMissingValue(value))
    .filter((value): value is string => value != null)
    .map((value) => value.trim())
    .filter(Boolean);
}

function readCategoricalStorageValue(
  data: VisualizationData,
  annotationKey: string,
  proteinIdx: number,
): string | null {
  const values = readCategoricalStorageValues(data, annotationKey, proteinIdx);
  return values.length > 0 ? values.join(';') : null;
}

function remapCategoricalStorage(
  source: AnnotationData,
  oldValues: readonly (string | null)[],
  valueToNewIndex: ReadonlyMap<string, number>,
): AnnotationData {
  const remap = (index: number): number => {
    if (index < 0) return -1;
    const value = oldValues[index];
    return value == null ? -1 : (valueToNewIndex.get(value) ?? -1);
  };
  if (source instanceof Int32Array) {
    const result = new Int32Array(source.length);
    for (let i = 0; i < source.length; i++) result[i] = remap(source[i]);
    return result;
  }
  if (isSparseMultiValueAnnotationData(source)) {
    const base = remapCategoricalStorage(source.base, oldValues, valueToNewIndex) as Int32Array;
    const overrides = new Map<number, readonly number[]>();
    for (const [proteinIndex, indices] of source.overrides) {
      overrides.set(
        proteinIndex,
        indices.map(remap).filter((index) => index >= 0),
      );
    }
    return { kind: 'sparse-multi', base, overrides, length: base.length };
  }
  if (isCsrAnnotationData(source)) {
    // Codes index `oldValues`, so the remap is tabulated once per value rather than per
    // hit; a dropped hit takes its score and evidence with it.
    return remapCsr(
      source,
      Int32Array.from(oldValues, (_, index) => remap(index)),
    ).column;
  }
  return source.map((indices) => indices.map(remap).filter((index) => index >= 0));
}

/**
 * Collapse backend EAT companion columns into the typed side-channel used by the renderer.
 * This is intentionally the final conversion-boundary step so small, optimized, and separated
 * decoder paths all share exactly one validity rule.
 */
export function normalizeEatCompanionColumns(data: VisualizationData): VisualizationData {
  const groups = new Map<string, Partial<Record<keyof typeof EAT_COMPANION_SUFFIXES, string>>>();
  const reservedColumns = new Set<string>();
  for (const column of Object.keys(data.annotations)) {
    const parsed = parseEatCompanionColumn(column);
    if (!parsed) continue;
    reservedColumns.add(column);
    const group = groups.get(parsed.base) ?? {};
    group[parsed.kind] = column;
    groups.set(parsed.base, group);
  }
  if (groups.size === 0) return data;

  const annotations = { ...data.annotations };
  const annotation_data = { ...data.annotation_data };
  const numeric_annotation_data = { ...data.numeric_annotation_data };
  const annotation_scores = { ...data.annotation_scores };
  const annotation_evidence = { ...data.annotation_evidence };
  const annotation_predicted = { ...data.annotation_predicted };

  for (const column of reservedColumns) {
    delete annotations[column];
    delete annotation_data[column];
    delete numeric_annotation_data[column];
    delete annotation_scores[column];
    delete annotation_evidence[column];
  }

  for (const [base, group] of groups) {
    if (!group.value || !group.confidence || !group.source) {
      console.warn(`Ignored incomplete EAT companion schema for annotation "${base}".`);
      continue;
    }
    const baseAnnotation = annotations[base];
    const baseRows = annotation_data[base];
    const confidences = data.numeric_annotation_data?.[group.confidence];
    if (!baseAnnotation || baseAnnotation.kind !== 'categorical' || !baseRows || !confidences) {
      console.warn(`Ignored invalid EAT companion schema for annotation "${base}".`);
      continue;
    }

    const cells = new Array<PredictedCell | null>(data.protein_ids.length).fill(null);
    const predictionOnlyValues: string[] = [];
    const knownValues = new Set(
      baseAnnotation.values.filter((value): value is string => value != null && !isNAValue(value)),
    );
    let invalidCount = 0;
    for (let i = 0; i < data.protein_ids.length; i++) {
      if (!isCuratedAnnotationMissing(data, base, i)) continue;
      const values = readCategoricalStorageValues(data, group.value, i);
      const value = values.length > 0 ? values.join(';') : null;
      const source = readCategoricalStorageValue(data, group.source, i);
      const confidence = readNumericValue(confidences, i);
      if (
        value == null ||
        source == null ||
        confidence == null ||
        confidence < 0 ||
        confidence > 1
      ) {
        if (value != null || source != null || confidence != null) invalidCount += 1;
        continue;
      }
      // Via the accessors so a CSR-stored companion column resolves too.
      const scores = getProteinScores(data, i, group.value);
      const evidence = getProteinEvidence(data, i, group.value);
      cells[i] = {
        value,
        ...(values.length > 1 ? { values } : {}),
        ...(scores.some((entry) => entry !== null) ? { scores } : {}),
        ...(evidence.some((entry) => entry !== null) ? { evidence } : {}),
        confidence,
        source,
      };
      for (const label of values) {
        if (knownValues.has(label)) continue;
        knownValues.add(label);
        predictionOnlyValues.push(label);
      }
    }
    if (invalidCount > 0) {
      console.warn(`Ignored ${invalidCount} invalid EAT row(s) for annotation "${base}".`);
    }
    if (!cells.some(Boolean)) continue;

    const sourceIndexes = new Map<string, number>();
    for (const cell of cells) {
      if (cell) sourceIndexes.set(cell.source, -1);
    }
    data.protein_ids.forEach((proteinId, index) => {
      if (sourceIndexes.has(proteinId)) sourceIndexes.set(proteinId, index);
    });
    for (const cell of cells) {
      if (!cell) continue;
      const sourceIndex = sourceIndexes.get(cell.source) ?? -1;
      if (sourceIndex >= 0) {
        Object.defineProperty(cell, 'sourceIndex', {
          value: sourceIndex,
          enumerable: false,
          configurable: false,
          writable: false,
        });
      }
    }

    const oldValues = baseAnnotation.values;
    const observedValues = oldValues.filter(
      (value): value is string => value != null && !isNAValue(value),
    );
    const hadNA = oldValues.some((value) => value != null && isNAValue(value));
    const values = [...observedValues, ...predictionOnlyValues, ...(hadNA ? [NA_VALUE] : [])];
    const valueToNewIndex = new Map(values.map((value, index) => [value, index]));
    const previousStyle = new Map(
      oldValues.map((value, index) => [
        value,
        { color: baseAnnotation.colors[index], shape: baseAnnotation.shapes[index] },
      ]),
    );
    const colors = values.map(
      (value, index) =>
        previousStyle.get(value)?.color ??
        COLOR_SCHEMES.kellys[index % COLOR_SCHEMES.kellys.length],
    );
    const shapes = values.map((value) => previousStyle.get(value)?.shape ?? 'circle');

    annotations[base] = { ...baseAnnotation, values, colors, shapes };
    annotation_data[base] = remapCategoricalStorage(baseRows, oldValues, valueToNewIndex);
    annotation_predicted[base] = cells;

    const confidenceKey = allocateEatConfidenceAnnotationKey(annotations, base);
    annotations[confidenceKey] = createNumericAnnotation('float', {
      role: 'eat-confidence',
      baseAnnotation: base,
    });
    numeric_annotation_data[confidenceKey] = Float64Array.from(
      cells,
      (cell) => cell?.confidence ?? NaN,
    );
  }

  return {
    ...data,
    annotations,
    annotation_data,
    numeric_annotation_data,
    annotation_scores,
    annotation_evidence,
    annotation_predicted:
      Object.keys(annotation_predicted).length > 0 ? annotation_predicted : undefined,
  };
}

/**
 * {@link appendSyntheticNACategory} for a dictionary-code column: missing slots are
 * already `-1`, so the synthetic category is appended and every `-1` routed to it.
 *
 * Mutates the input arrays in place. Shared with the format v3 reader so both storage
 * shapes gain the `__NA__` legend row under exactly one rule.
 */
export function appendSyntheticNACategoryToCodes(
  uniqueValues: string[],
  colors: string[],
  shapes: string[],
  codes: Int32Array,
): void {
  if (!codes.some((code) => code < 0)) return;

  const naIndex = uniqueValues.length;
  uniqueValues.push(NA_VALUE);
  colors.push(NA_DEFAULT_COLOR);
  shapes.push('circle');
  for (let p = 0; p < codes.length; p++) {
    if (codes[p] < 0) codes[p] = naIndex;
  }
}

/**
 * Parses the info_json field and returns its contents as sanitized metadata fields.
 * This handles the round-trip case where metadata was serialized to JSON during export.
 */
function parseInfoJson(value: unknown): Record<string, unknown> {
  if (typeof value !== 'string' || !value) return {};

  try {
    const parsed = JSON.parse(value);
    if (typeof parsed !== 'object' || parsed === null) return {};

    const result: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(parsed)) {
      // Skip dimension as it's handled separately by convertBundleFormatData
      if (key !== 'dimension') {
        result[key] = sanitizeValue(val);
      }
    }
    return result;
  } catch {
    // If parsing fails, return empty object
    return {};
  }
}

/**
 * Builds a metadata map from projections metadata rows.
 * Parses info_json field and spreads its contents into metadata.
 */
export function buildProjectionsMetadataMap(
  projectionsMetadata?: Rows,
): Map<string, Record<string, unknown>> {
  const metadataMap = new Map<string, Record<string, unknown>>();

  if (!projectionsMetadata?.length) return metadataMap;

  for (const metaRow of projectionsMetadata) {
    const projName = metaRow.projection_name || metaRow.name;
    if (!projName) continue;

    // Start with parsed info_json fields (if present)
    const metadata: Record<string, unknown> = parseInfoJson(metaRow.info_json);

    // Add remaining fields (excluding projection identifiers and info_json)
    for (const [key, value] of Object.entries(metaRow)) {
      if (!METADATA_EXCLUDED_KEYS.has(key)) {
        metadata[key] = sanitizeValue(value);
      }
    }

    metadataMap.set(String(projName), metadata);
  }

  return metadataMap;
}

/**
 * Drop every protein that no projection places, i.e. that has no finite coordinate
 * anywhere. v2 built the protein list from the projection rows, so a protein with
 * annotations only was never shown, counted or searchable; v3 keeps such rows in the
 * file, and this restores that protein set for both readers. A protein missing from
 * only some projections stays, and the scatter plot culls it per projection.
 *
 * A dataset without projections has nothing to place its proteins, so it is returned
 * unchanged, as is the common case where every protein is placed (no copy).
 *
 * The slice clears statistics; every reader runs this before {@link carryStatistics}
 * attaches the bundle's, so the file's dataset keeps them.
 */
export function dropUnplacedProteins(data: VisualizationData): VisualizationData {
  const n = data.protein_ids.length;
  if (data.projections.length === 0) return data;

  const placed = new Uint8Array(n);
  for (const { data: coords, dimension } of data.projections) {
    for (let i = 0; i < n; i++) {
      if (placed[i]) continue;
      for (let axis = 0; axis < dimension; axis++) {
        if (Number.isFinite(coords[i * dimension + axis])) {
          placed[i] = 1;
          break;
        }
      }
    }
  }

  const kept: number[] = [];
  for (let i = 0; i < n; i++) if (placed[i]) kept.push(i);
  if (kept.length === n) return data;

  return sliceVisualizationDataByIndices(data, kept);
}

/**
 * Attach the bundle's statistics part: the unparsed bytes so an export can re-emit them,
 * and the parsed rows so the UI can render them. Raw `Rows` input (plain .parquet / legacy
 * reads) never carries either, so it passes straight through.
 */
export function carryStatistics(
  data: VisualizationData,
  input:
    | { statistics: ArrayBuffer | null; statisticsRows?: readonly ProjectionStatisticRow[] | null }
    | Rows,
): VisualizationData {
  if (!Array.isArray(input) && input.statistics) {
    data.statistics = input.statistics;
    data.statisticsRows = input.statisticsRows ?? undefined;
  }
  return data;
}

/**
 * Shapes supported by the WebGL renderer, ordered by visual distinctness for
 * optimal category separation when generateColorsAndShapes cycles through pairs.
 */
const SUPPORTED_SHAPES = [
  'circle',
  'square',
  'diamond',
  'plus',
  'triangle-up',
  'triangle-down',
] as const;

/**
 * Generates paired colors and shapes for categories using a palette.
 *
 * Shape advances only after a full color cycle, so all palette.length ×
 * shapeCount combinations are exhausted before any pair repeats.
 *
 * The array length is capped at min(count, palette.length × shapeCount) so we
 * never allocate beyond the number of distinct pairs. Consumers index via
 * `colors[i % colors.length]` and `shapes[i % shapes.length]` to handle
 * categories beyond the cap (they wrap around to the beginning of the cycle).
 *
 * @param paletteId - Key of the palette in COLOR_SCHEMES (falls back to 'kellys')
 * @param count - Number of (color, shape) pairs to generate
 */
export function generateColorsAndShapes(
  paletteId: string,
  count: number,
): { colors: string[]; shapes: string[] } {
  if (count <= 0) return { colors: [], shapes: [] };
  const palette =
    (COLOR_SCHEMES as Record<string, readonly string[]>)[paletteId] ?? COLOR_SCHEMES.kellys;
  const distinctPairs = palette.length * SUPPORTED_SHAPES.length;
  // Cap allocation at the number of distinct pairs so we never store more
  // pointer slots than there are distinct (color, shape) combinations.
  // For count beyond the cap, consumers index via colors[i % colors.length].
  const len = Math.min(count, distinctPairs);
  const colors: string[] = new Array(len);
  const shapes: string[] = new Array(len);
  for (let i = 0; i < len; i++) {
    // Within a block of palette.length entries, color advances; shape advances
    // once per complete color cycle. This exhausts all pairs before repeating.
    colors[i] = palette[i % palette.length];
    shapes[i] = SUPPORTED_SHAPES[Math.floor(i / palette.length) % SUPPORTED_SHAPES.length];
  }
  return { colors, shapes };
}
