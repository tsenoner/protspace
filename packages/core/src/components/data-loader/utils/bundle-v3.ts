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
 *    them into `__NA__` (see {@link foldMissingLabels}), exactly where the v2 path
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
  remapCsr,
  type VisualizationData,
} from '@protspace/utils';
import { assertValidParquetMagic, DEFAULT_VALIDATION_LIMITS } from './validation';
import { extractSettings, extractStatistics, type BundleParts } from './bundle-parts';
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

/** Key-value metadata key part 1 carries the v3 manifest under. */
const MANIFEST_KEY = 'protspace_v3_manifest';

/** Payload name of the dictionary every column's evidence codes index into. */
const EVIDENCE_DICT_NAME = '__evidence';

const AXES = ['x', 'y', 'z'] as const;

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
}

interface V3Manifest {
  idColumn: string;
  columns: Record<string, V3ColumnManifest>;
  projections: { name: string; dimension: 2 | 3 }[];
}

/** Physical part-1 column backing a manifest column: multi stores per-row hit counts. */
function physicalColumn(name: string, kind: V3ColumnKind): string {
  return kind === 'multi' ? `${name}__count` : name;
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
  const raw = metadata.key_value_metadata?.find((entry) => entry.key === MANIFEST_KEY)?.value;
  if (!raw) {
    throw new Error(`Bundle declares format v3 but carries no "${MANIFEST_KEY}" metadata`);
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
    const physical = physicalColumn(name, kind);
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
    for (let i = 0; i < columnData.length; i++) {
      const value = columnData[i];
      target[rowStart + i] = typeof value === 'string' ? value : String(value ?? '');
    }
    return;
  }
  assertTypedChunk(columnName, columnData);
  target.set(columnData, rowStart);
}

