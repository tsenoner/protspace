import { parquetReadObjects, parquetMetadata, type FileMetaData } from 'hyparquet';
import {
  BUNDLE_DELIMITER_BYTES,
  PROJECTION_STATISTIC_COLUMNS,
  findBundleDelimiterPositions,
  normalizeBundleSettings,
  type BundleSettings,
  type ProjectionStatisticRow,
} from '@protspace/utils';
import type { Rows, GenericRow } from './types';
import { assertValidParquetMagic, validateProjectionRows } from './validation';
import { sanitizePublishState } from '../../publish/publish-state-validator';

/** Key-value metadata key the Python writer stamps with the bundle's annotation format version. */
const FORMAT_VERSION_KEY = 'protspace_format_version';

/** Parquet physical types that identify a stored annotation column as numeric. */
const INTEGER_PARQUET_TYPES = new Set(['INT32', 'INT64']);
const FLOAT_PARQUET_TYPES = new Set(['FLOAT', 'DOUBLE']);

/**
 * Result of extracting data from a parquetbundle.
 */
export interface BundleExtractionResult {
  /** Projection rows (x/y/z/projection_name/identifier) — annotation fields NOT spread in. */
  projections: Rows;
  /** Annotation rows keyed by protein id. */
  annotationsById: Map<string, GenericRow>;
  /** Column name in `projections` that carries the protein id. */
  projectionIdColumn: string;
  /** Column name in annotation rows that carries the protein id. */
  annotationIdColumn: string;
  projectionsMetadata: Rows;
  /** Settings loaded from bundle (null if not present) */
  settings: BundleSettings | null;
  /**
   * Raw projection-statistics part (part 5), unparsed, null if not present. This is the
   * authoritative copy: an export re-emits these bytes verbatim, so a column this reader
   * does not model still survives the round trip.
   */
  statistics: ArrayBuffer | null;
  /**
   * The same part parsed for rendering, derived once from `statistics` and never written
   * back to it; null when the bundle has none or the part was unreadable. Optional so
   * callers that build this shape by hand — chiefly tests — need not restate it, matching
   * how `VisualizationData.statisticsRows` is declared.
   */
  statisticsRows?: readonly ProjectionStatisticRow[] | null;
  /**
   * Bundle annotation format version, read from the `protspace_format_version`
   * parquet key-value metadata on the annotations part (part 1). `1` when the
   * key is absent, unparsable, or the part isn't a bundle at all (defaults to
   * legacy v1 behavior — plain-string labels, raw `;`-delimited multi-hit cells).
   */
  formatVersion: number;
  /**
   * Stored numeric columns with their int/float identity, read from the
   * annotations part's parquet schema. Empty for bundles that store their
   * annotations as text, where the type is inferred from the values instead.
   */
  numericColumnTypes?: Readonly<Record<string, 'int' | 'float'>>;
}

/**
 * Reads the `protspace_format_version` key-value metadata entry from an
 * already-parsed parquet footer (part1's `FileMetaData`, produced once by
 * `parquetMetadata` and reused for the subsequent `parquetReadObjects` call —
 * avoids re-parsing the same footer twice).
 *
 * Returns `1` (legacy default) when the key is missing, non-numeric, or
 * lookup otherwise fails — this keeps v1/absent bundles rendering exactly as
 * before Task H2.
 */
function readFormatVersion(metadata: FileMetaData): number {
  const kv = metadata.key_value_metadata ?? [];
  const entry = kv.find((k) => k.key === FORMAT_VERSION_KEY);
  const v = entry?.value ? Number(entry.value) : 1;
  return Number.isFinite(v) ? v : 1;
}

