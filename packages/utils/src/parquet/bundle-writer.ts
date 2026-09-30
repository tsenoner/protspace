/**
 * Bundle writer: a `.parquetbundle` in format v3, written from in-memory `VisualizationData`.
 *
 * The layout is specified in `docs/guide/data-format.md` and shared with the Python encoder
 * (`apps/protspace/src/protspace/data/io/bundle_v3.py`) and the browser reader
 * (`packages/core/src/components/data-loader/utils/bundle-v3.ts`):
 *
 * - Part 1: annotations. The identifier, then one INT32 code column per categorical
 *   annotation, one INT32 `<col>__count` column per multi-valued one and one DOUBLE column
 *   per numeric one. Its footer carries the format stamp and the manifest.
 * - Part 2: projections metadata (projection_name, dimensions, info_json)
 * - Part 3: projections. One FLOAT column per axis (`<name>__x`, ...), one row per protein,
 *   NaN where the projection does not place the protein.
 * - Part 4: settings, zero bytes when there are none
 * - Part 5: statistics, copied verbatim from the source bundle (see `createParquetBundle`),
 *   zero bytes when there are none
 * - Part 6: payloads. The label dictionaries and the CSR code / score / evidence buffers.
 *
 * All six slots are always written. Every column of parts 1, 3 and 6 is REQUIRED, PLAIN and
 * in a single row group, the only shape the reader decodes straight into typed arrays; it
 * rejects anything else.
 *
 * The in-memory storage is already columnar, so this is mostly a copy: labels are written
 * as the decoded strings the reader produced, never re-spelled in the v2 cell grammar.
 */

import { parquetWriteBuffer, type ColumnSource, type KeyValue } from 'hyparquet-writer';
import type {
  Annotation,
  AnnotationData,
  BundleSettings,
  CsrAnnotationData,
  VisualizationData,
} from '../types';
import { BUNDLE_DELIMITER_BYTES } from './constants';
import { assertNoBundleDelimiter } from './delimiter-utils';
import { bigIntReplacer } from './bigint-utils';
import { isNumericAnnotation } from '../visualization/numeric-binning.js';
import {
  getProteinAnnotationCount,
  getProteinAnnotationIndexAt,
  isCsrAnnotationData,
} from '../visualization/annotation-data-access.js';
import { remapCsr } from '../visualization/csr.js';
import { getProteinEvidence, getProteinScores } from '../visualization/plot-data-accessors.js';
import { getEatCompanionColumn, getPredictedCellValues } from '../visualization/eat-overlay.js';
import { isNAValue } from '../visualization/missing-values.js';

/**
 * Part 1's container-version key. The writer never sets `protspace_format_version`: that key
 * is the legacy cell-grammar version, and a v3 part 1 has no cells to parse. It encodes
 * already-decoded labels, so there is no grammar to declare or migrate here either.
 */
const CONTAINER_VERSION_KEY = 'protspace_container_version';
const CONTAINER_VERSION = '3';
const MANIFEST_KEY = 'protspace_v3_manifest';
/**
 * The names Python's encoder takes the id column from, in its order of preference
 * (`protein_id`, else `identifier`). The writer uses the default unless an annotation
 * occupies it: a Python bundle of a table holding both has `protein_id` as its id column
 * and `identifier` as an ordinary annotation.
 */
const ID_COLUMN = 'identifier';
const FALLBACK_ID_COLUMN = 'protein_id';
/** Payload name of the dictionary every column's evidence codes index into. */
const EVIDENCE_DICT_NAME = '__evidence';
const AXES = ['x', 'y', 'z'] as const;

const ENCODER = new TextEncoder();

/**
 * One manifest column. `sourceType` is Python-private and the browser ignores it: it is the
 * Arrow type `decode_v3` restores the column to (a numeric type, or `bool` for the `true` /
 * `false` labels), so a Python consumer keeps reading an integer column as integers, as it did
 * from the v2 writer's INT32/INT64 columns. The writer's default is `string`, or `int64` /
 * `double` for a numeric column; `echoSourceType` replaces it with the type a v3 load carried in.
 */
type ColumnEntry =
  | { kind: 'categorical'; sourceType: string }
  | { kind: 'multi'; sourceType: string; scores?: true; evidence?: true }
  | { kind: 'numeric'; numericType: 'int' | 'float'; sourceType: string };