/** Preallocate one array per declared column and fill it chunk by chunk. */
async function readAnnotationColumns(
  part: ArrayBuffer,
  metadata: FileMetaData,
  manifest: V3Manifest,
  numRows: number,
): Promise<Map<string, ColumnTarget>> {
  const targets = new Map<string, ColumnTarget>();
  targets.set(manifest.idColumn, new Array<string>(numRows).fill(''));
  for (const [name, column] of Object.entries(manifest.columns)) {
    targets.set(
      physicalColumn(name, column.kind),
      column.kind === 'numeric' ? new Float64Array(numRows) : new Int32Array(numRows),
    );
  }

  await readColumnChunks(part, metadata, [...targets.keys()], (chunk) => {
    const target = targets.get(chunk.columnName);
    if (target) writeChunk(target, chunk.columnName, chunk.columnData, chunk.rowStart);
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

  const axisTargets = new Map<string, { data: Float32Array; dimension: number; axis: number }>();
  const projections: Projection[] = [];

  for (const { name, dimension } of manifest.projections) {
    const data = new Float32Array(numRows * dimension);
    for (let axis = 0; axis < dimension; axis++) {
      const column = `${name}__${AXES[axis]}`;
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
    await readColumnChunks(
      part,
      metadata,
      [...axisTargets.keys()],
      ({ columnName, columnData, rowStart }) => {
        const target = axisTargets.get(columnName);
        if (!target) return;
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
  const rows = await parquetReadObjects({ file: part, utf8: false });
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
  const lengths = asTypedPayload(payloads, `dict:${name}:len`, Int32Array);
  const bytes = payloads.get(`dict:${name}`);
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
 * Compaction preserves the survivors' relative order, so the encoder's
 * descending-frequency dictionary order — and with it the palette assignment — is
 * unchanged; the colours are generated from the post-fold length.
 *
 * Returns the old-code -> new-code map (`-1` for a dropped entry), or `null` when the
 * dictionary is already clean. `labels` is compacted in place.
 */
function foldMissingLabels(labels: string[]): Int32Array | null {
  const remap = new Int32Array(labels.length);
  let kept = 0;
  for (let i = 0; i < labels.length; i++) {
    const drop = normalizeMissingValue(labels[i]) === null;
    remap[i] = drop ? -1 : kept;
    if (!drop) labels[kept++] = labels[i];
  }
  if (kept === labels.length) return null;
  labels.length = kept;
  return remap;
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
  const codes = asTypedPayload(payloads, `csr:${name}`, Int32Array);
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
    const scoreCounts = asTypedPayload(payloads, `score_count:${name}`, Int32Array);
    if (scoreCounts.length !== codes.length) {
      throw new Error(
        `v3 column "${name}" has ${scoreCounts.length} score counts for ${codes.length} hits`,
      );
    }
    const values = asTypedPayload(payloads, `scores:${name}`, Float64Array);
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
    const evidenceCodes = asTypedPayload(payloads, `evidence:${name}`, Int32Array);
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
 * descending hit count, ties by first occurrence, labels no hit carries left out. Used
 * once unplaced proteins are dropped, so the dictionary is the one a file holding only
 * the placed proteins would carry. `labels` is rewritten in place; the result maps an old
 * code to its new one, `-1` for a dropped label.
 */
function rankByHits(storage: Int32Array | CsrAnnotationData, labels: string[]): Int32Array {
  const counts = new Int32Array(labels.length);
  const first = new Int32Array(labels.length);
  let hit = 0;
  const count = (code: number) => {
    if (code >= 0 && counts[code]++ === 0) first[code] = hit;
    hit++;
  };
  if (storage instanceof Int32Array) {
    storage.forEach(count);
  } else {
    const { offsets, codes, length } = storage;
    for (let i = offsets[0]; i < offsets[length]; i++) count(codes[i]);
  }

  const order = labels
    .map((_, code) => code)
    .filter((code) => counts[code] > 0)
    .sort((a, b) => counts[b] - counts[a] || first[a] - first[b]);
  const remap = new Int32Array(labels.length).fill(-1);
  const ranked = order.map((code, rank) => {
    remap[code] = rank;
    return labels[code];
  });
  // Copied back rather than spliced in: a spread of a large dictionary overflows the stack.
  labels.length = ranked.length;
  for (let code = 0; code < ranked.length; code++) labels[code] = ranked[code];
  return remap;
}

/** `second` applied after `first` (either may be `null`, the identity). */
function composeRemaps(first: Int32Array | null, second: Int32Array | null): Int32Array | null {
  if (!first || !second) return first ?? second;
  return first.map((code) => (code < 0 ? -1 : second[code]));
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
 * Read a format v3 bundle into `VisualizationData`.
 *
 * `parts` comes from `splitBundleParts`, which has already checked the three core parts;
 * `metadata` is part 1's already-parsed footer.
 */
export async function readV3Bundle(
  parts: BundleParts,
  metadata: FileMetaData,
): Promise<{ data: VisualizationData; settings: BundleSettings | null }> {
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
  // Everything below preallocates on this footer field before a single row is read, so
  // it is bounded here. The v3 path never reaches `validateRowsBasic`, which is what
  // caps the legacy path.
  const numRows = Number(metadata.num_rows);
  if (
    !Number.isSafeInteger(numRows) ||
    numRows < 0 ||
    numRows > DEFAULT_VALIDATION_LIMITS.maxRows
  ) {
    throw new Error(
      `v3 bundle declares ${String(metadata.num_rows)} rows, outside 0..${DEFAULT_VALIDATION_LIMITS.maxRows}`,
    );
  }

  const columns = await readAnnotationColumns(part1, metadata, manifest, numRows);
  part1 = null;
  const protein_ids = columns.get(manifest.idColumn) as string[];

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
    (evidenceDict ??= readLabels(payloads, EVIDENCE_DICT_NAME));

  const annotations: Record<string, Annotation> = {};
  const annotation_data: Record<string, AnnotationData> = {};
  const numeric_annotation_data: Record<string, Float64Array> = {};
  /** Categorical columns, read as written; their dictionaries are finished below. */
  const dictionaries: { name: string; column: V3ColumnManifest; labels: string[] }[] = [];

  for (const [name, column] of Object.entries(manifest.columns)) {
    const stored = columns.get(physicalColumn(name, column.kind))!;

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
    const rerank = rowsDropped ? rankByHits(storage, labels) : null;
    const remap = composeRemaps(rerank, foldMissingLabels(labels));
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
  };
}
