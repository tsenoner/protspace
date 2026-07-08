import type { Annotation, AnnotationData, VisualizationData } from '@protspace/utils';
import {
  COLOR_SCHEMES,
  sanitizeValue,
  normalizeMissingValue,
  NA_VALUE,
  NA_DEFAULT_COLOR,
} from '@protspace/utils';
import { validateRowsBasic } from './validation';
import { findColumn, materializeMergedRows, type BundleExtractionResult } from './bundle';
import type { Rows, GenericRow } from './types';
import { decodeField } from './annotation-codec';

/**
 * Fast yield using MessageChannel instead of setTimeout(0).
 * setTimeout(0) has a ~4ms minimum delay in browsers;
 * MessageChannel.postMessage fires in ~0.1ms.
 */
function fastYield(): Promise<void> {
  return new Promise((resolve) => {
    const ch = new MessageChannel();
    ch.port1.onmessage = () => resolve();
    ch.port2.postMessage(null);
  });
}

/** Column names that should be excluded when identifying annotation columns */
const ID_COLUMNS = [
  'projection_name',
  'x',
  'y',
  'z',
  'identifier',
  'protein_id',
  'id',
  'uniprot',
  'entry',
] as const;

/** Creates a set of ID columns including the detected protein ID column */
function getIdColumnsSet(proteinIdCol: string): Set<string> {
  return new Set([...ID_COLUMNS, proteinIdCol]);
}

/** Keys to exclude when building metadata */
const METADATA_EXCLUDED_KEYS = new Set(['projection_name', 'name', 'info_json']);

/** Match GO/ECO evidence codes: 2–5 uppercase letters OR ECO:NNNNNNN */
const EVIDENCE_CODE_RE = /^(?:[A-Z]{2,5}|ECO:\d+)$/;

type InferredAnnotationType = 'int' | 'float' | 'string';

interface AnnotationInferenceResult {
  inferredType: InferredAnnotationType;
  numericValues: (number | null)[];
}