/** Arrow's integer types, by the name `sourceType` records, with the range Python casts into. */
const ARROW_INTEGER_RANGES: Readonly<Record<string, readonly [bigint, bigint]>> = {
  int8: [-(2n ** 7n), 2n ** 7n - 1n],
  int16: [-(2n ** 15n), 2n ** 15n - 1n],
  int32: [-(2n ** 31n), 2n ** 31n - 1n],
  int64: [-(2n ** 63n), 2n ** 63n - 1n],
  uint8: [0n, 2n ** 8n - 1n],
  uint16: [0n, 2n ** 16n - 1n],
  uint32: [0n, 2n ** 32n - 1n],
  uint64: [0n, 2n ** 64n - 1n],
};
/**
 * The largest magnitude up to which every integer is exact as a float64. Python keeps an
 * integer column numeric up to it, inclusive (`_FLOAT64_EXACT_INT`), and stores one past it
 * as exact decimal labels.
 */
const FLOAT64_EXACT_INT = 2 ** 53;
/** A label as Python spells an integer: the canonical decimal `str(int)` gives. */
const DECIMAL_INTEGER_RE = /^-?(?:0|[1-9]\d*)$/;

/** Whether `value` is an integer a float64 holds exactly, so Python can cast it to an int. */
const isExactInteger = (value: number): boolean =>
  Number.isInteger(value) && Math.abs(value) <= FLOAT64_EXACT_INT;
/** Arrow type Python writes an EAT `__pred_confidence` column as (float32). */
const EAT_CONFIDENCE_SOURCE_TYPE = 'float';
const ARROW_FLOAT_TYPES: ReadonlySet<string> = new Set(['halffloat', 'float', 'double']);

/** Parts 1 and 6 under construction. */
interface AnnotationParts {
  columns: ColumnSource[];
  manifest: Record<string, ColumnEntry>;
  payloads: Map<string, Uint8Array>;
  /** The one evidence dictionary every column indexes into, in first-use order. */
  evidence: Map<string, number>;
}

/** Index of `key` in `map`, appended when absent. */
function intern(map: Map<string, number>, key: string): number {
  let index = map.get(key);
  if (index === undefined) {
    index = map.size;
    map.set(key, index);
  }
  return index;
}

const bytesOf = (array: Int32Array | Float64Array): Uint8Array =>
  new Uint8Array(array.buffer, array.byteOffset, array.byteLength);

/** Per-element counts of an offsets array: v3 stores counts, never offsets. */
function countsOf(offsets: Int32Array): Int32Array {
  const counts = new Int32Array(offsets.length - 1);
  for (let i = 0; i < counts.length; i++) counts[i] = offsets[i + 1] - offsets[i];
  return counts;
}

/** A part whose every column is REQUIRED and PLAIN, in one row group (see the module doc). */
function writePart(columns: ColumnSource[], kvMetadata?: KeyValue[]): ArrayBuffer {
  return parquetWriteBuffer({
    columnData: columns.map((column) => ({ ...column, nullable: false, encoding: 'PLAIN' })),
    statistics: false,
    rowGroupSize: Math.max(columns[0]?.data.length ?? 0, 1),
    kvMetadata,
  });
}

function addPayload(parts: AnnotationParts, name: string, bytes: Uint8Array): void {
  if (parts.payloads.has(name)) {
    throw new Error(`Payload name collision "${name}"; rename the annotation that produces it`);
  }
  parts.payloads.set(name, bytes);
}

function addColumn(
  parts: AnnotationParts,
  name: string,
  entry: ColumnEntry,
  data: Int32Array | Float64Array,
): void {
  const physical = entry.kind === 'multi' ? `${name}__count` : name;
  if (parts.columns.some((column) => column.name === physical)) {
    throw new Error(
      `Annotation "${name}" is stored as part 1 column "${physical}", which already exists; ` +
        'rename one of them',
    );
  }
  parts.columns.push({
    name: physical,
    data,
    type: data instanceof Int32Array ? 'INT32' : 'DOUBLE',
  });
  parts.manifest[name] = entry;
}

