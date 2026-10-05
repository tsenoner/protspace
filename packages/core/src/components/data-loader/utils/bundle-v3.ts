/**
 * Reader for `.parquetbundle` format v3 — the columnar annotation encoding written by
 * `apps/protspace/src/protspace/data/io/bundle_v3.py`, which is the specification for
 * everything below.
 *
 * v1 and v2 stringify every annotation cell, so loading them means one JS object per
 * row plus a re-split and re-dictionary-coding of every string. v3 does that work at
 * write time: part 1 carries int32 dictionary codes (or per-row CSR hit counts) and
 * float64 numerics, part 3 carries wide float32 projections, and part 6 carries the
 * label dictionaries and CSR code/score/evidence payloads as raw little-endian buffers.
 * This reader therefore never parses a string that is not a label, and hands the worker
 * typed arrays it can transfer instead of structured-clone.
 *
 * Three wire details drive most of the code here:
 *
 *  - **Lengths are per-element counts, never cumulative offsets.** Offsets are
 *    near-incompressible; their first differences are not. Every `<col>__count`,
 *    `score_count:<col>` and `dict:<col>:len` family is prefix-summed here into the
 *    offsets the in-memory `CsrAnnotationData` / `CsrScores` types use.
 *  - **The dictionaries are faithful, not presentational.** The encoder stopped
 *    collapsing `none`/`NA`/`null` because doing so corrupted the Python side, so
 *    `dict:<col>` can carry those spellings as ordinary labels and this reader folds
 *    them into `__NA__` (see {@link missingLabels}), exactly where the v2 path
 *    has always applied that rule.
 *  - **Every part 1/3/6 column is REQUIRED and PLAIN**, which is the only shape
 *    hyparquet decodes straight into a typed array. A column that arrives as a plain
 *    array was written nullable or dictionary-encoded, which is a writer bug, so it is
 *    rejected (see {@link assertTypedChunk}) like any other schema mismatch.
 */

import {
  parquetMetadata,
  parquetRead,
  parquetReadObjects,
  type ColumnData,
  type FileMetaData,
} from 'hyparquet';
import {
  NA_DEFAULT_COLOR,
  NA_VALUE,
  normalizeMissingValue,
  type Annotation,
  type AnnotationData,
  type BundleSettings,
  type CsrAnnotationData,
  type CsrEvidence,
  type CsrScores,
  type Projection,
  rankByFrequency,
  remapCsr,
  V3_EVIDENCE_DICT_NAME,
  V3_MANIFEST_KEY,
  v3AxisColumn,
  v3Payload,
  v3PhysicalColumn,
  type VisualizationData,
} from '@protspace/utils';
import { assertValidParquetMagic } from './validation';
import { extractSettings, extractStatistics, type BundleParts } from './bundle-parts';
import { V3_COMPRESSORS, V3_PARSERS } from './fast-decoders';
import {
  appendSyntheticNACategoryToCodes,
  buildProjectionsMetadataMap,
  carryStatistics,
  createNumericAnnotation,
  dropUnplacedProteins,
  generateColorsAndShapes,
  normalizeEatCompanionColumns,
} from './conversion';
import type { Rows } from './types';

// ignoreBOM keeps a leading U+FEFF as a character: it is part of a label, not an
// encoding marker, and stripping it would silently rename the category.
const DECODER = new TextDecoder('utf-8', { ignoreBOM: true });

type V3ColumnKind = 'categorical' | 'multi' | 'numeric';

interface V3ColumnManifest {
  kind: V3ColumnKind;
  /** Only meaningful for `kind: 'numeric'`; defaults to float when absent. */
  numericType?: 'int' | 'float';
  /** Only meaningful for `kind: 'multi'`: a `scores:<col>` payload exists. */
  scores?: boolean;
  /** Only meaningful for `kind: 'multi'`: an `evidence:<col>` payload exists. */
  evidence?: boolean;
  /** Python's Arrow type for the column; carried onto the annotation, never interpreted here. */
  sourceType?: string;
  /**
   * Only for `categorical` / `multi`: the placed proteins' cells are all numbers or
   * missing, so the column is read as numbers once the unplaced proteins are dropped,
   * as v2 inferred it over the proteins it placed (see {@link placedNumericValues}).
   */
  placedNumeric?: boolean;
}

interface V3Manifest {
  idColumn: string;
  columns: Record<string, V3ColumnManifest>;
  projections: { name: string; dimension: 2 | 3 }[];
}

/** Leaf (data) columns of a parquet schema as `name -> physical type`; the root carries no type. */
function leafColumnTypes(metadata: FileMetaData): Map<string, string> {
  const types = new Map<string, string>();
  for (const field of metadata.schema) {
    if (field.name && field.type) types.set(field.name, field.type);
  }
  return types;
}

