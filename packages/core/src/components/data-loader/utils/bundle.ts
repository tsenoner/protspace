import { parquetReadObjects, parquetMetadata, type FileMetaData } from 'hyparquet';
import type { BundleSettings, ProjectionStatisticRow, VisualizationData } from '@protspace/utils';
import type { Rows, GenericRow } from './types';
import { validateProjectionRows, validateRowsBasic } from './validation';
import { convertParquetToVisualizationDataOptimized } from './conversion';
import { readV3Bundle } from './bundle-v3';
import {
  extractSettings,
  extractStatistics,
  splitBundleParts,
  type BundleParts,
} from './bundle-parts';

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
 * Parse the annotations part's footer, or null when it is not readable parquet.
 *
 * Callers reuse the result both to read the format version and as the `metadata`
 * option of the subsequent read — hyparquet re-derives metadata from the buffer when
 * `metadata` is omitted, so passing it explicitly avoids parsing the same footer twice.
 * A parse failure is swallowed here so the legacy reader keeps behaving exactly as it
 * did: `formatVersion = 1`, and `parquetReadObjects` re-attempts the parse itself and
 * surfaces the real error.
 */
function readPart1Metadata(part1: ArrayBuffer): FileMetaData | null {
  try {
    return parquetMetadata(part1);
  } catch {
    return null;
  }
}

/**
 * Extract rows and optional settings from a parquetbundle (formats 1 and 2).
 *
 * Throws on a format 3 bundle, which has no row objects to return.
 *
 * @deprecated Reads only the v1/v2 bundle formats, whose support ends in protspace 5.0.0.
 * Use {@link decodeParquetBundle}, which reads every format version.
 */
export async function extractRowsFromParquetBundle(
  arrayBuffer: ArrayBuffer,
): Promise<BundleExtractionResult> {
  const parts = splitBundleParts(arrayBuffer);
  return extractRowsFromParts(parts, readPart1Metadata(parts[0]));
}

/**
 * The row-object reader for bundle formats 1 and 2, over parts already split out of
 * the container. Split from {@link extractRowsFromParquetBundle} so the version sniff
 * in {@link decodeParquetBundle} does not have to scan a 200 MB buffer twice.
 */
async function extractRowsFromParts(
  parts: BundleParts,
  part1Metadata: FileMetaData | null,
): Promise<BundleExtractionResult> {
  let part1: ArrayBuffer | null = parts[0];
  let part2: ArrayBuffer | null = parts[1];
  let part3: ArrayBuffer | null = parts[2];
  const part4 = parts[3] ?? null;
  const part5 = parts[4] ?? null;
  // Take ownership: the caller's array would otherwise pin every part until the whole
  // decode returns, and the per-part release below would free nothing.
  parts.fill(null);

  const formatVersion = part1Metadata ? readFormatVersion(part1Metadata) : 1;
  // v3 stores its annotations as dictionary codes plus payloads, which this row-object
  // reader cannot make sense of: it would get as far as part 3 and complain about
  // missing 'projection_name'/'x'/'y' columns. Say what is actually wrong instead.
  if (formatVersion >= 3) {
    throw new Error(
      `Parquetbundle declares annotation format v${formatVersion}, which only ` +
        'decodeParquetBundle can read; extractRowsFromParquetBundle handles v1 and v2.',
    );
  }
  const numericColumnTypes: Readonly<Record<string, 'int' | 'float'>> = part1Metadata
    ? readNumericColumnTypes(part1Metadata)
    : {};

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

/** What {@link decodeParquetBundle} returns. */
export interface DecodedParquetBundle {
  data: VisualizationData;
  settings: BundleSettings | null;
  /**
   * Container format version the bundle was read as: 3 for the columnar format, else the
   * legacy annotation format (1 or 2), whose support ends in protspace 5.0.0.
   */
  formatVersion: number;
}

/**
 * Read a parquetbundle into visualization data, whichever format version it carries.
 *
 * The one entry point every bundle load goes through — the decode worker and both of
 * `data-loader.ts`'s bundle branches — so the version sniff lives in exactly one place.
 * Format 3 and above take the columnar reader in `bundle-v3.ts`; anything older takes
 * the row-object path unchanged.
 */
export async function decodeParquetBundle(arrayBuffer: ArrayBuffer): Promise<DecodedParquetBundle> {
  const parts = splitBundleParts(arrayBuffer);
  const part1Metadata = readPart1Metadata(parts[0]);
  const formatVersion = part1Metadata ? readFormatVersion(part1Metadata) : 1;

  if (part1Metadata && formatVersion >= 3) {
    return { ...(await readV3Bundle(parts, part1Metadata)), formatVersion };
  }

  const extraction = await extractRowsFromParts(parts, part1Metadata);
  validateRowsBasic(extraction.projections);
  return {
    data: await convertParquetToVisualizationDataOptimized(extraction),
    settings: extraction.settings,
    formatVersion: extraction.formatVersion,
  };
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