/** `dict:<name>` (the utf8 labels, concatenated) and `dict:<name>:len` (their byte lengths). */
function addDictionary(parts: AnnotationParts, name: string, labels: readonly string[]): void {
  const encoded = labels.map((label) => ENCODER.encode(label));
  const lengths = Int32Array.from(encoded, (bytes) => bytes.length);
  const blob = new Uint8Array(lengths.reduce((total, length) => total + length, 0));
  let at = 0;
  for (const bytes of encoded) {
    blob.set(bytes, at);
    at += bytes.length;
  }
  addPayload(parts, `dict:${name}`, blob);
  addPayload(parts, `dict:${name}:len`, bytesOf(lengths));
}

/**
 * The dictionary written for `labels`, given the code of every hit (`-1` for none): by
 * descending hit count, ties by first occurrence, so code 0 is the most frequent label
 * and the palette lands where the Python encoder puts it. Missing labels (`null` and the
 * in-memory `__NA__`) and labels no hit carries are left out; the reader appends its own
 * `__NA__` for the rows left empty.
 *
 * `remap` takes a code into `labels` to its code into `dictionary`, `-1` when dropped.
 */
function frequencyOrder(
  labels: readonly (string | null)[],
  hitCodes: Int32Array,
): { dictionary: string[]; remap: Int32Array } {
  const unified = new Map<string, number>();
  const toUnified = Int32Array.from(labels, (label) =>
    label == null || isNAValue(label) ? -1 : intern(unified, label),
  );
  const counts = new Int32Array(unified.size);
  const first = new Int32Array(unified.size);
  for (let hit = 0; hit < hitCodes.length; hit++) {
    const code = hitCodes[hit];
    const label = code < 0 ? -1 : toUnified[code];
    if (label >= 0 && counts[label]++ === 0) first[label] = hit;
  }

  const order = [...unified.values()]
    .filter((label) => counts[label] > 0)
    .sort((a, b) => counts[b] - counts[a] || first[a] - first[b]);
  const rank = new Int32Array(unified.size).fill(-1);
  order.forEach((label, code) => (rank[label] = code));
  const names = [...unified.keys()];
  return {
    dictionary: order.map((label) => names[label]),
    remap: toUnified.map((label) => (label < 0 ? -1 : rank[label])),
  };
}

/** A single-valued column whose `rowCodes` index `labels` (`-1` = missing). */
function addCodesColumn(
  parts: AnnotationParts,
  name: string,
  labels: readonly (string | null)[],
  rowCodes: Int32Array,
): void {
  const { dictionary, remap } = frequencyOrder(labels, rowCodes);
  addDictionary(parts, name, dictionary);
  addColumn(
    parts,
    name,
    { kind: 'categorical', sourceType: 'string' },
    rowCodes.map((code) => (code < 0 ? -1 : remap[code])),
  );
}

/**
 * A column of hits: `categorical` when no row holds more than one hit and no hit carries a
 * score or an evidence code, `multi` otherwise, which is the Python encoder's rule.
 */
function addHitsColumn(
  parts: AnnotationParts,
  name: string,
  labels: readonly (string | null)[],
  hits: CsrAnnotationData,
): void {
  const { dictionary, remap } = frequencyOrder(labels, hits.codes);
  const { column } = remapCsr(hits, remap);
  const { offsets, codes, scores, evidence } = column;
  addDictionary(parts, name, dictionary);

  const hasScores = scores !== undefined && scores.values.length > 0;
  const hasEvidence = evidence !== undefined && evidence.codes.some((code) => code >= 0);
  let multi = hasScores || hasEvidence;
  for (let row = 0; !multi && row < column.length; row++) {
    multi = offsets[row + 1] - offsets[row] > 1;
  }

  if (!multi) {
    const rowCodes = new Int32Array(column.length);
    for (let row = 0; row < column.length; row++) {
      rowCodes[row] = offsets[row] === offsets[row + 1] ? -1 : codes[offsets[row]];
    }
    addColumn(parts, name, { kind: 'categorical', sourceType: 'string' }, rowCodes);
    return;
  }

  addColumn(
    parts,
    name,
    {
      kind: 'multi',
      sourceType: 'string',
      ...(hasScores ? { scores: true } : {}),
      ...(hasEvidence ? { evidence: true } : {}),
    },
    countsOf(offsets),
  );
  addPayload(parts, `csr:${name}`, bytesOf(codes));
  if (hasScores) {
    addPayload(parts, `score_count:${name}`, bytesOf(countsOf(scores.offsets)));
    addPayload(parts, `scores:${name}`, bytesOf(scores.values));
  }
  if (hasEvidence) {
    const global = Int32Array.from(evidence.codes, (code) =>
      code < 0 ? -1 : intern(parts.evidence, evidence.dict[code]),
    );
    addPayload(parts, `evidence:${name}`, bytesOf(global));
  }
}