function parseNumericAnnotationValue(rawValue: unknown): number | null {
  if (typeof rawValue === 'number') {
    return Number.isFinite(rawValue) ? rawValue : null;
  }

  if (typeof rawValue === 'bigint') {
    const parsed = Number(rawValue);
    return Number.isSafeInteger(parsed) ? parsed : null;
  }

  if (typeof rawValue === 'string') {
    const trimmed = rawValue.trim();
    if (!trimmed || trimmed.includes(';') || trimmed.includes('|')) {
      return null;
    }

    const parsed = Number(trimmed);
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
}

function inferAnnotationType(values: Iterable<unknown>): AnnotationInferenceResult {
  const numericValues: (number | null)[] = [];
  let sawNumericValue = false;
  let sawNonIntegerValue = false;

  for (const rawValue of values) {
    // Apply the boundary normalization first: every flavor of "missing" becomes null.
    const normalized = normalizeMissingValue(rawValue);

    if (normalized == null) {
      numericValues.push(null);
      continue;
    }

    const parsed = parseNumericAnnotationValue(normalized);
    numericValues.push(parsed);

    if (parsed == null) {
      // Non-numeric, non-missing value — column is categorical.
      return { inferredType: 'string', numericValues };
    }

    sawNumericValue = true;
    if (!Number.isInteger(parsed)) {
      sawNonIntegerValue = true;
    }
  }

  if (!sawNumericValue) {
    return { inferredType: 'string', numericValues };
  }

  return { inferredType: sawNonIntegerValue ? 'float' : 'int', numericValues };
}

function* valuesForColumn(rows: Rows, column: string): Iterable<unknown> {
  for (const row of rows) {
    yield row[column];
  }
}

function createNumericAnnotation(numericType: 'int' | 'float'): Annotation {
  return {
    kind: 'numeric',
    numericType,
    values: [],
    colors: [],
    shapes: [],
  };
}

function createCategoricalAnnotation(
  uniqueValues: string[],
  colors: string[],
  shapes: string[],
): Annotation {
  return {
    kind: 'categorical',
    values: uniqueValues,
    colors,
    shapes,
  };
}

/**
 * If any cell has no real values, append a synthetic `__NA__` category to the
 * unique-values / colors / shapes arrays and route the empty cells to it. Mirrors
 * `materializeNumericAnnotation` in numeric-binning.ts: missing-value proteins
 * get a single legend row to live in instead of being orphaned.
 *
 * Mutates the input arrays in place.
 */
function appendSyntheticNACategory(
  uniqueValues: string[],
  colors: string[],
  shapes: string[],
  annotationDataArray: number[][],
): void {
  const hasMissingValues = annotationDataArray.some((arr) => arr.length === 0);
  if (!hasMissingValues) return;

  const naIndex = uniqueValues.length;
  uniqueValues.push(NA_VALUE);
  colors.push(NA_DEFAULT_COLOR);
  shapes.push('circle');
  for (let p = 0; p < annotationDataArray.length; p++) {
    if (annotationDataArray[p].length === 0) {
      annotationDataArray[p] = [naIndex];
    }
  }
}

/**
 * Parse an annotation value that may contain a pipe-separated score or evidence code suffix.
 * Format: `label|score`, `label|score1,score2,...`, or `label|EVIDENCE_CODE`
 * If the part after the last `|` is numeric → scores.
 * If it matches an evidence code pattern (2–5 uppercase letters or ECO:digits) → evidence.
 * Otherwise the full string is kept as the label.
 * Examples:
 *   "PF00001 (7tm_1)|1.5e-10"       → { label: "PF00001 (7tm_1)", scores: [1.5e-10], evidence: null }
 *   "PF00001|1.5e-10,2.3e-5"        → { label: "PF00001", scores: [1.5e-10, 2.3e-5], evidence: null }
 *   "Cytoplasm|EXP"                  → { label: "Cytoplasm", scores: [], evidence: "EXP" }
 *   "Cytoplasm|ECO:0000269"          → { label: "Cytoplasm", scores: [], evidence: "ECO:0000269" }
 *   "GO:0005524|ATP binding"         → { label: "GO:0005524|ATP binding", scores: [], evidence: null }
 *   "taxonomy_value"                 → { label: "taxonomy_value", scores: [], evidence: null }
 */
/**
 * Dispatches to the v1 (paren-aware, raw label) or v2 (decodeField) parser based on
 * the bundle's `formatVersion`. Defaults to v1 so existing callers that don't yet
 * thread a format version keep byte-identical behavior (threaded end-to-end in
 * Task H2).
 */
export const parseAnnotationValue = (
  raw: string,
  formatVersion = 1,
): { label: string; scores: number[]; evidence: string | null } =>
  formatVersion >= 2 ? parseAnnotationValueV2(raw) : parseAnnotationValueV1(raw);

const parseAnnotationValueV1 = (
  raw: string,
): { label: string; scores: number[]; evidence: string | null } => {
  const trimmed = raw.trim();
  if (!trimmed) return { label: '', scores: [], evidence: null };

  const lastPipe = trimmed.lastIndexOf('|');
  if (lastPipe === -1 || lastPipe === trimmed.length - 1) {
    return { label: trimmed, scores: [], evidence: null };
  }

  const suffix = trimmed.substring(lastPipe + 1).trim();

  // Check for evidence code pattern (2–5 uppercase letters or ECO:digits)
  if (EVIDENCE_CODE_RE.test(suffix)) {
    const label = trimmed.substring(0, lastPipe).trim();
    return { label, scores: [], evidence: suffix };
  }

  // Check for numeric scores
  const parts = suffix.split(',');
  const scores: number[] = [];

  for (const part of parts) {
    const num = Number(part.trim());
    if (!Number.isFinite(num)) {
      // Not numeric and not an evidence code — treat the full string as the label
      return { label: trimmed, scores: [], evidence: null };
    }
    scores.push(num);
  }

  const label = trimmed.substring(0, lastPipe).trim();
  return { label, scores, evidence: null };
};

/**
 * v2 parser: names are percent-encoded at the source (bundle format v2), so `|`
 * and `;` never appear inside a name — the last `|` is always the single
 * structural separator between the (encoded) label and its score/evidence
 * suffix. Decode the label via {@link decodeField}; evidence tokens never
 * contain reserved characters (evidence codes match [A-Z]{2,5}|ECO:\d+) so
 * they need no decode. Numeric scores are parsed as-is.
 */
const parseAnnotationValueV2 = (
  raw: string,
): { label: string; scores: number[]; evidence: string | null } => {
  const trimmed = raw.trim();
  if (!trimmed) return { label: '', scores: [], evidence: null };

  // In v2 no name contains '|', so there is at most one structural pipe.
  const pipe = trimmed.lastIndexOf('|');
  if (pipe === -1 || pipe === trimmed.length - 1) {
    return { label: decodeField(trimmed), scores: [], evidence: null };
  }

  const suffix = trimmed.substring(pipe + 1).trim();
  const label = decodeField(trimmed.substring(0, pipe).trim());

  if (EVIDENCE_CODE_RE.test(suffix)) {
    return { label, scores: [], evidence: suffix };
  }

  const scores: number[] = [];
  for (const part of suffix.split(',')) {
    const num = Number(part.trim());
    if (!Number.isFinite(num)) {
      return { label: decodeField(trimmed), scores: [], evidence: null };
    }
    scores.push(num);
  }
  return { label, scores, evidence: null };
};

/**
 * Split a categorical annotation cell on the top-level hit separator ';'.
 *
 * Multi-hit values are encoded as `accession (name)|score;accession2 (name2)|score`,
 * but a name can legitimately contain ';' — e.g. CATH-Gene3D names such as
 * "Ribosomal Protein L15; Chain: K; domain 2". A naive `split(';')` shatters one hit
 * into bogus categories ("Chain: K", "domain 2)"). Splitting only on ';' at parenthesis
 * depth 0 keeps each `(name)` intact while still separating distinct hits.
 *
 * If a name contains an unbalanced '(' so the running depth never returns to 0, fall back
 * to a plain split so two distinct hits are not merged — at the cost of re-splitting that
 * one rare value. Note this only catches a *net* imbalance (depth != 0 at the end): a stray
 * '(' in one hit cancelled by a stray ')' in a later hit leaves the final depth at 0, so the
 * inter-hit ';' (seen while depth was > 0) is silently swallowed and those two hits merge.
 * Both are symptoms of unsanitized names; sanitizing at the source is tracked in
 * tsenoner/protspace#56.
 */
function splitOnTopLevelSemicolons(value: string): string[] {
  // Fast path: with no '(' the depth stays 0 throughout, so the paren-aware scan
  // is byte-identical to a native split. Skip it for the common case
  // (Kingdom/Organism/Localization cells carry no parentheses).
  if (!value.includes('(')) {
    return value.split(';');
  }

  // Index scan + slice: cut the string only at top-level ';' positions, avoiding the
  // per-character allocation and code-point decoding of a `for..of` + `current += ch` build.
  const parts: string[] = [];
  let depth = 0;
  let start = 0;

  for (let i = 0; i < value.length; i += 1) {
    const ch = value[i];
    if (ch === '(') {
      depth += 1;
    } else if (ch === ')') {
      if (depth > 0) depth -= 1; // clamp at 0 so a stray ')' can't go negative
    } else if (ch === ';' && depth === 0) {
      parts.push(value.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(value.slice(start));

  if (depth !== 0) {
    return value.split(';');
  }
  return parts;
}

/**
 * Split a raw categorical annotation cell into its individual hit strings.
 *
 * Normalizes the whole cell first (an entirely missing cell yields `[]`), splits on the
 * top-level ';' separator via {@link splitOnTopLevelSemicolons} (paren-aware, so names
 * containing ';' stay intact), then trims each token and drops empty or missing-value tokens.
 *
 * @param rawValue - the raw cell value; non-strings are normalized then stringified.
 * @param formatVersion - bundle format version; v2 names are percent-encoded at the
 *   source so they never carry a raw ';', making the paren-aware scan unnecessary.
 *   Defaults to 1 so existing callers keep v1 (paren-aware) behavior until Task H2
 *   threads the real version through.
 * @returns the trimmed, non-missing hit strings, in source order.
 */
export function splitCategoricalAnnotationValues(rawValue: unknown, formatVersion = 1): string[] {
  // First-level: normalize the whole cell. Returns null if the entire cell is missing.
  const cellNormalized = normalizeMissingValue(rawValue);
  if (cellNormalized == null) return [];

  // v2: names carry no raw ';' (percent-encoded at the source), so a plain split
  // suffices. v1: paren-aware split, since raw names may legitimately contain ';'.
  const parts =
    formatVersion >= 2
      ? String(cellNormalized).split(';')
      : splitOnTopLevelSemicolons(String(cellNormalized));

  return parts
    .map((part) => part.trim())
    .filter((part) => part !== '' && normalizeMissingValue(part) !== null);
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
function buildProjectionsMetadataMap(
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
 * Builds a coordinate map from projection rows.
 * Maps protein IDs to their [x, y] or [x, y, z] coordinates.
 */
function buildCoordinateMap(
  projectionRows: Rows,
  proteinIdCol: string,
): Map<string, [number, number] | [number, number, number]> {
  const coordMap = new Map<string, [number, number] | [number, number, number]>();
  for (const row of projectionRows) {
    const proteinId = row[proteinIdCol] != null ? String(row[proteinIdCol]) : '';
    const x = Number(row.x) || 0;
    const y = Number(row.y) || 0;
    const zValue = row.z;
    const z = zValue == null ? null : Number(zValue);
    if (z !== null && !Number.isNaN(z)) {
      coordMap.set(proteinId, [x, y, z]);
    } else {
      coordMap.set(proteinId, [x, y]);
    }
  }
  return coordMap;
}

export function convertParquetToVisualizationData(
  input: BundleExtractionResult | Rows,
  projectionsMetadata?: Rows,
): VisualizationData {
  // Slow path: materialize merged rows (small datasets, acceptable cost)
  const rows: Rows = Array.isArray(input) ? input : materializeMergedRows(input);
  const meta: Rows | undefined = Array.isArray(input)
    ? projectionsMetadata
    : input.projectionsMetadata;
  // Raw `Rows` input is always a non-bundle (plain .parquet / legacy test) read → v1.
  // `BundleExtractionResult` carries the version detected from the bundle's parquet
  // key-value metadata by `extractRowsFromParquetBundle` (bundle.ts).
  const formatVersion = Array.isArray(input) ? 1 : input.formatVersion;

  validateRowsBasic(rows);

  const columnNames = Object.keys(rows[0]);
  const hasProjectionName = columnNames.includes('projection_name');
  const hasXY = columnNames.includes('x') && columnNames.includes('y');

  if (hasProjectionName && hasXY) {
    return convertBundleFormatData(rows, columnNames, meta, formatVersion);
  }
  return convertLegacyFormatData(rows, columnNames, formatVersion);
}

export function convertParquetToVisualizationDataOptimized(
  input: BundleExtractionResult | Rows,
  projectionsMetadata?: Rows,
): Promise<VisualizationData> {
  if (Array.isArray(input)) {
    // Legacy path: raw rows passed directly (e.g. from tests or plain parquet files)
    validateRowsBasic(input);
    const dataSize = input.length;
    if (dataSize < 10000) {
      return Promise.resolve(convertParquetToVisualizationData(input, projectionsMetadata));
    }
    return convertLargeDatasetOptimizedRaw(input, projectionsMetadata);
  }

  // New path: separated extraction shape from extractRowsFromParquetBundle
  const numProjectionRows = input.projections.length;
  if (numProjectionRows < 10000) {
    return Promise.resolve(convertParquetToVisualizationData(input));
  }
  return convertLargeDatasetOptimized(input);
}

async function convertLargeDatasetOptimizedRaw(
  rows: Rows,
  projectionsMetadata?: Rows,
): Promise<VisualizationData> {
  const columnNames = Object.keys(rows[0]);
  const hasProjectionName = columnNames.includes('projection_name');
  const hasXY = columnNames.includes('x') && columnNames.includes('y');
  // Raw `Rows` input is always a non-bundle (plain .parquet / legacy test) read → v1.
  if (hasProjectionName && hasXY) {
    return convertBundleFormatDataOptimized(rows, columnNames, projectionsMetadata, 1);
  }
  return convertLegacyFormatData(rows, columnNames, 1);
}

async function convertLargeDatasetOptimized(
  extraction: BundleExtractionResult,
): Promise<VisualizationData> {
  const {
    projections: projectionRows,
    annotationsById,
    projectionIdColumn,
    projectionsMetadata,
    formatVersion,
  } = extraction;
  const columnNames = Object.keys(projectionRows[0]);
  const hasProjectionName = columnNames.includes('projection_name');
  const hasXY = columnNames.includes('x') && columnNames.includes('y');
  if (hasProjectionName && hasXY) {
    // Derive annotation column names from the first annotation row.
    // Safe because the upstream parquet decoder produces a uniform schema
    // for all rows in a single table (selectedAnnotationsData), so any
    // row's keys are a complete column set. If a future writer emits
    // sparse rows, switch to a union of all rows' keys.
    const annotationColumnNames =
      annotationsById.size > 0
        ? Object.keys(annotationsById.values().next().value as GenericRow)
        : [];
    return convertBundleFormatDataOptimizedSeparated(
      projectionRows,
      annotationsById,
      projectionIdColumn,
      annotationColumnNames,
      projectionsMetadata,
      formatVersion,
    );
  }
  // Legacy format: materialize rows (should not happen with bundle extraction, but safe fallback)
  const rows = materializeMergedRows(extraction);
  return convertLegacyFormatData(rows, columnNames, formatVersion);
}

function convertBundleFormatData(
  rows: Rows,
  columnNames: string[],
  projectionsMetadata?: Rows,
  formatVersion = 1,
): VisualizationData {
  const proteinIdCol =
    findColumn(columnNames, ['identifier', 'protein_id', 'id', 'protein', 'uniprot']) ||
    columnNames[0];

  const projectionGroups = new Map<string, Rows>();
  for (const row of rows) {
    const projectionName = String(row.projection_name || 'Unknown');
    let group = projectionGroups.get(projectionName);
    if (!group) {
      group = [];
      projectionGroups.set(projectionName, group);
    }
    group.push(row);
  }

  const uniqueProteinIds = Array.from(
    new Set(
      rows.map((row) => {
        const value = row[proteinIdCol];
        return value ? String(value) : '';
      }),
    ),
  );

  const metadataMap = buildProjectionsMetadataMap(projectionsMetadata);

  const projections = [] as VisualizationData['projections'];
  for (const [projectionName, projectionRows] of projectionGroups.entries()) {
    const coordMap = buildCoordinateMap(projectionRows, proteinIdCol);
    let has3D = false;
    for (const v of coordMap.values()) {
      if (v.length === 3) {
        has3D = true;
        break;
      }
    }
    const dimension: 2 | 3 = has3D ? 3 : 2;
    const data = new Float32Array(uniqueProteinIds.length * dimension);
    for (let i = 0; i < uniqueProteinIds.length; i++) {
      const c = coordMap.get(uniqueProteinIds[i]);
      const base = i * dimension;
      if (c) {
        data[base] = c[0];
        data[base + 1] = c[1];
        if (dimension === 3) data[base + 2] = c.length === 3 ? c[2] : 0;
      }
    }

    // Merge dimension with existing metadata from projectionsMetadata
    const existingMetadata = metadataMap.get(projectionName) || {};
    const metadata = {
      ...existingMetadata,
      dimension,
    };

    projections.push({
      name: formatProjectionName(projectionName),
      data,
      dimension,
      metadata,
    });
  }

  const allIdColumns = getIdColumnsSet(proteinIdCol);
  const annotationColumns = columnNames.filter((col) => !allIdColumns.has(col));

  const annotations: Record<string, Annotation> = {};
  const annotation_data: Record<string, AnnotationData> = {};
  const numeric_annotation_data: Record<string, (number | null)[]> = {};
  const annotation_scores: Record<string, (number[] | null)[][]> = {};
  const annotation_evidence: Record<string, (string | null)[][]> = {};

  const baseProjectionData = projectionGroups.values().next().value || rows;
  const baseRowsByProteinId = new Map<string, Rows[number]>();
  for (const row of baseProjectionData) {
    baseRowsByProteinId.set(String(row[proteinIdCol] ?? ''), row);
  }

  for (const annotationCol of annotationColumns) {
    const inference = inferAnnotationType(valuesForColumn(baseProjectionData, annotationCol));
    if (inference.inferredType !== 'string') {
      numeric_annotation_data[annotationCol] = uniqueProteinIds.map((proteinId) => {
        const row = baseRowsByProteinId.get(proteinId);
        const rawValue = row?.[annotationCol];
        const normalized = normalizeMissingValue(rawValue);
        if (normalized == null) return null;
        return parseNumericAnnotationValue(normalized);
      });
      annotations[annotationCol] = createNumericAnnotation(inference.inferredType);
      continue;
    }

    const annotationMap = new Map<string, string[]>();
    const annotationScoreMap = new Map<string, (number[] | null)[]>();
    const annotationEvidenceMap = new Map<string, (string | null)[]>();
    const valueCountMap = new Map<string, number>();
    let columnHasScores = false;
    let columnHasEvidence = false;

    for (const row of baseProjectionData) {
      const proteinId = row[proteinIdCol] != null ? String(row[proteinIdCol]) : '';
      const rawValues = splitCategoricalAnnotationValues(row[annotationCol], formatVersion);

      if (rawValues.length === 0) {
        annotationMap.set(proteinId, []);
        annotationScoreMap.set(proteinId, []);
        annotationEvidenceMap.set(proteinId, []);
        continue;
      }

      const labels: string[] = [];
      const scores: (number[] | null)[] = [];
      const evidences: (string | null)[] = [];
      for (const raw of rawValues) {
        const parsed = parseAnnotationValue(raw, formatVersion);
        labels.push(parsed.label);
        scores.push(parsed.scores.length > 0 ? parsed.scores : null);
        evidences.push(parsed.evidence);
        if (parsed.scores.length > 0) columnHasScores = true;
        if (parsed.evidence) columnHasEvidence = true;
        valueCountMap.set(parsed.label, (valueCountMap.get(parsed.label) || 0) + 1);
      }
      annotationMap.set(proteinId, labels);
      annotationScoreMap.set(proteinId, scores);
      annotationEvidenceMap.set(proteinId, evidences);
    }

    // Sort unique values by frequency (most frequent first)
    // This ensures the most common categories get the most distinct colors (slots 0, 1, 2...)
    const uniqueValues = Array.from(valueCountMap.keys()).sort(
      (a, b) => (valueCountMap.get(b) || 0) - (valueCountMap.get(a) || 0),
    );

    const valueToIndex = new Map<string | null, number>();
    uniqueValues.forEach((value, idx) => valueToIndex.set(value, idx));

    const { colors, shapes } = generateColorsAndShapes('kellys', uniqueValues.length);

    const annotationDataArray = uniqueProteinIds.map((proteinId) => {
      const value = annotationMap.get(proteinId);
      return (value ?? []).map((v) => valueToIndex.get(v) ?? -1);
    });

    if (columnHasScores) {
      annotation_scores[annotationCol] = uniqueProteinIds.map(
        (proteinId) => annotationScoreMap.get(proteinId) ?? [],
      );
    }

    if (columnHasEvidence) {
      annotation_evidence[annotationCol] = uniqueProteinIds.map(
        (proteinId) => annotationEvidenceMap.get(proteinId) ?? [],
      );
    }

    appendSyntheticNACategory(uniqueValues, colors, shapes, annotationDataArray);

    annotations[annotationCol] = createCategoricalAnnotation(uniqueValues, colors, shapes);
    annotation_data[annotationCol] = annotationDataArray;
  }

  return {
    protein_ids: uniqueProteinIds,
    projections,
    annotations,
    annotation_data,
    numeric_annotation_data,
    annotation_scores,
    annotation_evidence,
  };
}

async function convertBundleFormatDataOptimized(
  rows: Rows,
  columnNames: string[],
  projectionsMetadata?: Rows,
  formatVersion = 1,
): Promise<VisualizationData> {
  const chunkSize = 50000;
  const proteinIdCol =
    findColumn(columnNames, ['identifier', 'protein_id', 'id', 'protein', 'uniprot']) ||
    columnNames[0];

  const projectionGroups = new Map<string, Rows>();
  const uniqueProteinIdsSet = new Set<string>();

  for (let i = 0; i < rows.length; i += chunkSize) {
    const chunk = rows.slice(i, Math.min(i + chunkSize, rows.length));
    for (const row of chunk) {
      const projectionName = String(row.projection_name || 'Unknown');
      let group = projectionGroups.get(projectionName);
      if (!group) {
        group = [];
        projectionGroups.set(projectionName, group);
      }
      group.push(row);
      const proteinId = row[proteinIdCol] != null ? String(row[proteinIdCol]) : undefined;
      if (proteinId) uniqueProteinIdsSet.add(proteinId);
    }
    // yield

    await fastYield();
  }

  const uniqueProteinIds = Array.from(uniqueProteinIdsSet);

  const metadataMap = buildProjectionsMetadataMap(projectionsMetadata);

  const projections = [] as VisualizationData['projections'];
  for (const [projectionName, projectionRows] of projectionGroups.entries()) {
    const coordMap = buildCoordinateMap(projectionRows, proteinIdCol);
    let has3D = false;
    for (const v of coordMap.values()) {
      if (v.length === 3) {
        has3D = true;
        break;
      }
    }
    const dimension: 2 | 3 = has3D ? 3 : 2;
    const data = new Float32Array(uniqueProteinIds.length * dimension);
    for (let i = 0; i < uniqueProteinIds.length; i++) {
      const c = coordMap.get(uniqueProteinIds[i]);
      const base = i * dimension;
      if (c) {
        data[base] = c[0];
        data[base + 1] = c[1];
        if (dimension === 3) data[base + 2] = c.length === 3 ? c[2] : 0;
      }
    }

    // Merge dimension with existing metadata from projectionsMetadata
    const existingMetadata = metadataMap.get(projectionName) || {};
    const metadata = {
      ...existingMetadata,
      dimension,
    };

    projections.push({
      name: formatProjectionName(projectionName),
      data,
      dimension,
      metadata,
    });
    // yield

    await fastYield();
  }

  // Use only base projection's rows for annotations (not all rows across projections)
  const baseProjectionRows = projectionGroups.values().next().value || rows;
  const {
    annotations,
    annotation_data,
    numeric_annotation_data,
    annotation_scores,
    annotation_evidence,
  } = await extractAnnotationsOptimized(
    baseProjectionRows,
    columnNames,
    proteinIdCol,
    uniqueProteinIds,
    formatVersion,
  );

  return {
    protein_ids: uniqueProteinIds,
    projections,
    annotations,
    annotation_data,
    numeric_annotation_data,
    annotation_scores,
    annotation_evidence,
  };
}

/**
 * Optimized bundle-format conversion using the separated extraction shape.
 * Projection rows (with x/y/z/projection_name/identifier) are separate from
 * annotation rows keyed by protein id. No per-row spread merge is performed.
 */
async function convertBundleFormatDataOptimizedSeparated(
  projectionRows: Rows,
  annotationsById: Map<string, GenericRow>,
  projectionIdCol: string,
  annotationColumnNames: string[],
  projectionsMetadata?: Rows,
  formatVersion = 1,
): Promise<VisualizationData> {
  const chunkSize = 50000;

  // Build projection groups and unique protein IDs from projection-only rows
  const projectionGroups = new Map<string, Rows>();
  const uniqueProteinIdsSet = new Set<string>();

  for (let i = 0; i < projectionRows.length; i += chunkSize) {
    const end = Math.min(i + chunkSize, projectionRows.length);
    for (let r = i; r < end; r++) {
      const row = projectionRows[r];
      const projectionName = String(row.projection_name || 'Unknown');
      let group = projectionGroups.get(projectionName);
      if (!group) {
        group = [];
        projectionGroups.set(projectionName, group);
      }
      group.push(row);
      const proteinId = row[projectionIdCol] != null ? String(row[projectionIdCol]) : undefined;
      if (proteinId) uniqueProteinIdsSet.add(proteinId);
    }
    await fastYield();
  }

  const uniqueProteinIds = Array.from(uniqueProteinIdsSet);
  const metadataMap = buildProjectionsMetadataMap(projectionsMetadata);

  const projections = [] as VisualizationData['projections'];
  for (const [projectionName, projRows] of projectionGroups.entries()) {
    const coordMap = buildCoordinateMap(projRows, projectionIdCol);
    let has3D = false;
    for (const v of coordMap.values()) {
      if (v.length === 3) {
        has3D = true;
        break;
      }
    }
    const dimension: 2 | 3 = has3D ? 3 : 2;
    const data = new Float32Array(uniqueProteinIds.length * dimension);
    for (let i = 0; i < uniqueProteinIds.length; i++) {
      const c = coordMap.get(uniqueProteinIds[i]);
      const base = i * dimension;
      if (c) {
        data[base] = c[0];
        data[base + 1] = c[1];
        if (dimension === 3) data[base + 2] = c.length === 3 ? c[2] : 0;
      }
    }
    const existingMetadata = metadataMap.get(projectionName) || {};
    const metadata = {
      ...existingMetadata,
      dimension,
    };
    projections.push({
      name: formatProjectionName(projectionName),
      data,
      dimension,
      metadata,
    });
    await fastYield();
  }

  const {
    annotations,
    annotation_data,
    numeric_annotation_data,
    annotation_scores,
    annotation_evidence,
  } = await extractAnnotationsOptimizedSeparated(
    annotationsById,
    annotationColumnNames,
    projectionIdCol,
    uniqueProteinIds,
    formatVersion,
  );

  return {
    protein_ids: uniqueProteinIds,
    projections,
    annotations,
    annotation_data,
    numeric_annotation_data,
    annotation_scores,
    annotation_evidence,
  };
}

function convertLegacyFormatData(
  rows: Rows,
  columnNames: string[],
  formatVersion = 1,
): VisualizationData {
  const proteinIdCol =
    findColumn(columnNames, ['identifier', 'protein_id', 'id', 'protein', 'uniprot']) ||
    columnNames[0];
  if (!proteinIdCol) {
    throw new Error(`Protein ID column not found. Available columns: ${columnNames.join(', ')}`);
  }

  const projectionPairs = findProjectionPairs(columnNames);
  if (projectionPairs.length === 0) {
    const numericColumns = columnNames.filter((col) => {
      const sampleValue = rows[0][col];
      return typeof sampleValue === 'number' || !Number.isNaN(Number(sampleValue));
    });
    if (numericColumns.length === 0) {
      throw new Error(
        `No projection coordinate pairs found. Available columns: ${columnNames.join(', ')}`,
      );
    }
  }

  const protein_ids = rows.map((row) => (row[proteinIdCol] ? String(row[proteinIdCol]) : ''));

  const projections = projectionPairs.map((pair) => {
    const dimension: 2 | 3 = 2;
    const data = new Float32Array(rows.length * dimension);
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const x = Number(row[pair.xCol]);
      const y = Number(row[pair.yCol]);
      if (Number.isNaN(x) || Number.isNaN(y)) {
        console.warn(`Invalid coordinates at row ${i} for projection ${pair.name}`, { x, y });
      }
      data[i * dimension] = x;
      data[i * dimension + 1] = y;
    }
    return {
      name: pair.name,
      data,
      dimension,
    } as VisualizationData['projections'][number];
  });

  const usedColumns = new Set([proteinIdCol, ...projectionPairs.flatMap((p) => [p.xCol, p.yCol])]);
  const annotationColumns = columnNames.filter((col) => !usedColumns.has(col));

  const annotations: Record<string, Annotation> = {};
  const annotation_data: Record<string, AnnotationData> = {};
  const numeric_annotation_data: Record<string, (number | null)[]> = {};
  const annotation_scores: Record<string, (number[] | null)[][]> = {};
  const annotation_evidence: Record<string, (string | null)[][]> = {};

  for (const annotationCol of annotationColumns) {
    const inference = inferAnnotationType(valuesForColumn(rows, annotationCol));
    if (inference.inferredType !== 'string') {
      annotations[annotationCol] = createNumericAnnotation(inference.inferredType);
      numeric_annotation_data[annotationCol] = inference.numericValues;
      continue;
    }

    const rawValues: string[][] = rows.map((row) =>
      splitCategoricalAnnotationValues(row[annotationCol], formatVersion),
    );

    let columnHasScores = false;
    let columnHasEvidence = false;
    const parsed = rawValues.map((valueArray) => {
      const labels: string[] = [];
      const scores: (number[] | null)[] = [];
      const evidences: (string | null)[] = [];
      for (const raw of valueArray) {
        const p = parseAnnotationValue(raw, formatVersion);
        labels.push(p.label);
        scores.push(p.scores.length > 0 ? p.scores : null);
        evidences.push(p.evidence);
        if (p.scores.length > 0) columnHasScores = true;
        if (p.evidence) columnHasEvidence = true;
      }
      return { labels, scores, evidences };
    });

    const labelsByRow = parsed.map((p) => p.labels);
    const scoresByRow = parsed.map((p) => p.scores);
    const evidencesByRow = parsed.map((p) => p.evidences);

    const uniqueValues = Array.from(new Set(labelsByRow.flat()));
    const valueToIndex = new Map<string, number>();
    uniqueValues.forEach((value, idx) => valueToIndex.set(value, idx));

    const { colors, shapes } = generateColorsAndShapes('kellys', uniqueValues.length);

    const annotationDataArray = labelsByRow.map((valueArray) =>
      valueArray.map((v) => valueToIndex.get(v) ?? -1),
    );

    appendSyntheticNACategory(uniqueValues, colors, shapes, annotationDataArray);

    annotations[annotationCol] = createCategoricalAnnotation(uniqueValues, colors, shapes);
    annotation_data[annotationCol] = annotationDataArray;
    if (columnHasScores) {
      annotation_scores[annotationCol] = scoresByRow;
    }
    if (columnHasEvidence) {
      annotation_evidence[annotationCol] = evidencesByRow;
    }
  }

  return {
    protein_ids,
    projections,
    annotations,
    annotation_data,
    numeric_annotation_data,
    annotation_scores,
    annotation_evidence,
  };
}

function findProjectionPairs(
  columnNames: string[],
): Array<{ name: string; xCol: string; yCol: string }> {
  const pairs: Array<{ name: string; xCol: string; yCol: string }> = [];
  const groups = new Map<string, { x?: string; y?: string }>();

  for (const col of columnNames) {
    const lower = col.toLowerCase();
    if (
      lower.includes('protein') ||
      lower.includes('id') ||
      (!lower.includes('_x') &&
        !lower.includes('_y') &&
        !lower.includes('1') &&
        !lower.includes('2'))
    ) {
      continue;
    }
    let projectionName = '';
    let coordType = '';
    if (lower.includes('_x') || lower.includes('_y')) {
      const parts = col.split('_');
      coordType = parts[parts.length - 1].toLowerCase();
      projectionName = parts.slice(0, -1).join('_');
    } else if (lower.includes('1') || lower.includes('2')) {
      if (lower.includes('1')) {
        coordType = 'x';
        projectionName = col.replace(/[_]?1/g, '');
      } else if (lower.includes('2')) {
        coordType = 'y';
        projectionName = col.replace(/[_]?2/g, '');
      }
    }
    if (projectionName && coordType) {
      const group = groups.get(projectionName) ?? {};
      if (coordType === 'x') group.x = col;
      if (coordType === 'y') group.y = col;
      groups.set(projectionName, group);
    }
  }

  for (const [name, group] of groups.entries()) {
    if (group.x && group.y) {
      pairs.push({
        name: formatProjectionName(name),
        xCol: group.x,
        yCol: group.y,
      });
    }
  }

  if (pairs.length === 0) {
    const xCol = findColumn(columnNames, ['x', 'umap_1', 'pc1', 'tsne_1']);
    const yCol = findColumn(columnNames, ['y', 'umap_2', 'pc2', 'tsne_2']);
    if (xCol && yCol) pairs.push({ name: inferProjectionName(xCol, yCol), xCol, yCol });
  }

  return pairs;
}

function formatProjectionName(name: string): string {
  return name;
}

function inferProjectionName(xCol: string, yCol: string): string {
  const lx = xCol.toLowerCase();
  const ly = yCol.toLowerCase();
  if (lx.includes('umap') || ly.includes('umap')) return 'UMAP';
  if (lx.includes('pca') || lx.includes('pc')) return 'PCA';
  if (lx.includes('tsne')) return 't-SNE';
  return 'Projection';
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

interface ExtractedAnnotations {
  annotations: Record<string, Annotation>;
  annotation_data: Record<string, AnnotationData>;
  numeric_annotation_data: Record<string, (number | null)[]>;
  annotation_scores: Record<string, (number[] | null)[][]>;
  annotation_evidence: Record<string, (string | null)[][]>;
}

/**
 * Unified annotation extractor — operates on a per-protein row lookup.
 *
 * Both the rows-based path (legacy `Rows` input with annotations spread into
 * each row) and the separated path (annotations keyed by protein id) reduce
 * to the same shape: a `(GenericRow | undefined)[]` indexed by protein. With
 * that lookup in hand, the per-column passes are identical.
 *
 * Caller is responsible for filtering ID columns out of `annotationColumns`.
 */
async function extractAnnotationsByProtein(
  rowByProteinIdx: ReadonlyArray<GenericRow | undefined>,
  annotationColumns: string[],
  formatVersion = 1,
): Promise<ExtractedAnnotations> {
  const annotations: Record<string, Annotation> = {};
  const annotation_data: Record<string, AnnotationData> = {};
  const numeric_annotation_data: Record<string, (number | null)[]> = {};
  const annotation_scores: Record<string, (number[] | null)[][]> = {};
  const annotation_evidence: Record<string, (string | null)[][]> = {};

  if (annotationColumns.length === 0) {
    return {
      annotations,
      annotation_data,
      numeric_annotation_data,
      annotation_scores,
      annotation_evidence,
    };
  }

  const numProteins = rowByProteinIdx.length;
  const chunkSize = 50000;

  // Yields raw cell values in protein order for a column — feeds inferAnnotationType.
  function* valuesForCol(col: string): Iterable<unknown> {
    for (const row of rowByProteinIdx) yield row?.[col];
  }

  // Process one column at a time so GC can reclaim between columns.
  for (let colIdx = 0; colIdx < annotationColumns.length; colIdx++) {
    const annotationCol = annotationColumns[colIdx];

    const inference = inferAnnotationType(valuesForCol(annotationCol));
    if (inference.inferredType !== 'string') {
      // Numeric column — inference.numericValues is already in protein order
      // because valuesForCol iterates per-protein.
      numeric_annotation_data[annotationCol] = inference.numericValues;
      annotations[annotationCol] = createNumericAnnotation(inference.inferredType);
      continue;
    }

    // === Pass 1: split + parse each DISTINCT cell value ONCE (memoized), then
    //     reuse the parse across every protein that shares it. The annotation
    //     columns are dictionary-encoded, so distinct cell values << protein
    //     count for most columns (e.g. kingdom: 22 distinct over 573K rows) —
    //     this turns the parse cost from O(proteins) into O(distinct cells).
    //     Output is byte-identical: frequency counting, arity, and score/evidence
    //     detection all stay PER-PROTEIN-OCCURRENCE below; only the split+parse
    //     is shared. Caches are block-scoped and reclaimed between columns.
    interface ParsedCell {
      // null ⇒ empty cell (no values). Otherwise the parsed labels in cell order.
      labels: string[] | null;
      // Sparse: non-null only when at least one value carried a score / evidence
      // code. When set, length === labels.length. SHARED by reference across
      // proteins with identical cells — safe because the result is read-only and
      // is deep-copied by structured-clone on worker transfer.
      scores: (number[] | null)[] | null;
      evidence: (string | null)[] | null;
    }
    const EMPTY_CELL: ParsedCell = { labels: null, scores: null, evidence: null };

    const valueCountMap = new Map<string, number>();
    let columnHasScores = false;
    let columnHasEvidence = false;
    let maxValuesPerProtein = 0;

    // Memoize split+parse keyed by the raw cell value (deterministic). parquet
    // decodes these columns as strings, so the key is the cell string itself;
    // distinct raw values are always parsed independently (never collapsed).
    const parseCache = new Map<unknown, ParsedCell>();
    const parseCell = (raw: unknown): ParsedCell => {
      const cached = parseCache.get(raw);
      if (cached !== undefined) return cached;
      const rawValues = splitCategoricalAnnotationValues(raw, formatVersion);
      const n = rawValues.length;
      if (n === 0) {
        parseCache.set(raw, EMPTY_CELL);
        return EMPTY_CELL;
      }
      const labels = new Array<string>(n);
      let scores: (number[] | null)[] | null = null;
      let evidence: (string | null)[] | null = null;
      for (let k = 0; k < n; k++) {
        const parsed = parseAnnotationValue(rawValues[k], formatVersion);
        labels[k] = parsed.label;
        if (parsed.scores.length > 0) {
          if (!scores) scores = new Array<number[] | null>(n).fill(null);
          scores[k] = parsed.scores;
        }
        if (parsed.evidence) {
          if (!evidence) evidence = new Array<string | null>(n).fill(null);
          evidence[k] = parsed.evidence;
        }
      }
      const cell: ParsedCell = { labels, scores, evidence };
      parseCache.set(raw, cell);
      return cell;
    };

    // Per-protein parse (cache hit for repeated cells). Counting + flags + arity
    // are accumulated PER PROTEIN so they match the non-memoized version exactly.
    const parsedByProtein = new Array<ParsedCell>(numProteins);

    for (let i = 0; i < numProteins; i += chunkSize) {
      const end = Math.min(i + chunkSize, numProteins);
      for (let p = i; p < end; p++) {
        const cell = parseCell(rowByProteinIdx[p]?.[annotationCol]);
        parsedByProtein[p] = cell;
        const labels = cell.labels;
        if (labels === null) continue;
        const n = labels.length;
        if (n > maxValuesPerProtein) maxValuesPerProtein = n;
        for (let k = 0; k < n; k++) {
          valueCountMap.set(labels[k], (valueCountMap.get(labels[k]) || 0) + 1);
        }
        if (cell.scores) columnHasScores = true;
        if (cell.evidence) columnHasEvidence = true;
      }
      await fastYield();
    }

    // Sort unique values by frequency (most frequent first).
    const uniqueValues = Array.from(valueCountMap.keys()).sort(
      (a, b) => (valueCountMap.get(b) || 0) - (valueCountMap.get(a) || 0),
    );

    const valueToIndex = new Map<string | null, number>();
    uniqueValues.forEach((val, idx) => valueToIndex.set(val, idx));

    const { colors, shapes } = generateColorsAndShapes('kellys', uniqueValues.length);

    // === Pass 2: map cached labels → dictionary indices. Use Int32Array for
    //     strict single-valued columns to avoid the per-protein number[] cliff. ===
    const useTypedStorage = maxValuesPerProtein <= 1 && !columnHasScores && !columnHasEvidence;

    const annotationDataTyped = useTypedStorage ? new Int32Array(numProteins).fill(-1) : null;
    const annotationDataArray = useTypedStorage ? null : new Array<number[]>(numProteins);
    const scoresArray = columnHasScores ? new Array<(number[] | null)[]>(numProteins) : null;
    const evidenceArray = columnHasEvidence ? new Array<(string | null)[]>(numProteins) : null;

    for (let i = 0; i < numProteins; i += chunkSize) {
      const end = Math.min(i + chunkSize, numProteins);
      for (let p = i; p < end; p++) {
        const cell = parsedByProtein[p];
        const labels = cell.labels;
        if (labels === null) continue;

        if (annotationDataTyped) {
          // Single-valued: write the one index directly into the typed array.
          annotationDataTyped[p] = valueToIndex.get(labels[0]) ?? -1;
        } else {
          // Fresh index array per protein (NOT shared) to match prior behavior.
          const indices = new Array<number>(labels.length);
          for (let k = 0; k < labels.length; k++) {
            indices[k] = valueToIndex.get(labels[k]) ?? -1;
          }
          annotationDataArray![p] = indices;
          if (scoresArray) {
            scoresArray[p] = cell.scores ?? new Array<number[] | null>(labels.length).fill(null);
          }
          if (evidenceArray) {
            evidenceArray[p] = cell.evidence ?? new Array<string | null>(labels.length).fill(null);
          }
        }
      }
      await fastYield();
    }

    // Fill empty slots for proteins absent from this column.
    if (annotationDataArray) {
      for (let p = 0; p < numProteins; p++) {
        if (annotationDataArray[p] === undefined) {
          annotationDataArray[p] = [];
          if (scoresArray) scoresArray[p] = [];
          if (evidenceArray) evidenceArray[p] = [];
        }
      }
    }

    if (annotationDataArray) {
      appendSyntheticNACategory(uniqueValues, colors, shapes, annotationDataArray);
    } else if (annotationDataTyped) {
      // Int32Array missing slots are already -1; append NA category and remap -1.
      const hasAnyMissing = annotationDataTyped.some((v) => v < 0);
      if (hasAnyMissing) {
        const naIndex = uniqueValues.length;
        uniqueValues.push(NA_VALUE);
        colors.push(NA_DEFAULT_COLOR);
        shapes.push('circle');
        for (let p = 0; p < annotationDataTyped.length; p++) {
          if (annotationDataTyped[p] < 0) {
            annotationDataTyped[p] = naIndex;
          }
        }
      }
    }

    annotations[annotationCol] = createCategoricalAnnotation(uniqueValues, colors, shapes);
    annotation_data[annotationCol] = (annotationDataTyped ?? annotationDataArray)!;
    if (scoresArray) annotation_scores[annotationCol] = scoresArray;
    if (evidenceArray) annotation_evidence[annotationCol] = evidenceArray;
  }

  return {
    annotations,
    annotation_data,
    numeric_annotation_data,
    annotation_scores,
    annotation_evidence,
  };
}

/**
 * Adapter for the legacy rows-based path: walks `rows` once to build a
 * per-protein row lookup, then delegates to the unified extractor.
 */
async function extractAnnotationsOptimized(
  rows: Rows,
  columnNames: string[],
  proteinIdCol: string,
  uniqueProteinIds: string[],
  formatVersion = 1,
): Promise<ExtractedAnnotations> {
  const allIdColumns = getIdColumnsSet(proteinIdCol);
  const annotationColumns = columnNames.filter((c) => !allIdColumns.has(c));

  const idToIndex = new Map<string, number>();
  for (let i = 0; i < uniqueProteinIds.length; i++) {
    idToIndex.set(uniqueProteinIds[i], i);
  }

  const rowByProteinIdx: (GenericRow | undefined)[] = new Array(uniqueProteinIds.length);
  for (let r = 0; r < rows.length; r++) {
    const row = rows[r];
    const proteinId = row[proteinIdCol] != null ? String(row[proteinIdCol]) : '';
    const idx = idToIndex.get(proteinId);
    if (idx !== undefined) rowByProteinIdx[idx] = row;
  }

  return extractAnnotationsByProtein(rowByProteinIdx, annotationColumns, formatVersion);
}

/**
 * Adapter for the separated extraction path: builds the per-protein lookup
 * by hitting `annotationsById.get(proteinId)` once per protein, then
 * delegates to the unified extractor.
 */
async function extractAnnotationsOptimizedSeparated(
  annotationsById: Map<string, GenericRow>,
  annotationColumnNames: string[],
  projectionIdCol: string,
  uniqueProteinIds: string[],
  formatVersion = 1,
): Promise<ExtractedAnnotations> {
  const allIdColumns = getIdColumnsSet(projectionIdCol);
  const annotationColumns = annotationColumnNames.filter((c) => !allIdColumns.has(c));

  if (annotationsById.size === 0) {
    return {
      annotations: {},
      annotation_data: {},
      numeric_annotation_data: {},
      annotation_scores: {},
      annotation_evidence: {},
    };
  }

  const rowByProteinIdx: (GenericRow | undefined)[] = new Array(uniqueProteinIds.length);
  for (let p = 0; p < uniqueProteinIds.length; p++) {
    rowByProteinIdx[p] = annotationsById.get(uniqueProteinIds[p]);
  }

  return extractAnnotationsByProtein(rowByProteinIdx, annotationColumns, formatVersion);
}
