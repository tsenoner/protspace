import { parquetReadObjects, parquetMetadata, type FileMetaData } from 'hyparquet';
import {
  BUNDLE_DELIMITER_BYTES,
  findBundleDelimiterPositions,
  normalizeBundleSettings,
  type BundleSettings,
} from '@protspace/utils';
import type { Rows, GenericRow } from './types';
import { assertValidParquetMagic, validateProjectionRows } from './validation';
import { sanitizePublishState } from '../../publish/publish-state-validator';

/** Key-value metadata key the Python writer stamps with the bundle's annotation format version. */
const FORMAT_VERSION_KEY = 'protspace_format_version';

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
   * Bundle annotation format version, read from the `protspace_format_version`
   * parquet key-value metadata on the annotations part (part 1). `1` when the
   * key is absent, unparsable, or the part isn't a bundle at all (defaults to
   * legacy v1 behavior — plain-string labels, raw `;`-delimited multi-hit cells).
   */
  formatVersion: number;
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
  try {
    const kv = metadata.key_value_metadata ?? [];
    const entry = kv.find((k) => k.key === FORMAT_VERSION_KEY);
    const v = entry?.value ? Number(entry.value) : 1;
    return Number.isFinite(v) ? v : 1;
  } catch {
    return 1;
  }
}

/**
 * Extract rows and optional settings from a parquetbundle.
 *
 * Supports two formats:
 * - 2 delimiters (3 parts): Original format without settings
 * - 3 delimiters (4 parts): Extended format with settings
 */
export async function extractRowsFromParquetBundle(
  arrayBuffer: ArrayBuffer,
): Promise<BundleExtractionResult> {
  const uint8Array = new Uint8Array(arrayBuffer);
  const delimiterPositions = findBundleDelimiterPositions(uint8Array);

  // Support both 2 delimiters (original) and 3 delimiters (with settings)
  if (delimiterPositions.length !== 2 && delimiterPositions.length !== 3) {
    throw new Error(
      `Expected 2 or 3 delimiters in parquetbundle, found ${delimiterPositions.length}`,
    );
  }

  const hasSettingsPart = delimiterPositions.length === 3;

  // Extract the three required parts
  let part1: ArrayBuffer | null = uint8Array.subarray(0, delimiterPositions[0]).slice().buffer;
  let part2: ArrayBuffer | null = uint8Array
    .subarray(delimiterPositions[0] + BUNDLE_DELIMITER_BYTES.length, delimiterPositions[1])
    .slice().buffer;

  let part3: ArrayBuffer | null;
  let part4: ArrayBuffer | null = null;

  if (hasSettingsPart) {
    part3 = uint8Array
      .subarray(delimiterPositions[1] + BUNDLE_DELIMITER_BYTES.length, delimiterPositions[2])
      .slice().buffer;
    part4 = uint8Array
      .subarray(delimiterPositions[2] + BUNDLE_DELIMITER_BYTES.length)
      .slice().buffer;
  } else {
    part3 = uint8Array
      .subarray(delimiterPositions[1] + BUNDLE_DELIMITER_BYTES.length)
      .slice().buffer;
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
  try {
    part1Metadata = parquetMetadata(part1);
    formatVersion = readFormatVersion(part1Metadata);
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
  const projectionsData = await parquetReadObjects({ file: part3! });
  part3 = null;

  // Parse settings if present
  let settings: BundleSettings | null = null;
  if (part4) {
    settings = await extractSettings(part4);
  }

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
    formatVersion,
  };
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