/** Receives one hit: its label code, score run and evidence code. */
type PushHit = (code: number, scores?: readonly number[] | null, evidence?: string | null) => void;

/** CSR storage from a visitor that pushes each row's hits in order. */
function buildCsr(rows: number, visitRow: (row: number, push: PushHit) => void): CsrAnnotationData {
  const offsets = new Int32Array(rows + 1);
  const codes: number[] = [];
  const scoreOffsets: number[] = [0];
  const scoreValues: number[] = [];
  const evidenceCodes: number[] = [];
  const evidenceDict = new Map<string, number>();
  const push: PushHit = (code, scores, evidence) => {
    codes.push(code);
    if (scores) scoreValues.push(...scores);
    scoreOffsets.push(scoreValues.length);
    evidenceCodes.push(evidence ? intern(evidenceDict, evidence) : -1);
  };
  for (let row = 0; row < rows; row++) {
    visitRow(row, push);
    offsets[row + 1] = codes.length;
  }
  return {
    kind: 'csr',
    offsets,
    codes: Int32Array.from(codes),
    length: rows,
    ...(scoreValues.length > 0
      ? {
          scores: {
            offsets: Int32Array.from(scoreOffsets),
            values: Float64Array.from(scoreValues),
          },
        }
      : {}),
    ...(evidenceDict.size > 0
      ? { evidence: { codes: Int32Array.from(evidenceCodes), dict: [...evidenceDict.keys()] } }
      : {}),
  };
}

/**
 * A categorical annotation, without the rows an EAT prediction fills: those are missing in
 * the curated column and travel in the companion columns instead.
 */
function addCategoricalAnnotation(
  parts: AnnotationParts,
  data: VisualizationData,
  name: string,
  storage: AnnotationData,
): void {
  const { values } = data.annotations[name];
  const predicted = data.annotation_predicted?.[name];
  const isPredicted = (row: number) => Boolean(predicted?.[row]);
  const anyPredicted = predicted?.some(Boolean) ?? false;
  const nestedHits = Boolean(data.annotation_scores?.[name] || data.annotation_evidence?.[name]);

  if (isCsrAnnotationData(storage) && !anyPredicted) {
    addHitsColumn(parts, name, values, storage);
    return;
  }

  // One code per row and nothing else per hit: the codes already are the part 1 column.
  if (storage instanceof Int32Array && !nestedHits) {
    addCodesColumn(
      parts,
      name,
      values,
      anyPredicted ? storage.map((code, row) => (isPredicted(row) ? -1 : code)) : storage,
    );
    return;
  }

  const perHit = nestedHits || isCsrAnnotationData(storage);
  addHitsColumn(
    parts,
    name,
    values,
    buildCsr(data.protein_ids.length, (row, push) => {
      if (isPredicted(row)) return;
      const scores = perHit ? getProteinScores(data, row, name) : [];
      const evidence = perHit ? getProteinEvidence(data, row, name) : [];
      const count = getProteinAnnotationCount(storage, row);
      for (let k = 0; k < count; k++) {
        push(getProteinAnnotationIndexAt(storage, row, k), scores[k], evidence[k]);
      }
    }),
  );
}

/** The `<col>__pred_value` / `__pred_confidence` / `__pred_source` trio of an EAT column. */
function addEatCompanions(parts: AnnotationParts, data: VisualizationData, name: string): void {
  const cells = data.annotation_predicted?.[name];
  if (!cells?.some(Boolean)) return;

  const labels = new Map<string, number>();
  const hits = buildCsr(cells.length, (row, push) => {
    const cell = cells[row];
    if (!cell) return;
    getPredictedCellValues(cell).forEach((label, k) =>
      push(intern(labels, label), cell.scores?.[k], cell.evidence?.[k]),
    );
  });
  addHitsColumn(parts, getEatCompanionColumn(name, 'value'), [...labels.keys()], hits);

  const confidence = getEatCompanionColumn(name, 'confidence');
  addNumericColumn(
    parts,
    confidence,
    Float64Array.from(cells, (cell) => cell?.confidence ?? NaN),
    'float',
  );
  // The reader folds the trio into `annotation_predicted`, so no carried sourceType
  // survives to echo. The trio's types are protspace's own schema instead: Python writes
  // the confidence as float32 (`predictions.add_overlay_columns`), the other two as
  // strings, which is what the value and source columns already declare.
  parts.manifest[confidence].sourceType = EAT_CONFIDENCE_SOURCE_TYPE;

  const sources = new Map<string, number>();
  const sourceCodes = Int32Array.from(cells, (cell) => (cell ? intern(sources, cell.source) : -1));
  addCodesColumn(parts, getEatCompanionColumn(name, 'source'), [...sources.keys()], sourceCodes);
}