/**
 * Derives each stored numeric column's int/float identity from the annotations
 * part's own parquet schema.
 *
 * The physical type is the wire record of what the writer meant, and it is the
 * only one that survives everywhere: it holds for a column whose rows are all
 * null (nothing left to infer from), and it rides through the Python rewrite
 * paths, which rebuild the table with pyarrow and drop key-value metadata.
 * Columns stored as text (the `protspace` CLI stringifies its annotation frame)
 * are absent here, so those keep falling back to value inference.
 *
 * Only an *unannotated* physical type counts. A logical/converted type means the
 * physical type is a carrier, not the identity: pyarrow stores an all-null
 * (arrow `null`) column as INT32 + logical NULL, and DECIMAL rides on INT32/INT64
 * as well — reading either as an integer annotation would turn a text column into
 * a numeric one. Annotated fields fall back to value inference, exactly as they
 * did before this reader existed.
 */
function readNumericColumnTypes(metadata: FileMetaData): Record<string, 'int' | 'float'> {
  const numericColumns: Record<string, 'int' | 'float'> = {};
  for (const field of metadata.schema) {
    if (!field.name || !field.type) continue;
    if (field.logical_type != null || field.converted_type != null) continue;
    if (INTEGER_PARQUET_TYPES.has(field.type)) numericColumns[field.name] = 'int';
    else if (FLOAT_PARQUET_TYPES.has(field.type)) numericColumns[field.name] = 'float';
  }
  return numericColumns;
}

/**
 * Extract rows and optional settings from a parquetbundle.
 *
 * Supports every layout the Python producer can write (see `_parse_bundle` in
 * `apps/protspace/src/protspace/data/io/bundle.py`, which bounds itself to 3-5 parts):
 * - 2 delimiters (3 parts): Original format without settings
 * - 3 delimiters (4 parts): Extended format with settings
 * - 4 delimiters (5 parts): Settings plus a projection-statistics part (backend `--stats`).
 *   The part is returned verbatim so an export can re-emit it byte for byte, and
 *   separately parsed into rows for rendering — the parse is a derived view and never
 *   the source of the re-emitted bytes. The settings slot may be zero bytes when the
 *   producer wrote statistics without settings — it exists only to keep the statistics
 *   part at a fixed position.
 */
