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
 *    cumulative offsets the in-memory `CsrAnnotationData` / `CsrScores` types use.
 *  - **The dictionaries are faithful, not presentational.** The encoder stopped
 *    collapsing `none`/`NA`/`null` because doing so corrupted the Python side, so
 *    `dict:<col>` can carry those spellings as ordinary labels and this reader folds
 *    them into `__NA__` (see {@link foldMissingLabels}), exactly where the v2 path
 *    has always applied that rule.
 *  - **Every part 1/3/6 column is REQUIRED and PLAIN**, which is the only shape
 *    hyparquet decodes straight into a typed array. A column that arrives as a plain
 *    array still reads correctly (see the fallback in {@link writeChunk}) but about 4x
 *    slower, and is a bug on the writer side, so it is logged.
 */

import { parquetMetadata, parquetRead, parquetReadObjects, type FileMetaData } from 'hyparquet';
import {
  NA_DEFAULT_COLOR,
  NA_VALUE,
  normalizeMissingValue,
  type Annotation,
  type AnnotationData,
  type BundleSettings,
  type CsrEvidence,
  type CsrScores,
  type Projection,
  type VisualizationData,
} from '@protspace/utils';
import { assertValidParquetMagic, DEFAULT_VALIDATION_LIMITS } from './validation';
import { extractSettings, extractStatistics } from './bundle';
import {
  appendSyntheticNACategoryToCodes,
  buildProjectionsMetadataMap,
  carryStatistics,
  createNumericAnnotation,
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
  if (!isRecord(columns)) throw new Error('v3 manifest has no "columns" object');
  if (!Array.isArray(projections)) throw new Error('v3 manifest has no "projections" array');

  const validated: Record<string, V3ColumnManifest> = {};
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

type ColumnTarget = Int32Array | Float64Array | string[];

/**
 * Copy one decoded chunk into its preallocated column at `rowStart`.
 *
 * The fast path is the whole point of v3: a REQUIRED PLAIN column arrives as a typed
 * array and lands with a single `set`. Anything else — a column the producer wrote
 * nullable or dictionary-encoded — still decodes correctly through the element loop,
 * which is why `onPlainArray` reports rather than throws.
 */
function writeChunk(
  target: ColumnTarget,
  columnName: string,
  columnData: ArrayLike<unknown>,
  rowStart: number,
  onPlainArray: (columnName: string) => void,
): void {
  if (Array.isArray(target)) {
    for (let i = 0; i < columnData.length; i++) {
      const value = columnData[i];
      target[rowStart + i] = typeof value === 'string' ? value : String(value ?? '');
    }
    return;
  }

  if (
    columnData instanceof Int32Array ||
    columnData instanceof Float64Array ||
    columnData instanceof Float32Array
  ) {
    target.set(columnData, rowStart);
    return;
  }

  onPlainArray(columnName);
  const missing = target instanceof Int32Array ? -1 : NaN;
  for (let i = 0; i < columnData.length; i++) {
    const value = columnData[i];
    target[rowStart + i] = value == null ? missing : Number(value);
  }
}

/**
 * One-shot reporter for a column that did not arrive as a typed array.
 *
 * Per read rather than per column: a producer that got this wrong got it wrong for the
 * whole part, and one line in the console is the point.
 */
function plainArrayReporter(): (columnName: string) => void {
  let warned = false;
  return (columnName: string) => {
    if (warned) return;
    warned = true;
    console.warn(
      `v3 bundle column "${columnName}" did not decode to a typed array — it was probably ` +
        'written nullable or dictionary-encoded. The bundle still loads, about 4x slower; ' +
        'fix the writer (every v3 column must be REQUIRED and PLAIN).',
    );
  };
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

  const onPlainArray = plainArrayReporter();

  await parquetRead({
    file: part,
    metadata,
    columns: [...targets.keys()],
    onChunk: ({ columnName, columnData, rowStart }) => {
      const target = targets.get(columnName);
      if (target) writeChunk(target, columnName, columnData, rowStart, onPlainArray);
    },
  });

  return targets;
}

/**
 * Read part 3 into one flat `Float32Array(N * dimension)` per projection.
 *
 * The wire is one column per axis (`<name>__x`, `__y`, `__z`), so the interleave into
 * the renderer's stride-major layout happens right in the chunk callback: no
 * per-projection intermediate and no second pass. A protein absent from a projection
 * keeps the zero the allocation gave it, which is what v2 produced too.
 */
async function readProjections(
  part: ArrayBuffer,
  manifest: V3Manifest,
  numRows: number,
  metadataMap: ReadonlyMap<string, Record<string, unknown>>,
): Promise<Projection[]> {
  assertValidParquetMagic(part);
  const metadata = parquetMetadata(part);
  const schemaColumns = leafColumnTypes(metadata);

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
    const onPlainArray = plainArrayReporter();
    await parquetRead({
      file: part,
      metadata,
      columns: [...axisTargets.keys()],
      onChunk: ({ columnName, columnData, rowStart }) => {
        const target = axisTargets.get(columnName);
        if (!target) return;
        // A nullable axis column coerces its nulls to 0 below, which is exactly the
        // origin an absent protein legitimately sits at — so it has to be reported.
        if (Array.isArray(columnData)) onPlainArray(columnName);
        const { data, dimension, axis } = target;
        for (let i = 0; i < columnData.length; i++) {
          data[(rowStart + i) * dimension + axis] = columnData[i] as number;
        }
      },
    });
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

/** Per-element counts to the cumulative offsets the in-memory CSR types use. */
function prefixSum(counts: Int32Array, what: string): Int32Array {
  const end = new Int32Array(counts.length);
  let running = 0;
  for (let i = 0; i < counts.length; i++) {
    const count = counts[i];
    if (count < 0) throw new Error(`v3 ${what} has a negative count (${count}) at index ${i}`);
    running += count;
    end[i] = running;
  }
  return end;
}

/**
 * Score values are read as **float64**, matching what the encoder writes.
 *
 * float32 destroys the E-value, which is the canonical Pfam and InterPro score: 1e-200
 * flushes to 0 and 1e40 saturates to Infinity. `CsrScores.values` in `@protspace/utils`
 * is still declared `Float32Array` and has to be widened to accept this.
 */
interface V3Scores {
  hitEnd: Int32Array;
  values: Float64Array;
}

interface CsrColumn {
  end: Int32Array;
  codes: Int32Array;
  scores: V3Scores | null;
  evidence: CsrEvidence | null;
}

/** Assemble one multi-valued column's CSR storage plus its score/evidence payloads. */
function readCsrColumn(
  name: string,
  column: V3ColumnManifest,
  counts: Int32Array,
  labelCount: number,
  payloads: ReadonlyMap<string, Uint8Array>,
  evidenceDict: () => readonly string[],
): CsrColumn {
  const codes = asTypedPayload(payloads, `csr:${name}`, Int32Array);
  const end = prefixSum(counts, `column "${name}" hit counts`);
  const total = counts.length > 0 ? end[counts.length - 1] : 0;
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

  let scores: V3Scores | null = null;
  if (column.scores) {
    const scoreCounts = asTypedPayload(payloads, `score_count:${name}`, Int32Array);
    if (scoreCounts.length !== codes.length) {
      throw new Error(
        `v3 column "${name}" has ${scoreCounts.length} score counts for ${codes.length} hits`,
      );
    }
    const values = asTypedPayload(payloads, `scores:${name}`, Float64Array);
    const hitEnd = prefixSum(scoreCounts, `column "${name}" score counts`);
    const scoreTotal = hitEnd.length > 0 ? hitEnd[hitEnd.length - 1] : 0;
    if (scoreTotal !== values.length) {
      throw new Error(
        `v3 column "${name}" score counts sum to ${scoreTotal} but scores:${name} holds ${values.length}`,
      );
    }
    scores = { hitEnd, values };
  }

  let evidence: CsrEvidence | null = null;
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

  return { end, codes, scores, evidence };
}

/**
 * Renumber a CSR column onto a folded dictionary, dropping the hits whose label went
 * with it — along with that hit's score run and evidence code, both of which are
 * numbered by hit. A row left with nothing is picked up by {@link insertNAForEmptyRows}
 * below, which is what v2 does with a cell whose only value was a missing-value
 * spelling.
 */
function dropFoldedHits(csr: CsrColumn, remap: Int32Array | null): CsrColumn {
  if (!remap) return csr;

  const numRows = csr.end.length;
  const scores = csr.scores;
  let keptHits = 0;
  let keptScores = 0;
  for (let hit = 0; hit < csr.codes.length; hit++) {
    if (remap[csr.codes[hit]] < 0) continue;
    keptHits++;
    if (scores) keptScores += scores.hitEnd[hit] - (hit === 0 ? 0 : scores.hitEnd[hit - 1]);
  }

  const codes = new Int32Array(keptHits);
  const end = new Int32Array(numRows);
  const evidenceCodes = csr.evidence ? new Int32Array(keptHits) : null;
  const hitEnd = scores ? new Int32Array(keptHits) : null;
  const values = scores ? new Float64Array(keptScores) : null;

  let write = 0;
  let scoreWrite = 0;
  for (let row = 0; row < numRows; row++) {
    for (let hit = row === 0 ? 0 : csr.end[row - 1]; hit < csr.end[row]; hit++) {
      const code = remap[csr.codes[hit]];
      if (code < 0) continue;
      codes[write] = code;
      if (evidenceCodes) evidenceCodes[write] = csr.evidence!.codes[hit];
      if (hitEnd) {
        for (let at = hit === 0 ? 0 : scores!.hitEnd[hit - 1]; at < scores!.hitEnd[hit]; at++) {
          values![scoreWrite++] = scores!.values[at];
        }
        hitEnd[write] = scoreWrite;
      }
      write++;
    }
    end[row] = write;
  }

  return {
    end,
    codes,
    scores: scores ? { hitEnd: hitEnd!, values: values! } : null,
    evidence: csr.evidence ? { codes: evidenceCodes!, dict: csr.evidence.dict } : null,
  };
}

/**
 * Route rows with no hits at all to a synthetic `__NA__` category, the way
 * `appendSyntheticNACategory` does for the nested storage shape.
 *
 * CSR needs a rebuild rather than an in-place patch: an empty row owns no hit slot to
 * write the category into. One lockstep pass therefore inserts a hit per empty row,
 * carrying `-1` into evidence and a repeated running total into `hitEnd` — the inserted
 * hit contributes no score, so every original hit keeps the exact cumulative it had.
 */
function insertNAForEmptyRows(
  csr: CsrColumn,
  labels: string[],
  colors: string[],
  shapes: string[],
): CsrColumn {
  const numRows = csr.end.length;
  let empty = 0;
  for (let i = 0; i < numRows; i++) {
    if ((i === 0 ? 0 : csr.end[i - 1]) === csr.end[i]) empty++;
  }
  if (empty === 0) return csr;

  const naIndex = labels.length;
  labels.push(NA_VALUE);
  colors.push(NA_DEFAULT_COLOR);
  shapes.push('circle');

  const total = csr.codes.length + empty;
  const codes = new Int32Array(total);
  const end = new Int32Array(numRows);
  const evidenceCodes = csr.evidence ? new Int32Array(total) : null;
  const hitEnd = csr.scores ? new Int32Array(total) : null;

  let write = 0;
  for (let i = 0; i < numRows; i++) {
    const from = i === 0 ? 0 : csr.end[i - 1];
    const to = csr.end[i];
    if (from === to) {
      codes[write] = naIndex;
      if (evidenceCodes) evidenceCodes[write] = -1;
      if (hitEnd) hitEnd[write] = from === 0 ? 0 : csr.scores!.hitEnd[from - 1];
      write++;
    } else {
      for (let hit = from; hit < to; hit++) {
        codes[write] = csr.codes[hit];
        if (evidenceCodes) evidenceCodes[write] = csr.evidence!.codes[hit];
        if (hitEnd) hitEnd[write] = csr.scores!.hitEnd[hit];
        write++;
      }
    }
    end[i] = write;
  }

  return {
    end,
    codes,
    scores: csr.scores ? { hitEnd: hitEnd!, values: csr.scores.values } : null,
    evidence: csr.evidence ? { codes: evidenceCodes!, dict: csr.evidence.dict } : null,
  };
}

/**
 * Read a format v3 bundle into `VisualizationData`.
 *
 * `parts` comes from `splitBundleParts`; `metadata` is part 1's already-parsed footer.
 */
export async function readV3Bundle(
  parts: readonly (ArrayBuffer | null)[],
  metadata: FileMetaData,
): Promise<{ data: VisualizationData; settings: BundleSettings | null }> {
  const [part1, part2, part3, part4, part5, part6] = parts;
  if (!part1 || !part2 || !part3) {
    throw new Error('Parquetbundle is missing one of its three required core parts');
  }
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
  const protein_ids = columns.get(manifest.idColumn) as string[];

  assertValidParquetMagic(part2);
  const projectionsMetadata = (await parquetReadObjects({ file: part2 })) as Rows;
  const projections = await readProjections(
    part3,
    manifest,
    numRows,
    buildProjectionsMetadataMap(projectionsMetadata),
  );

  const payloads = await readPayloads(part6);
  let evidenceDict: readonly string[] | null = null;
  const readEvidenceDict = (): readonly string[] =>
    (evidenceDict ??= readLabels(payloads, EVIDENCE_DICT_NAME));

  const annotations: Record<string, Annotation> = {};
  const annotation_data: Record<string, AnnotationData> = {};
  const numeric_annotation_data: Record<string, (number | null)[]> = {};
  const annotation_scores_csr: Record<string, CsrScores> = {};
  const annotation_evidence_csr: Record<string, CsrEvidence> = {};

  for (const [name, column] of Object.entries(manifest.columns)) {
    const stored = columns.get(physicalColumn(name, column.kind))!;

    if (column.kind === 'numeric') {
      const raw = stored as Float64Array;
      const values = new Array<number | null>(numRows);
      for (let i = 0; i < numRows; i++) values[i] = Number.isFinite(raw[i]) ? raw[i] : null;
      numeric_annotation_data[name] = values;
      annotations[name] = createNumericAnnotation(column.numericType ?? 'float');
      continue;
    }

    const labels = readLabels(payloads, name);
    // Codes on the wire index the dictionary AS WRITTEN, so they are range-checked
    // against that count and only then renumbered onto the folded one.
    const encodedLabelCount = labels.length;
    const remap = foldMissingLabels(labels);
    const { colors, shapes } = generateColorsAndShapes('kellys', labels.length);

    if (column.kind === 'categorical') {
      const codes = stored as Int32Array;
      for (let i = 0; i < numRows; i++) {
        if (codes[i] >= encodedLabelCount || codes[i] < -1) {
          throw new Error(
            `v3 column "${name}" row ${i} has code ${codes[i]}, outside its ${encodedLabelCount} labels`,
          );
        }
        if (remap && codes[i] >= 0) codes[i] = remap[codes[i]];
      }
      appendSyntheticNACategoryToCodes(labels, colors, shapes, codes);
      annotation_data[name] = codes;
    } else {
      const csr = insertNAForEmptyRows(
        dropFoldedHits(
          readCsrColumn(
            name,
            column,
            stored as Int32Array,
            encodedLabelCount,
            payloads,
            readEvidenceDict,
          ),
          remap,
        ),
        labels,
        colors,
        shapes,
      );
      annotation_data[name] = { kind: 'csr', end: csr.end, codes: csr.codes, length: numRows };
      if (csr.scores) annotation_scores_csr[name] = csr.scores;
      if (csr.evidence) annotation_evidence_csr[name] = csr.evidence;
    }

    annotations[name] = { kind: 'categorical', values: labels, colors, shapes };
  }

  const data: VisualizationData = {
    protein_ids,
    projections,
    annotations,
    annotation_data,
    numeric_annotation_data,
    annotation_scores: {},
    annotation_evidence: {},
    ...(Object.keys(annotation_scores_csr).length > 0 ? { annotation_scores_csr } : {}),
    ...(Object.keys(annotation_evidence_csr).length > 0 ? { annotation_evidence_csr } : {}),
  };

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