function addNumericColumn(
  parts: AnnotationParts,
  name: string,
  values: Float64Array,
  numericType: 'int' | 'float',
): void {
  // Python casts to int64 safely, so an integer past 2^53 is restored as float64 there;
  // the manifest still calls the column int for the browser.
  const int =
    numericType === 'int' && values.every((value) => Number.isNaN(value) || isExactInteger(value));
  addColumn(
    parts,
    name,
    { kind: 'numeric', numericType, sourceType: int ? 'int64' : 'double' },
    values,
  );
}

/**
 * Whether the column `entry` describes still fits the `sourceType` a v3 load carried in, so
 * Python can restore that type from it. An integer type needs a numeric column whose values
 * it holds exactly, or a categorical column of decimal labels in its range (how Python stores
 * an integer column past ±2^53, and casts back); a float type needs a numeric column; `bool`
 * needs a categorical column of `true` / `false` labels. Any other type (`string`, a
 * timestamp, `?`) is one Python only ever renders as v2 text, which fits every column.
 */
function fitsSourceType(
  sourceType: string,
  entry: ColumnEntry,
  labels: readonly (string | null)[],
  numeric: Float64Array | undefined,
): boolean {
  const range = ARROW_INTEGER_RANGES[sourceType];
  if (range) {
    const [low, high] = range;
    const inRange = (value: bigint) => value >= low && value <= high;
    if (entry.kind === 'numeric') {
      return (
        numeric !== undefined &&
        numeric.every(
          (value) => Number.isNaN(value) || (isExactInteger(value) && inRange(BigInt(value))),
        )
      );
    }
    return (
      entry.kind === 'categorical' &&
      labels.every(
        (label) =>
          label == null ||
          isNAValue(label) ||
          (DECIMAL_INTEGER_RE.test(label) && inRange(BigInt(label))),
      )
    );
  }
  if (ARROW_FLOAT_TYPES.has(sourceType)) return entry.kind === 'numeric';
  if (sourceType === 'bool') {
    return (
      entry.kind === 'categorical' &&
      labels.every(
        (label) => label == null || isNAValue(label) || label === 'true' || label === 'false',
      )
    );
  }
  return true;
}

/**
 * Record the `sourceType` the annotation carried in from a v3 load, when the column as written
 * still fits it. That keeps a Python-written `bool` or `int32` column that type through a web
 * re-export; a column the app changed into something else keeps the writer's default.
 */
function echoSourceType(
  parts: AnnotationParts,
  name: string,
  annotation: Annotation,
  numeric?: Float64Array,
): void {
  const entry = parts.manifest[name];
  const carried = annotation.sourceType;
  if (
    entry &&
    carried !== undefined &&
    fitsSourceType(carried, entry, annotation.values, numeric)
  ) {
    entry.sourceType = carried;
  }
}

/**
 * The id column's name: {@link ID_COLUMN}, or {@link FALLBACK_ID_COLUMN} when an annotation
 * is named, or stored in a part 1 column named, `identifier`. The reader refuses an id column
 * that shares either with an annotation.
 */
function pickIdColumn(parts: AnnotationParts): string {
  const taken = new Set([...Object.keys(parts.manifest), ...parts.columns.map(({ name }) => name)]);
  for (const name of [ID_COLUMN, FALLBACK_ID_COLUMN]) if (!taken.has(name)) return name;
  throw new Error(
    `Annotations named "${ID_COLUMN}" and "${FALLBACK_ID_COLUMN}" leave no name for the ` +
      'protein id column; rename one of them',
  );
}