export async function extractRowsFromParquetBundle(
  arrayBuffer: ArrayBuffer,
): Promise<BundleExtractionResult> {
  const uint8Array = new Uint8Array(arrayBuffer);
  const delimiterPositions = findBundleDelimiterPositions(uint8Array);

  // 2 delimiters (core only), 3 (with settings), or 4 (settings + statistics).
  if (delimiterPositions.length < 2 || delimiterPositions.length > 4) {
    throw new Error(
      `Expected 2 to 4 delimiters in parquetbundle, found ${delimiterPositions.length}`,
    );
  }

  /**
   * Copy out part `index` — part 0 starts at byte 0, every later part right after the
   * preceding delimiter, and the final part runs to the end of the buffer. Order is
   * fixed by the writer: annotations, projections metadata, projections, settings,
   * statistics. Bounding each part by the *next* delimiter is what keeps a trailing part
   * from being glued onto its predecessor's tail — without it, a 5-part bundle would hand
   * the settings parser the statistics part too. Returns null for a zero-byte slot (an
   * empty settings placeholder when a bundle carries statistics but no settings).
   */
  const partAt = (index: number): ArrayBuffer | null => {
    // Out of range must be null, not a slice: `delimiterPositions[index - 1]` is undefined,
    // `undefined + 8` is NaN, and `subarray(NaN, len)` coerces NaN to 0 — returning the whole
    // bundle as if it were one part.
    if (index < 0 || index > delimiterPositions.length) return null;
    const view = uint8Array.subarray(
      index === 0 ? 0 : delimiterPositions[index - 1] + BUNDLE_DELIMITER_BYTES.length,
      index < delimiterPositions.length ? delimiterPositions[index] : uint8Array.length,
    );
    return view.byteLength > 0 ? view.slice().buffer : null;
  };

  // The three required core parts.
  let part1: ArrayBuffer | null = partAt(0);
  let part2: ArrayBuffer | null = partAt(1);
  let part3: ArrayBuffer | null = partAt(2);
  const part4 = partAt(3);
  const part5 = partAt(4);

  if (!part1 || !part2 || !part3) {
    throw new Error('Parquetbundle is missing one of its three required core parts');
  }

  // Validate parquet magic for each part before parsing
  assertValidParquetMagic(part1);
  assertValidParquetMagic(part2);
  assertValidParquetMagic(part3);

  // Parse part1's footer once (the annotations part), before it's decoded, and reuse
  // the result both to read the format_version and as the `metadata` option below —
  // hyparquet re-derives metadata from the buffer when `metadata` is omitted, so
  // passing it explicitly avoids parsing the same footer twice. On parse failure,
  // fall back to `formatVersion = 1` and let `parquetReadObjects` (without `metadata`)
  // re-attempt the parse itself, surfacing the same error it would have before.
  let part1Metadata: FileMetaData | null = null;
  let formatVersion = 1;
  let numericColumnTypes: Readonly<Record<string, 'int' | 'float'>> = {};
  try {
    part1Metadata = parquetMetadata(part1);
    formatVersion = readFormatVersion(part1Metadata);
    numericColumnTypes = readNumericColumnTypes(part1Metadata);
  } catch {
    formatVersion = 1;
  }

  // Decode sequentially and release each sliced buffer immediately after its decode completes.
  // hyparquet is CPU-bound on the single JS thread — Promise.all gives no real parallelism, only
  // interleaved async continuations that keep all three buffers + decode scratch live simultaneously.
  // Sequential decode ensures only one part's buffer is live at a time, cutting the transient
  // load-peak (critical for large datasets such as SwissProt 573 K where peak heap reached ~2.3 GB).
  const selectedAnnotationsData = part1Metadata
    ? await parquetReadObjects({ file: part1, metadata: part1Metadata })
    : await parquetReadObjects({ file: part1 });
  part1 = null;
  const projectionsMetadataData = await parquetReadObjects({ file: part2 });
  part2 = null;
  const projectionsData = await parquetReadObjects({ file: part3 });
  part3 = null;

  // Parse settings if present
  let settings: BundleSettings | null = null;
  // A zero-byte settings part is the producer's sentinel for "no settings, but
  // statistics follow" — absent settings, not a corrupt part, so don't warn.
  if (part4 && part4.byteLength > 0) {
    settings = await extractSettings(part4);
  }

  // Derived view only. `part5` itself is what gets re-exported, so a parse failure here
  // costs the charts, never the bytes.
  const statisticsRows = part5 ? await extractStatistics(part5) : null;

  // Validate projection rows for expected bundle shape
  validateProjectionRows(projectionsData);

  // Find the ID column in annotation data
  const annotationIdColumn = findColumn(
    selectedAnnotationsData.length > 0 ? Object.keys(selectedAnnotationsData[0]) : [],
    ['protein_id', 'identifier', 'id', 'uniprot', 'entry'],
  );

  const finalAnnotationIdColumn =
    annotationIdColumn ||
    (selectedAnnotationsData.length > 0 ? Object.keys(selectedAnnotationsData[0])[0] : undefined) ||
    'identifier';

  // Build annotations map keyed by protein id
  const annotationsById = new Map<string, GenericRow>();
  for (const annotation of selectedAnnotationsData) {
    const proteinId = annotation[finalAnnotationIdColumn];
    if (proteinId != null) {
      annotationsById.set(String(proteinId), annotation);
    }
  }

  // Find the ID column in projection data
  const projectionIdColumn =
    findColumn(projectionsData.length > 0 ? Object.keys(projectionsData[0]) : [], [
      'identifier',
      'protein_id',
      'id',
      'uniprot',
      'entry',
    ]) || 'identifier';

  return {
    projections: projectionsData,
    annotationsById,
    projectionIdColumn,
    annotationIdColumn: finalAnnotationIdColumn,
    projectionsMetadata: projectionsMetadataData,
    settings,
    statistics: part5,
    statisticsRows,
    formatVersion,
    numericColumnTypes,
  };
}