/** Physical parquet type the encoder writes for each kind, and the reader assumes. */
const PHYSICAL_TYPE: Record<V3ColumnKind, string> = {
  numeric: 'DOUBLE',
  categorical: 'INT32',
  multi: 'INT32',
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Parse and **validate** the v3 manifest against part 1's own schema.
 *
 * This is a trust boundary: the manifest is the only thing that says how the int32
 * columns below should be interpreted, and a wrong `kind` would silently turn a code
 * column into a numeric annotation (or index a dictionary that isn't there). Every
 * mismatch throws with the offending name rather than being repaired, so a broken
 * producer is reported instead of half-rendered.
 */
function readManifest(metadata: FileMetaData): V3Manifest {
  const raw = metadata.key_value_metadata?.find((entry) => entry.key === V3_MANIFEST_KEY)?.value;
  if (!raw) {
    throw new Error(`Bundle declares format v3 but carries no "${V3_MANIFEST_KEY}" metadata`);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error(`v3 manifest is not valid JSON: ${(error as Error).message}`);
  }
  if (!isRecord(parsed)) throw new Error('v3 manifest is not a JSON object');

  const schemaColumns = leafColumnTypes(metadata);

  const { idColumn, columns, projections } = parsed;
  if (typeof idColumn !== 'string' || !schemaColumns.has(idColumn)) {
    throw new Error(`v3 manifest idColumn "${String(idColumn)}" is not a column of part 1`);
  }
  // The ids are read as strings; an INT32 id column would hand back numbers that no
  // string lookup (search, selection, isolation) ever matches.
  const idType = schemaColumns.get(idColumn);
  if (idType !== 'BYTE_ARRAY') {
    throw new Error(
      `v3 manifest idColumn "${idColumn}" is stored as ${String(idType)}, not a string column`,
    );
  }
  if (!isRecord(columns)) throw new Error('v3 manifest has no "columns" object');
  if (!Array.isArray(projections)) throw new Error('v3 manifest has no "projections" array');

  const validated: Record<string, V3ColumnManifest> = {};
  // Physical part-1 column -> the manifest column reading it. Two readers of one
  // column would share one buffer, and the categorical pass rewrites its codes in
  // place under the other; the Python encoder never writes such a layout.
  const claimed = new Map<string, string>();
  for (const [name, entry] of Object.entries(columns)) {
    if (!isRecord(entry))
      throw new Error(`v3 manifest entry for column "${name}" is not an object`);
    const { kind, numericType } = entry;
    if (kind !== 'categorical' && kind !== 'multi' && kind !== 'numeric') {
      throw new Error(`v3 manifest column "${name}" has unknown kind "${String(kind)}"`);
    }
    if (numericType != null && numericType !== 'int' && numericType !== 'float') {
      throw new Error(
        `v3 manifest column "${name}" has unknown numericType "${String(numericType)}"`,
      );
    }
    if (name === idColumn) {
      throw new Error(`v3 manifest declares idColumn "${name}" as an annotation column too`);
    }
    const physical = v3PhysicalColumn(name, kind);
    const claimant = physical === idColumn ? `idColumn "${idColumn}"` : claimed.get(physical);
    if (claimant !== undefined) {
      throw new Error(
        `v3 manifest column "${name}" reads part 1's "${physical}", which ${claimant} already reads`,
      );
    }
    claimed.set(physical, `column "${name}"`);
    const physicalType = schemaColumns.get(physical);
    if (physicalType === undefined) {
      throw new Error(`v3 manifest declares column "${name}" but part 1 has no "${physical}"`);
    }
    // The kind is the ONLY thing that says how the stored numbers are read, so it is
    // checked against what they physically are: the encoder writes every numeric as
    // float64 and every dictionary code / hit count as int32. Without this, a manifest
    // calling a code column numeric turns dictionary codes into a colour gradient.
    if (physicalType !== PHYSICAL_TYPE[kind]) {
      throw new Error(
        `v3 manifest column "${name}" is kind "${kind}", but part 1 stores "${physical}" ` +
          `as ${physicalType}, not ${PHYSICAL_TYPE[kind]}`,
      );
    }
    validated[name] = {
      kind,
      ...(numericType != null ? { numericType } : {}),
      ...(entry.scores === true ? { scores: true } : {}),
      ...(entry.evidence === true ? { evidence: true } : {}),
      ...(entry.placedNumeric === true && kind !== 'numeric' ? { placedNumeric: true } : {}),
      // Opaque to the browser, so only its shape is checked: a non-string is dropped.
      ...(typeof entry.sourceType === 'string' ? { sourceType: entry.sourceType } : {}),
    };
  }

  const validatedProjections: V3Manifest['projections'] = [];
  const seen = new Set<string>();
  for (const entry of projections) {
    if (!isRecord(entry)) throw new Error('v3 manifest projection entry is not an object');
    const { name, dimension } = entry;
    if (typeof name !== 'string' || !name) {
      throw new Error(`v3 manifest projection has an invalid name "${String(name)}"`);
    }
    if (seen.has(name)) throw new Error(`v3 manifest declares projection "${name}" twice`);
    seen.add(name);
    if (dimension !== 2 && dimension !== 3) {
      throw new Error(
        `v3 projection "${name}" has dimension ${String(dimension)}, expected 2 or 3`,
      );
    }
    validatedProjections.push({ name, dimension });
  }

  return { idColumn, columns: validated, projections: validatedProjections };
}

/** `annotation` carrying the manifest's `sourceType`, for the bundle writer to echo back. */
function withSourceType(annotation: Annotation, column: V3ColumnManifest): Annotation {
  return column.sourceType === undefined
    ? annotation
    : { ...annotation, sourceType: column.sourceType };
}

type ColumnTarget = Int32Array | Float64Array | string[];

/**
 * Reject a part 1/3 chunk that did not decode to a typed array.
 *
 * Only a REQUIRED PLAIN column does, and the encoder writes nothing else, so a plain
 * array means a producer wrote the column nullable or dictionary-encoded. Its nulls
 * would have to be invented into codes or coordinates, which is the kind of repair
 * {@link readManifest} refuses too.
 */
function assertTypedChunk(
  columnName: string,
  columnData: ArrayLike<unknown>,
): asserts columnData is Int32Array | Float32Array | Float64Array {
  if (
    !(
      columnData instanceof Int32Array ||
      columnData instanceof Float32Array ||
      columnData instanceof Float64Array
    )
  ) {
    throw new Error(
      `v3 bundle column "${columnName}" did not decode to a typed array: every v3 column ` +
        'must be written REQUIRED and PLAIN, not nullable or dictionary-encoded',
    );
  }
}

/**
 * `parquetRead` over `columns`, failing the read when `onChunk` throws.
 *
 * hyparquet calls `onChunk` from a detached promise continuation, so a throw there would
 * surface as an unhandled rejection while the read itself resolved. The first one is
 * held and rethrown once the read has finished.
 */
async function readColumnChunks(
  file: ArrayBuffer,
  metadata: FileMetaData,
  columns: string[],
  onChunk: (chunk: ColumnData) => void,
): Promise<void> {
  let failure: unknown = null;
  await parquetRead({
    file,
    metadata,
    columns,
    compressors: V3_COMPRESSORS,
    parsers: V3_PARSERS,
    onChunk: (chunk) => {
      if (failure !== null) return;
      try {
        onChunk(chunk);
      } catch (error) {
        failure = error;
      }
    },
  });
  if (failure !== null) throw failure;
}

/** Copy one decoded chunk into its preallocated column at `rowStart`. */
function writeChunk(
  target: ColumnTarget,
  columnName: string,
  columnData: ArrayLike<unknown>,
  rowStart: number,
): void {
  if (Array.isArray(target)) {
    // The id column: a null would become a protein named '', so it is refused, as the
    // format (and Python's encoder) refuses it.
    for (let i = 0; i < columnData.length; i++) {
      const value = columnData[i];
      if (value == null) {
        throw new Error(`v3 id column "${columnName}" holds a null at row ${rowStart + i}`);
      }
      target[rowStart + i] = typeof value === 'string' ? value : String(value);
    }
    return;
  }
  assertTypedChunk(columnName, columnData);
  target.set(columnData, rowStart);
}

/**
 * Refuse a repeated protein id. Selection, isolation, search and export all key a protein
 * by its id, so two rows sharing one would act as one protein; the format forbids it and
 * Python's encoder never writes it.
 */
function assertUniqueIds(ids: readonly string[]): void {
  const repeated = findRepeatedId(ids);
  if (repeated !== null) {
    throw new Error(`v3 bundle protein id "${repeated}" appears more than once`);
  }
}

/** Probes per id, on average, after which {@link findRepeatedId} abandons its hash table. */
const MAX_PROBES_PER_ID = 8;

/**
 * The first id that repeats an earlier one (scanning in row order), or `null`.
 *
 * Strictly ascending ids cannot repeat, so a sorted file is cleared by one pass of
 * comparisons. Anything else goes through an open-addressing table of row indices, at
 * most half full and keyed by an FNV-1a hash of the id's UTF-16 code units: several times
 * faster than a `Set` of half a million freshly decoded strings. A slot match is
 * confirmed by comparing the strings, so a hash collision is never taken for a
 * duplicate. Ids that collide so often (a hostile file can choose them) that the probes
 * exceed `probesPerId` per id are checked with a `Set` instead, rather than left to
 * degrade towards quadratic time.
 */
export function findRepeatedId(
  ids: readonly string[],
  probesPerId = MAX_PROBES_PER_ID,
): string | null {
  let sorted = 1;
  while (sorted < ids.length && ids[sorted - 1] < ids[sorted]) sorted++;
  if (sorted >= ids.length) return null;

  let capacity = 1;
  while (capacity < ids.length * 2) capacity *= 2;
  const mask = capacity - 1;
  const table = new Int32Array(capacity); // row index + 1; 0 is an empty slot
  let probeBudget = ids.length * probesPerId;
  for (let row = 0; row < ids.length; row++) {
    const id = ids[row];
    let hash = 0x811c9dc5;
    for (let c = 0; c < id.length; c++) hash = Math.imul(hash ^ id.charCodeAt(c), 0x01000193);
    let slot = (hash ^ (hash >>> 15)) & mask;
    for (;;) {
      const entry = table[slot];
      if (entry === 0) {
        table[slot] = row + 1;
        break;
      }
      if (ids[entry - 1] === id) return id;
      if (--probeBudget < 0) return repeatedIdBySet(ids);
      slot = (slot + 1) & mask;
    }
  }
  return null;
}

/** The first id that repeats an earlier one, or `null`. */
function repeatedIdBySet(ids: readonly string[]): string | null {
  const seen = new Set<string>();
  for (const id of ids) {
    if (seen.has(id)) return id;
    seen.add(id);
  }
  return null;
}

/**
 * The most a part's preallocated arrays may outweigh the part itself. Every v3 column is
 * PLAIN and snappy compressed, and each array holds at most its column's uncompressed
 * PLAIN bytes (the id column's slots less), while snappy compresses by at most ~21x (a
 * 3-byte copy element covers 64 bytes).
 */
const MAX_PREALLOCATION_RATIO = 32;
/** What any part may preallocate, however small it is. */
const MIN_PREALLOCATION_BUDGET = 64 * 1024 * 1024;

/**
 * Check a part's footer row count before anything is allocated from it.
 *
 * `num_rows` is only a claim: hyparquet decodes whatever row groups there are, so a
 * footer claiming more rows than its row groups hold would leave the difference as
 * phantom proteins at the zeros a fresh typed array holds. And every column is
 * preallocated from it, so the bytes it implies (`bytesPerRow`, summed over the columns)
 * are capped against the part's own size: a few-KB footer claiming 2M rows of 499
 * float64 columns would otherwise have the reader allocate 8 GB before it reads a single
 * page.
 */
function assertFooterRows(
  metadata: FileMetaData,
  part: string,
  bytesPerRow: number,
  partBytes: number,
): void {
  const inRowGroups = metadata.row_groups.reduce((sum, group) => sum + BigInt(group.num_rows), 0n);
  if (inRowGroups !== BigInt(metadata.num_rows)) {
    throw new Error(
      `v3 ${part} footer declares ${String(metadata.num_rows)} rows but its row groups ` +
        `hold ${String(inRowGroups)}`,
    );
  }
  const bytes = Number(metadata.num_rows) * bytesPerRow;
  const budget = Math.max(MIN_PREALLOCATION_BUDGET, partBytes * MAX_PREALLOCATION_RATIO);
  if (bytes > budget) {
    throw new Error(
      `v3 ${part} declares ${String(metadata.num_rows)} rows, ${bytes} bytes to preallocate, ` +
        `more than a ${partBytes}-byte part can hold`,
    );
  }
}

/**
 * `readColumnChunks` that also refuses a column whose chunks do not fill each of its
 * `numRows` rows exactly once, whatever the footer said: an unfilled row would be read
 * as the zero (or `''`) it was preallocated with, and a row filled twice means another
 * row's value was written over it.
 *
 * A total alone is not enough. hyparquet reads a page whole, so row groups whose
 * footer sizes still add up to `num_rows` but split a page (5 + 3 rows declared 4 + 4)
 * hand back a first chunk that runs into the second group's rows and a second that
 * stops short of the end. The chunks' row spans are therefore checked to tile
 * `[0, numRows)`: a handful per column, one per page.
 */
async function readFullColumns(
  file: ArrayBuffer,
  metadata: FileMetaData,
  part: string,
  columns: string[],
  numRows: number,
  onChunk: (chunk: ColumnData) => void,
): Promise<void> {
  const spans = new Map<string, [number, number][]>(columns.map((column) => [column, []]));
  await readColumnChunks(file, metadata, columns, (chunk) => {
    const columnSpans = spans.get(chunk.columnName);
    if (columnSpans === undefined) return;
    const end = chunk.rowStart + chunk.columnData.length;
    if (chunk.rowStart < 0 || end > numRows) {
      throw new Error(
        `v3 ${part} column "${chunk.columnName}" has rows past the ${numRows} its footer declares`,
      );
    }
    columnSpans.push([chunk.rowStart, end]);
    onChunk(chunk);
  });
  for (const [column, columnSpans] of spans) {
    const rows = columnSpans.reduce((sum, [start, end]) => sum + end - start, 0);
    if (rows !== numRows) {
      throw new Error(
        `v3 ${part} column "${column}" holds ${rows} rows but its footer declares ${numRows}`,
      );
    }
    // With the total right, any gap comes with an overlap, which is what is reported.
    columnSpans.sort((a, b) => a[0] - b[0]);
    let next = 0;
    for (const [start, end] of columnSpans) {
      if (start < next) {
        throw new Error(`v3 ${part} column "${column}" decodes row ${start} twice`);
      }
      next = end;
    }
  }
}

/** Preallocate one array per declared column and fill it chunk by chunk. */
async function readAnnotationColumns(
  part: ArrayBuffer,
  metadata: FileMetaData,
  manifest: V3Manifest,
  numRows: number,
): Promise<Map<string, ColumnTarget>> {
  const columns = Object.values(manifest.columns);
  assertFooterRows(
    metadata,
    'part 1',
    // An id slot, then a Float64Array or an Int32Array per column.
    8 + columns.reduce((sum, { kind }) => sum + (kind === 'numeric' ? 8 : 4), 0),
    part.byteLength,
  );
  const targets = new Map<string, ColumnTarget>();
  targets.set(manifest.idColumn, new Array<string>(numRows).fill(''));
  for (const [name, column] of Object.entries(manifest.columns)) {
    targets.set(
      v3PhysicalColumn(name, column.kind),
      column.kind === 'numeric' ? new Float64Array(numRows) : new Int32Array(numRows),
    );
  }

  await readFullColumns(part, metadata, 'part 1', [...targets.keys()], numRows, (chunk) => {
    const target = targets.get(chunk.columnName)!;
    writeChunk(target, chunk.columnName, chunk.columnData, chunk.rowStart);
  });

  return targets;
}

/**
 * Read part 3 into one flat `Float32Array(N * dimension)` per projection.
 *
 * The wire is one column per axis (`<name>__x`, `__y`, `__z`), so the interleave into
 * the renderer's stride-major layout happens right in the chunk callback: no
 * per-projection intermediate and no second pass. A protein absent from a projection
 * has NaN coordinates, as the encoder wrote them: the scatter plot does not draw it.
 */
async function readProjections(
  part: ArrayBuffer,
  manifest: V3Manifest,
  numRows: number,
  metadataMap: ReadonlyMap<string, Record<string, unknown>>,
): Promise<Projection[]> {
  const metadata = parquetMetadata(part);
  const schemaColumns = leafColumnTypes(metadata);
  // Part 3 is aligned row for row with part 1. A short part would leave the unread
  // proteins at the zero a fresh Float32Array holds, i.e. drawn at (0,0), and a long
  // one would drop its extra rows, so any disagreement is refused, as Python does.
  const part3Rows = Number(metadata.num_rows);
  if (part3Rows !== numRows) {
    throw new Error(
      `v3 part 3 holds ${String(metadata.num_rows)} rows but part 1 holds ${numRows}`,
    );
  }
  const axes = manifest.projections.reduce((sum, { dimension }) => sum + dimension, 0);
  assertFooterRows(metadata, 'part 3', 4 * axes, part.byteLength);

  const axisTargets = new Map<string, { data: Float32Array; dimension: number; axis: number }>();
  const projections: Projection[] = [];

  for (const { name, dimension } of manifest.projections) {
    const data = new Float32Array(numRows * dimension);
    for (let axis = 0; axis < dimension; axis++) {
      const column = v3AxisColumn(name, axis);
      if (!schemaColumns.has(column)) {
        throw new Error(
          `v3 projection "${name}" declares ${dimension}D but part 3 has no ${column}`,
        );
      }
      axisTargets.set(column, { data, dimension, axis });
    }
    projections.push({
      name,
      data,
      dimension,
      metadata: { ...(metadataMap.get(name) ?? {}), dimension },
    });
  }

  if (axisTargets.size > 0) {
    await readFullColumns(
      part,
      metadata,
      'part 3',
      [...axisTargets.keys()],
      numRows,
      ({ columnName, columnData, rowStart }) => {
        const target = axisTargets.get(columnName)!;
        assertTypedChunk(columnName, columnData);
        const { data, dimension, axis } = target;
        for (let i = 0; i < columnData.length; i++) {
          data[(rowStart + i) * dimension + axis] = columnData[i];
        }
      },
    );
  }

  return projections;
}

/** Part 6 as `name -> raw little-endian bytes`. */
async function readPayloads(part: ArrayBuffer): Promise<Map<string, Uint8Array>> {
  assertValidParquetMagic(part);
  // utf8: false keeps the `data` column as raw bytes. The `name` column carries a
  // STRING logical type, which hyparquet decodes regardless of this flag.
  const rows = await parquetReadObjects({ file: part, utf8: false, compressors: V3_COMPRESSORS });
  const payloads = new Map<string, Uint8Array>();
  for (const row of rows) {
    const name = typeof row.name === 'string' ? row.name : DECODER.decode(row.name as Uint8Array);
    // Last-win would silently pick one of two disagreeing payloads; the encoder already
    // rejects the collision, so reaching here means a producer bug.
    if (payloads.has(name)) throw new Error(`v3 payloads part declares "${name}" twice`);
    payloads.set(name, row.data as Uint8Array);
  }
  return payloads;
}

/**
 * A payload as an aligned typed array.
 *
 * hyparquet hands back a `Uint8Array` **view into the page buffer**, at an arbitrary
 * byte offset — so it is copied rather than wrapped. Wrapping would both risk an
 * alignment error and pin (or, if transferred, detach) the whole decoded page.
 */
function asTypedPayload<T extends Int32Array | Float64Array>(
  payloads: ReadonlyMap<string, Uint8Array>,
  name: string,
  ctor: { new (buffer: ArrayBuffer): T; readonly BYTES_PER_ELEMENT: number },
): T {
  const bytes = payloads.get(name);
  if (!bytes) throw new Error(`v3 bundle is missing the "${name}" payload`);
  const width = ctor.BYTES_PER_ELEMENT;
  if (bytes.byteLength % width !== 0) {
    throw new Error(
      `v3 payload "${name}" is ${bytes.byteLength} bytes, not a multiple of ${width}`,
    );
  }
  return new ctor(bytes.slice().buffer);
}

/**
 * Labels of one dictionary payload, in code order.
 *
 * The blob is the utf8 concatenation and `:len` holds each label's **byte** length.
 * Decoding the blob once and slicing it is only valid while character offsets equal
 * byte offsets, i.e. while the blob is pure ASCII — which covers most columns; the
 * moment it is not, each label is decoded from its own byte range instead.
 */
function readLabels(payloads: ReadonlyMap<string, Uint8Array>, name: string): string[] {
  const lengths = asTypedPayload(payloads, v3Payload.dictionaryLengths(name), Int32Array);
  const bytes = payloads.get(v3Payload.dictionary(name));
  if (!bytes) throw new Error(`v3 bundle is missing the "dict:${name}" payload`);

  const labels = new Array<string>(lengths.length);
  const text = DECODER.decode(bytes);
  const ascii = text.length === bytes.byteLength;
  let at = 0;
  for (let i = 0; i < lengths.length; i++) {
    const length = lengths[i];
    if (length < 0 || at + length > bytes.byteLength) {
      throw new Error(`v3 dictionary "${name}" declares a label past the end of its blob`);
    }
    labels[i] = ascii
      ? text.slice(at, at + length)
      : DECODER.decode(bytes.subarray(at, at + length));
    at += length;
  }
  if (at !== bytes.byteLength) {
    throw new Error(
      `v3 dictionary "${name}" label lengths cover ${at} of ${bytes.byteLength} blob bytes`,
    );
  }
  return labels;
}

/**
 * Drop the dictionary entries that spell a missing value, exactly as v2 ingestion does.
 *
 * The encoder stopped collapsing `none`/`NA`/`null` (it corrupted the Python side —
 * 1383 rows of `phosphatase.predicted_transmembrane` are literally the word `none`), so
 * v3 is a faithful container and the presentation rule belongs here, which is where the
 * v2 path has always applied it: `splitCategoricalAnnotationValues` filters these
 * spellings out of a cell before anything counts frequencies, so a row left with nothing
 * falls through to the same synthetic `__NA__` v2 gives it. That is also why folding
 * cannot produce a second NA slot: `__na__` is itself a missing-value token, so
 * `NA_VALUE` never survives this pass and the append below is the only NA there is.
 *
 * v2 tests the whole hit, suffix included, so a scored or evidenced hit spelled that way
 * (`none|0.5`, `NA|IEA`) was never missing there: it kept its label, score and evidence.
 * `keep` marks those labels (see {@link splitQualifiedMissingHits}), which are then not
 * dropped.
 *
 * Returns the codes to drop, or `null` when there are none.
 */
function missingLabels(labels: readonly string[], keep: Uint8Array | null): Uint8Array | null {
  let drop: Uint8Array | null = null;
  for (let code = 0; code < labels.length; code++) {
    if (keep?.[code] || normalizeMissingValue(labels[code]) !== null) continue;
    (drop ??= new Uint8Array(labels.length))[code] = 1;
  }
  return drop;
}

/**
 * Compact `labels` without the `drop` codes, in place. The survivors keep their relative
 * order, so the encoder's descending-frequency dictionary order — and with it the palette
 * assignment — is unchanged; the colours are generated from the post-fold length.
 *
 * Returns the old-code -> new-code map (`-1` for a dropped entry), or `null` when nothing
 * is dropped.
 */
function compactLabels(labels: string[], drop: Uint8Array | null): Int32Array | null {
  if (!drop) return null;
  const remap = new Int32Array(labels.length);
  let kept = 0;
  for (let code = 0; code < labels.length; code++) {
    remap[code] = drop[code] ? -1 : kept;
    if (!drop[code]) labels[kept++] = labels[code];
  }
  labels.length = kept;
  return remap;
}

/**
 * Give the unscored, unevidenced hits of a missing-value label their own code, so the
 * label can stay for its scored or evidenced hits while those fold into N/A, as in v2.
 *
 * v3 stores the bare label of `none|0.5` in the same dictionary entry as a plain `none`,
 * but v2 kept the first (its whole-hit test saw `none|0.5`) and folded the second. Each
 * such label with both kinds of hit gets an alias entry appended to `labels`, and its
 * plain hits are recoded to it; {@link missingLabels} then drops the alias and keeps the
 * label. `__NA__` is never kept: it is the one N/A slot.
 *
 * Returns the labels to keep (indexed by code, aliases included), or `null` when no
 * missing-value label carries a score or an evidence code.
 */
function splitQualifiedMissingHits(csr: CsrAnnotationData, labels: string[]): Uint8Array | null {
  const { offsets, codes, length, scores, evidence } = csr;
  if (!scores && !evidence) return null;
  const qualified = (hit: number) =>
    (scores !== undefined && scores.offsets[hit + 1] > scores.offsets[hit]) ||
    (evidence !== undefined && evidence.codes[hit] >= 0);
  const missing = labels.map(
    (label) =>
      normalizeMissingValue(label) === null && label.toLowerCase() !== NA_VALUE.toLowerCase(),
  );

  const kept = new Uint8Array(labels.length);
  let any = false;
  for (let hit = offsets[0]; hit < offsets[length]; hit++) {
    if (missing[codes[hit]] && qualified(hit)) {
      kept[codes[hit]] = 1;
      any = true;
    }
  }
  if (!any) return null;

  const alias = new Int32Array(labels.length).fill(-1);
  for (let hit = offsets[0]; hit < offsets[length]; hit++) {
    const code = codes[hit];
    if (!kept[code] || qualified(hit)) continue;
    if (alias[code] < 0) {
      alias[code] = labels.length;
      labels.push(labels[code]);
    }
    codes[hit] = alias[code];
  }
  const keep = new Uint8Array(labels.length);
  keep.set(kept);
  return keep;
}

/** Largest offset an Int32Array holds; a larger running sum would wrap. */
const INT32_MAX = 2 ** 31 - 1;

/**
 * Per-element counts to CSR offsets: one entry longer, starting at 0.
 *
 * The running sum is kept in a JS number and refused once it leaves the int32 range,
 * before it is stored: an Int32Array store wraps modulo 2^32, so counts summing past
 * 2^31 could come back round to the payload length, pass the caller's total check and
 * hand `remapCsr` non-monotonic offsets to loop over ~2^31 times.
 */
function prefixSum(counts: Int32Array, what: string): Int32Array {
  const offsets = new Int32Array(counts.length + 1);
  let running = 0;
  for (let i = 0; i < counts.length; i++) {
    const count = counts[i];
    if (count < 0) throw new Error(`v3 ${what} has a negative count (${count}) at index ${i}`);
    running += count;
    if (running > INT32_MAX) {
      throw new Error(`v3 ${what} sum past the int32 offset range at index ${i}`);
    }
    offsets[i + 1] = running;
  }
  return offsets;
}

/** Assemble one multi-valued column's CSR storage, scores and evidence included. */
function readCsrColumn(
  name: string,
  column: V3ColumnManifest,
  counts: Int32Array,
  labelCount: number,
  payloads: ReadonlyMap<string, Uint8Array>,
  evidenceDict: () => readonly string[],
): CsrAnnotationData {
  const codes = asTypedPayload(payloads, v3Payload.codes(name), Int32Array);
  const offsets = prefixSum(counts, `column "${name}" hit counts`);
  const total = offsets[counts.length];
  if (total !== codes.length) {
    throw new Error(
      `v3 column "${name}" hit counts sum to ${total} but csr:${name} holds ${codes.length} codes`,
    );
  }
  for (let hit = 0; hit < codes.length; hit++) {
    if (codes[hit] < 0 || codes[hit] >= labelCount) {
      throw new Error(
        `v3 column "${name}" hit ${hit} has code ${codes[hit]}, outside its ${labelCount} labels`,
      );
    }
  }

  let scores: CsrScores | undefined;
  if (column.scores) {
    const scoreCounts = asTypedPayload(payloads, v3Payload.scoreCounts(name), Int32Array);
    if (scoreCounts.length !== codes.length) {
      throw new Error(
        `v3 column "${name}" has ${scoreCounts.length} score counts for ${codes.length} hits`,
      );
    }
    const values = asTypedPayload(payloads, v3Payload.scores(name), Float64Array);
    const scoreOffsets = prefixSum(scoreCounts, `column "${name}" score counts`);
    const scoreTotal = scoreOffsets[scoreCounts.length];
    if (scoreTotal !== values.length) {
      throw new Error(
        `v3 column "${name}" score counts sum to ${scoreTotal} but scores:${name} holds ${values.length}`,
      );
    }
    scores = { offsets: scoreOffsets, values };
  }

  let evidence: CsrEvidence | undefined;
  if (column.evidence) {
    const evidenceCodes = asTypedPayload(payloads, v3Payload.evidence(name), Int32Array);
    if (evidenceCodes.length !== codes.length) {
      throw new Error(
        `v3 column "${name}" has ${evidenceCodes.length} evidence codes for ${codes.length} hits`,
      );
    }
    const dict = evidenceDict();
    for (let hit = 0; hit < evidenceCodes.length; hit++) {
      // -1 is "no evidence", which the reader itself writes for an inserted NA hit.
      if (evidenceCodes[hit] < -1 || evidenceCodes[hit] >= dict.length) {
        throw new Error(
          `v3 column "${name}" hit ${hit} has evidence code ${evidenceCodes[hit]}, ` +
            `outside the ${dict.length} evidence labels`,
        );
      }
    }
    evidence = { codes: evidenceCodes, dict };
  }

  return {
    kind: 'csr',
    offsets,
    codes,
    length: counts.length,
    ...(scores ? { scores } : {}),
    ...(evidence ? { evidence } : {}),
  };
}

/**
 * Re-rank `labels` over the hits `storage` holds, as the encoder ranks a dictionary: by
 * descending hit count, ties by first occurrence, labels no hit carries and `drop` codes
 * left out. Used once unplaced proteins are dropped, so the dictionary is the one a file
 * holding only the placed proteins would carry, and once hits have been moved off a label
 * ({@link splitQualifiedMissingHits}), whose count then changed. `labels` is rewritten in
 * place; the result maps an old code to its new one, `-1` for a dropped label.
 */
function rankByHits(
  storage: Int32Array | CsrAnnotationData,
  labels: string[],
  drop: Uint8Array | null,
): Int32Array {
  const hits =
    storage instanceof Int32Array
      ? storage
      : storage.codes.subarray(storage.offsets[0], storage.offsets[storage.length]);
  const { order, remap } = rankByFrequency(hits, labels.length, drop);
  const ranked = order.map((code) => labels[code]);
  // Copied back rather than spliced in: a spread of a large dictionary overflows the stack.
  labels.length = ranked.length;
  for (let code = 0; code < ranked.length; code++) labels[code] = ranked[code];
  return remap;
}

/**
 * Renumber a CSR column onto its folded dictionary and route every row left with no hit
 * to a synthetic `__NA__` category, in one {@link remapCsr} pass: a folded hit is dropped
 * together with its score run and evidence code, and an inserted NA hit gets neither.
 *
 * A row whose only values were missing-value spellings thereby lands where v2 puts such
 * a cell, and a row that never had a value gets the NA `appendSyntheticNACategory` gives
 * the nested storage shape. CSR needs the rebuild because an empty row owns no hit slot
 * to write the category into.
 */
function foldCsrColumn(
  csr: CsrAnnotationData,
  remap: Int32Array | null,
  labels: string[],
  colors: string[],
  shapes: string[],
): CsrAnnotationData {
  const { column, filledRows } = remapCsr(csr, remap, labels.length);
  if (filledRows > 0) {
    labels.push(NA_VALUE);
    colors.push(NA_DEFAULT_COLOR);
    shapes.push('circle');
  }
  return column;
}

/**
 * A `placedNumeric` column's numbers over the proteins left after the unplaced drop,
 * read as v2's `inferAnnotationType` read the same cells: a missing cell or
 * missing-value spelling is NaN, and the type is `int` when every value is integral.
 *
 * The encoder keeps such a column as labels because an annotation-only protein holds a
 * label that is not a number (`unknown` among lengths), and it must decode back in
 * Python. A row with more than one hit, a scored or evidenced hit, or a label that is
 * not a finite number is not what the mark promises; the column then stays categorical,
 * as it is stored, and so does one with no number at all. Returns `null` for those.
 */
function placedNumericValues(
  storage: Int32Array | CsrAnnotationData,
  labels: readonly string[],
): { values: Float64Array; numericType: 'int' | 'float' } | null {
  const parsed = labels.map((label) =>
    normalizeMissingValue(label) === null ? NaN : Number(label.trim()),
  );
  const csr = storage instanceof Int32Array ? null : storage;
  const length = csr ? csr.length : storage.length;
  const values = new Float64Array(length).fill(NaN);
  let sawValue = false;
  let integral = true;
  for (let row = 0; row < length; row++) {
    let code: number;
    if (csr) {
      const start = csr.offsets[row];
      const hits = csr.offsets[row + 1] - start;
      if (hits > 1) return null;
      if (hits === 1) {
        const scored = csr.scores && csr.scores.offsets[start + 1] > csr.scores.offsets[start];
        if (scored || (csr.evidence && csr.evidence.codes[start] >= 0)) return null;
      }
      code = hits === 1 ? csr.codes[start] : -1;
    } else {
      code = (storage as Int32Array)[row];
    }
    if (code < 0 || normalizeMissingValue(labels[code]) === null) continue;
    const value = parsed[code];
    if (!Number.isFinite(value)) return null;
    values[row] = value;
    sawValue = true;
    if (!Number.isInteger(value)) integral = false;
  }
  return sawValue ? { values, numericType: integral ? 'int' : 'float' } : null;
}

/**
 * Read a format v3 bundle into `VisualizationData`.
 *
 * `parts` comes from `splitBundleParts`, which has already checked the three core parts;
 * `metadata` is part 1's already-parsed footer.
 */
export async function readV3Bundle(
  parts: BundleParts,
  metadata: FileMetaData,
): Promise<{
  data: VisualizationData;
  settings: BundleSettings | null;
  unplacedProteinCount: number;
}> {
  const [, part2, , part4, part5] = parts;
  // The three large parts are released as soon as they are decoded.
  let part1: ArrayBuffer | null = parts[0];
  let part3: ArrayBuffer | null = parts[2];
  let part6 = parts[5] ?? null;
  // Take ownership so each large part can be released once decoded, rather than
  // pinned by the caller's array until the whole read returns.
  parts.fill(null);
  if (!part6) {
    throw new Error('Bundle declares format v3 but carries no payloads part (part 6)');
  }

  const manifest = readManifest(metadata);
  // Everything below preallocates on this footer field before a single row is read.
  // There is no point cap: `assertFooterRows` bounds what each part may preallocate by
  // the part's own size, so here the field only has to be a row count.
  const numRows = Number(metadata.num_rows);
  if (!Number.isSafeInteger(numRows) || numRows < 0) {
    throw new Error(`v3 bundle declares ${String(metadata.num_rows)} rows, not a row count`);
  }

  const columns = await readAnnotationColumns(part1, metadata, manifest, numRows);
  part1 = null;
  const protein_ids = columns.get(manifest.idColumn) as string[];
  assertUniqueIds(protein_ids);

  const projectionsMetadata = (await parquetReadObjects({ file: part2 })) as Rows;
  const projections = await readProjections(
    part3,
    manifest,
    numRows,
    buildProjectionsMetadataMap(projectionsMetadata),
  );
  part3 = null;

  const payloads = await readPayloads(part6);
  part6 = null;
  let evidenceDict: readonly string[] | null = null;
  const readEvidenceDict = (): readonly string[] =>
    (evidenceDict ??= readLabels(payloads, V3_EVIDENCE_DICT_NAME));

  const annotations: Record<string, Annotation> = {};
  const annotation_data: Record<string, AnnotationData> = {};
  const numeric_annotation_data: Record<string, Float64Array> = {};
  /** Categorical columns, read as written; their dictionaries are finished below. */
  const dictionaries: { name: string; column: V3ColumnManifest; labels: string[] }[] = [];

  for (const [name, column] of Object.entries(manifest.columns)) {
    const stored = columns.get(v3PhysicalColumn(name, column.kind))!;

    if (column.kind === 'numeric') {
      // Kept as decoded, so the worker can transfer it. NaN is already the in-memory
      // missing value; an infinity is folded into it, as it was never a real value.
      const values = stored as Float64Array;
      for (let i = 0; i < numRows; i++) if (!Number.isFinite(values[i])) values[i] = NaN;
      numeric_annotation_data[name] = values;
      annotations[name] = withSourceType(
        createNumericAnnotation(column.numericType ?? 'float'),
        column,
      );
      continue;
    }

    // Codes on the wire index the dictionary AS WRITTEN, so they are range-checked
    // against that count before anything renumbers them.
    const labels = readLabels(payloads, name);
    if (column.kind === 'categorical') {
      const codes = stored as Int32Array;
      for (let i = 0; i < numRows; i++) {
        if (codes[i] >= labels.length || codes[i] < -1) {
          throw new Error(
            `v3 column "${name}" row ${i} has code ${codes[i]}, outside its ${labels.length} labels`,
          );
        }
      }
      annotation_data[name] = codes;
    } else {
      annotation_data[name] = readCsrColumn(
        name,
        column,
        stored as Int32Array,
        labels.length,
        payloads,
        readEvidenceDict,
      );
    }
    dictionaries.push({ name, column, labels });
  }

  // The protein set is fixed before any dictionary is finished: the encoder ranked its
  // labels over every row of part 1, and a protein no projection places must not leave
  // a label, a frequency rank, a palette slot or an N/A entry behind (v2 never saw it).
  const data = dropUnplacedProteins({
    protein_ids,
    projections,
    annotations,
    annotation_data,
    numeric_annotation_data,
    annotation_scores: {},
    annotation_evidence: {},
  });
  const rowsDropped = data.protein_ids.length !== numRows;

  for (const { name, column, labels } of dictionaries) {
    const storage = data.annotation_data[name] as Int32Array | CsrAnnotationData;
    const numeric = column.placedNumeric ? placedNumericValues(storage, labels) : null;
    if (numeric) {
      delete data.annotation_data[name];
      (data.numeric_annotation_data ??= {})[name] = numeric.values;
      annotations[name] = withSourceType(createNumericAnnotation(numeric.numericType), column);
      continue;
    }
    const keep = storage instanceof Int32Array ? null : splitQualifiedMissingHits(storage, labels);
    const drop = missingLabels(labels, keep);
    const remap =
      rowsDropped || keep ? rankByHits(storage, labels, drop) : compactLabels(labels, drop);
    const { colors, shapes } = generateColorsAndShapes('kellys', labels.length);

    if (storage instanceof Int32Array) {
      if (remap) {
        for (let i = 0; i < storage.length; i++) {
          if (storage[i] >= 0) storage[i] = remap[storage[i]];
        }
      }
      appendSyntheticNACategoryToCodes(labels, colors, shapes, storage);
    } else {
      data.annotation_data[name] = foldCsrColumn(storage, remap, labels, colors, shapes);
    }

    annotations[name] = withSourceType(
      { kind: 'categorical', values: labels, colors, shapes },
      column,
    );
  }
  // In the manifest's column order, which the numeric columns' head start above broke.
  data.annotations = Object.fromEntries(
    Object.keys(manifest.columns).map((name) => [name, annotations[name]]),
  );

  // Deliberately NOT restoreDeclaredNumericAnnotations: it reads physical parquet types,
  // which in v3 would declare every int32 dictionary-code column numeric. The manifest
  // is the authority on kind here, and it has already been applied above.
  return {
    data: carryStatistics(normalizeEatCompanionColumns(data), {
      statistics: part5,
      statisticsRows: part5 ? await extractStatistics(part5) : null,
    }),
    settings: part4 ? await extractSettings(part4) : null,
    // Part 1 rows the protein set left out: the file keeps them, an export from here does not.
    unplacedProteinCount: numRows - data.protein_ids.length,
  };
}