/** Parts 1 and 6: the annotations, with the manifest in part 1's footer, and the payloads. */
function createAnnotationParts(data: VisualizationData): [ArrayBuffer, ArrayBuffer] {
  const parts: AnnotationParts = {
    columns: [],
    manifest: {},
    payloads: new Map(),
    evidence: new Map(),
  };

  for (const [name, annotation] of Object.entries(data.annotations)) {
    // Runtime-only numeric view over the prediction side-channel.
    if (annotation.runtime?.role === 'eat-confidence') continue;

    if (isNumericAnnotation(annotation)) {
      const values = data.numeric_annotation_data?.[name];
      if (values) {
        addNumericColumn(parts, name, values, annotation.numericType ?? 'float');
        echoSourceType(parts, name, annotation, values);
      }
      continue;
    }

    const storage = data.annotation_data[name];
    if (!storage) continue;
    addCategoricalAnnotation(parts, data, name, storage);
    echoSourceType(parts, name, annotation);
    addEatCompanions(parts, data, name);
  }

  if (parts.evidence.size > 0) {
    addDictionary(parts, EVIDENCE_DICT_NAME, [...parts.evidence.keys()]);
  }

  const idColumn = pickIdColumn(parts);
  parts.columns.unshift({ name: idColumn, data: data.protein_ids, type: 'STRING' });
  const manifest = {
    idColumn,
    columns: parts.manifest,
    projections: data.projections.map(({ name, dimension }) => ({ name, dimension })),
  };
  return [
    writePart(parts.columns, [
      { key: CONTAINER_VERSION_KEY, value: CONTAINER_VERSION },
      { key: MANIFEST_KEY, value: JSON.stringify(manifest) },
    ]),
    writePart([
      { name: 'name', data: [...parts.payloads.keys()], type: 'STRING' },
      { name: 'data', data: [...parts.payloads.values()], type: 'BYTE_ARRAY' },
    ]),
  ];
}

/**
 * Create the projections metadata parquet buffer (Part 2).
 * Contains projection_name, dimensions, info_json columns.
 */
function createProjectionsMetadataParquet(data: VisualizationData): ArrayBuffer {
  return parquetWriteBuffer({
    columnData: [
      { name: 'projection_name', data: data.projections.map(({ name }) => name), type: 'STRING' },
      {
        name: 'dimensions',
        data: data.projections.map(({ dimension }) => dimension),
        type: 'INT32',
      },
      {
        name: 'info_json',
        data: data.projections.map(({ metadata }) =>
          JSON.stringify(metadata ?? {}, bigIntReplacer),
        ),
        type: 'STRING',
      },
    ],
  });
}

/**
 * Part 3: each projection's interleaved coordinates split into one column per axis. A
 * protein the projection does not place is NaN in memory, and is written as NaN.
 */
function createProjectionsParquet(data: VisualizationData): ArrayBuffer {
  const rows = data.protein_ids.length;
  const columns: ColumnSource[] = [];
  for (const { name, dimension, data: coordinates } of data.projections) {
    for (let axis = 0; axis < dimension; axis++) {
      const values = new Float32Array(rows);
      for (let row = 0; row < rows; row++) values[row] = coordinates[row * dimension + axis];
      columns.push({ name: `${name}__${AXES[axis]}`, data: values, type: 'FLOAT' });
    }
  }
  return writePart(columns);
}

/**
 * Create the settings parquet buffer (Part 4 - optional).
 * Contains a single settings_json column with one row.
 */
function createSettingsParquet(settings: BundleSettings): ArrayBuffer {
  return parquetWriteBuffer({
    columnData: [
      { name: 'settings_json', data: [JSON.stringify(settings, bigIntReplacer)], type: 'STRING' },
    ],
  });
}

function hasBundleSettings(settings: BundleSettings | undefined): settings is BundleSettings {
  if (!settings) {
    return false;
  }

  return (
    Object.keys(settings.legendSettings).length > 0 ||
    Object.keys(settings.exportOptions).length > 0 ||
    settings.publishState !== undefined ||
    settings.eatOverlayEnabled !== undefined ||
    settings.eatConfidenceThreshold !== undefined ||
    settings.shapeSize !== undefined
  );
}

/**
 * Concatenate multiple ArrayBuffers with delimiters. Exported as the single implementation
 * of the bundle's part-framing (zero-byte slots included) — tests glue fixtures with it
 * instead of re-implementing the protocol.
 */