/**
 * Extract the optional statistics part (5th) — projection-quality metrics written by the
 * backend's `--stats` flag, in tidy long format (one row per space × annotation × metric).
 *
 * Returns null when the part is unreadable or doesn't look like the statistics table:
 * statistics are supplementary, so a malformed part must never fail the whole load.
 *
 * This is a render-only view. The caller keeps the original bytes and re-exports those, so
 * nothing here — a failed parse, an unmodelled column, a coerced type — can reach a file the
 * user saves.
 */
async function extractStatistics(
  statisticsBuffer: ArrayBuffer,
): Promise<readonly ProjectionStatisticRow[] | null> {
  try {
    assertValidParquetMagic(statisticsBuffer);
    const rows = await parquetReadObjects({ file: statisticsBuffer });
    if (!rows.length) return null;

    // Guard against a future/renamed schema landing in this slot. `annotationStatSummary`
    // branches on all three `*_kind` columns, so a rename there yields zero ⓘ icons and no
    // warning at all — indistinguishable from a bundle prepared without `--stats`.
    // Deliberately a subset check, not an equality one: a newer backend adding a column
    // must still render here, and it rides out on the verbatim bytes regardless.
    const columns = Object.keys(rows[0]);
    if (!PROJECTION_STATISTIC_COLUMNS.every((column) => columns.includes(column))) {
      console.warn('Statistics parquet has an unexpected schema, ignoring it');
      return null;
    }

    // hyparquet yields BigInt for INT64 columns, which `formatStatValue` cannot render.
    // The official writer types `value` DOUBLE, but a third-party part with an all-integer
    // value column must still display as numbers.
    for (const row of rows) {
      if (typeof row.value === 'bigint') row.value = Number(row.value);
    }

    return rows as unknown as ProjectionStatisticRow[];
  } catch (error) {
    console.warn('Failed to parse statistics from bundle, ignoring them:', error);
    return null;
  }
}

/**
 * Extract and parse settings from the 4th part of the bundle.
 * Returns null if parsing fails (graceful degradation).
 */
async function extractSettings(settingsBuffer: ArrayBuffer): Promise<BundleSettings | null> {
  try {
    // Validate parquet magic
    assertValidParquetMagic(settingsBuffer);

    const settingsData = await parquetReadObjects({ file: settingsBuffer });

    if (!settingsData || settingsData.length === 0) {
      console.warn('Settings parquet is empty, using defaults');
      return null;
    }

    // Extract the settings_json column from the first row
    const firstRow = settingsData[0] as { settings_json?: string };
    const settingsJson = firstRow.settings_json;

    if (typeof settingsJson !== 'string') {
      console.warn('Settings JSON is not a string, using defaults');
      return null;
    }

    const parsed = JSON.parse(settingsJson);
    const normalized = normalizeBundleSettings(parsed, { sanitizePublishState });

    if (!normalized) {
      console.warn('Settings JSON does not match expected schema, using defaults');
      return null;
    }

    return normalized;
  } catch (error) {
    console.warn('Failed to parse settings from bundle, using defaults:', error);
    return null;
  }
}

export function findColumn(columnNames: string[], candidates: string[]): string | null {
  for (const candidate of candidates) {
    const found = columnNames.find((col) => col.toLowerCase().includes(candidate.toLowerCase()));
    if (found) return found;
  }
  return null;
}

/**
 * Materializes a single merged row per protein by spreading annotation fields
 * into projection rows. Used by:
 *  - the small-dataset path of `convertParquetToVisualizationData` (where the
 *    O(N) spread cost is acceptable), and
 *  - the legacy-format fallback in `convertLargeDatasetOptimized`.
 *
 * The large-bundle hot path stays on the separated shape and never calls this.
 */
export function materializeMergedRows(extraction: BundleExtractionResult): Rows {
  const { projections, annotationsById, projectionIdColumn } = extraction;
  const merged: Rows = new Array(projections.length);
  for (let i = 0; i < projections.length; i++) {
    const projection = projections[i];
    const proteinId = projection[projectionIdColumn];
    const annotation = proteinId != null ? annotationsById.get(String(proteinId)) : undefined;
    merged[i] = annotation ? { ...projection, ...annotation } : { ...projection };
  }
  return merged;
}