export function concatenateBuffers(buffers: ArrayBuffer[], delimiter: Uint8Array): ArrayBuffer {
  // Calculate total size
  let totalSize = 0;
  for (let i = 0; i < buffers.length; i++) {
    totalSize += buffers[i].byteLength;
    if (i < buffers.length - 1) {
      totalSize += delimiter.length;
    }
  }

  // Create output buffer
  const result = new Uint8Array(totalSize);
  let offset = 0;

  for (let i = 0; i < buffers.length; i++) {
    result.set(new Uint8Array(buffers[i]), offset);
    offset += buffers[i].byteLength;

    if (i < buffers.length - 1) {
      result.set(delimiter, offset);
      offset += delimiter.length;
    }
  }

  return result.buffer;
}

export interface CreateBundleOptions {
  /** Include persisted settings in part 4, which is zero bytes otherwise. */
  includeSettings?: boolean;
  /** Persisted settings to include (required if includeSettings is true) */
  settings?: BundleSettings;
}

/**
 * Create a format v3 .parquetbundle ArrayBuffer from VisualizationData.
 *
 * Every part but the statistics is built from `data`; part 5 is copied verbatim. That
 * asymmetry is deliberate — the browser authored the annotations and projections, but not
 * the statistics, and it cannot faithfully rewrite them: hyparquet-writer infers a schema
 * from decoded JS values, which narrows INT64 to INT32, degrades an all-null column to
 * BYTE_ARRAY, and drops the `ARROW:schema` metadata pyarrow writes by default. Re-serializing
 * would also silently discard any column added by a newer `protspace stats` release.
 * Copying the bytes is the only way this stays lossless as the producer's schema grows.
 * A subset export has none to copy: `sliceVisualizationDataByIndices` drops them, because
 * whole-dataset scores attached to a slice would read as describing the slice.
 *
 * @param data - The visualization data to export
 * @param options - Options for bundle creation
 * @returns ArrayBuffer containing the parquetbundle
 */
export function createParquetBundle(
  data: VisualizationData,
  options: CreateBundleOptions = {},
): ArrayBuffer {
  const { includeSettings = false, settings } = options;

  const [annotations, payloads] = createAnnotationParts(data);
  const parts: [string, ArrayBuffer][] = [
    ['annotations', annotations],
    ['projections metadata', createProjectionsMetadataParquet(data)],
    ['projections data', createProjectionsParquet(data)],
    [
      'settings',
      includeSettings && hasBundleSettings(settings)
        ? createSettingsParquet(settings)
        : new ArrayBuffer(0),
    ],
    ['statistics', data.statistics ?? new ArrayBuffer(0)],
    ['payloads', payloads],
  ];

  // The delimiter is in-band and unescaped, so a part containing it would split
  // into two on read-back. The Python producer guards every part it writes; do
  // the same here or the invariant holds in only one direction. Annotation text
  // and legend category names are user-authored, so this is reachable.
  for (const [name, buffer] of parts) {
    assertNoBundleDelimiter(buffer, name);
  }

  return concatenateBuffers(
    parts.map(([, buffer]) => buffer),
    BUNDLE_DELIMITER_BYTES,
  );
}

/**
 * Export a .parquetbundle file by triggering a download.
 *
 * @param data - The visualization data to export
 * @param filename - The filename for the download (should end in .parquetbundle)
 * @param options - Options for bundle creation
 */
export function exportParquetBundle(
  data: VisualizationData,
  filename: string,
  options: CreateBundleOptions = {},
): void {
  const buffer = createParquetBundle(data, options);
  const blob = new Blob([buffer], { type: 'application/octet-stream' });
  const url = URL.createObjectURL(blob);

  const link = document.createElement('a');
  link.href = url;
  link.download = filename.endsWith('.parquetbundle') ? filename : `${filename}.parquetbundle`;
  link.click();

  URL.revokeObjectURL(url);
}

/**
 * Generate a filename for the exported bundle.
 *
 * @param includeSettings - Whether settings are included
 * @returns Generated filename
 */
export function generateBundleFilename(includeSettings: boolean = false): string {
  const date = new Date().toISOString().split('T')[0];
  const suffix = includeSettings ? '_with_settings' : '';
  return `protspace${suffix}_${date}.parquetbundle`;
}
