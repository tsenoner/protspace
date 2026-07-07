import { parquetReadObjects } from 'hyparquet';
import {
  BUNDLE_DELIMITER_BYTES,
  findBundleDelimiterPositions,
  normalizeBundleSettings,
  type BundleSettings,
} from '@protspace/utils';
import type { Rows, GenericRow } from './types';
import { assertValidParquetMagic, validateProjectionRows } from './validation';
import { sanitizePublishState } from '../../publish/publish-state-validator';

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
}

/**
 * Extract rows and optional settings from a parquetbundle.
 *
 * Supports:
 * - 2 delimiters (3 parts): Original format without settings
 * - 3 delimiters (4 parts): Extended format with settings
 * - 4 delimiters (5 parts): With statistics (optional 5th part, ignored here;
 *   the settings slot may be zero bytes when statistics are present without settings)
 */
export async function extractRowsFromParquetBundle(
  arrayBuffer: ArrayBuffer,
): Promise<BundleExtractionResult> {
  const uint8Array = new Uint8Array(arrayBuffer);
  const delimiterPositions = findBundleDelimiterPositions(uint8Array);

  // Supported shapes (by delimiter count):
  //   2 → 3 parts (core only)
  //   3 → 4 parts (core + settings)
  //   4 → 5 parts (core + settings + statistics; the settings slot may be empty)
  if (delimiterPositions.length < 2 || delimiterPositions.length > 4) {
    throw new Error(
      `Expected 2 to 4 delimiters in parquetbundle, found ${delimiterPositions.length}`,
    );
  }

  const delimLen = BUNDLE_DELIMITER_BYTES.length;
  const partStart = (i: number): number => (i === 0 ? 0 : delimiterPositions[i - 1] + delimLen);
  const partEnd = (i: number): number =>
    i < delimiterPositions.length ? delimiterPositions[i] : uint8Array.length;
  const slicePart = (i: number): ArrayBuffer =>
    uint8Array.subarray(partStart(i), partEnd(i)).slice().buffer;

  // Extract the three required core parts.
  let part1: ArrayBuffer | null = slicePart(0);
  let part2: ArrayBuffer | null = slicePart(1);
  let part3: ArrayBuffer | null = slicePart(2);

  // Part 4 is settings (optional). It may be a zero-byte slot when a statistics
  // part follows without settings — branch on emptiness, not the raw count.
  // Part 5 is statistics, intentionally ignored for now (rendering is separate).
  //
  // ASSUMPTION (unverified in this repo): part-index 3 = settings and
  // part-index 4 = statistics, i.e. the external `protspace bundle` CLI always
  // orders a 5-part bundle as [core, core, core, settings, statistics], and
  // writes a zero-byte placeholder for the settings slot when statistics are
  // present without settings. That CLI lives outside this repo
  // (services/protspace-prep shells out to `protspace bundle` / `protspace
  // stats`), so this ordering has not been verified against the pinned
  // protspace version. If the engine instead omits the delimiter for a
  // missing settings part (writing a delimiter only BETWEEN present tables,
  // per its known writer pattern) rather than emitting an empty placeholder,
  // or orders parts differently, this slicing would misread part4 and
  // auto-generated cluster styles would be silently dropped (clusters render
  // uncolored) with no signal. See the warn below for the best-effort
  // observability guard.
  const part4: ArrayBuffer | null =
    delimiterPositions.length >= 3 && partEnd(3) > partStart(3) ? slicePart(3) : null;

  // Validate parquet magic for each part before parsing
  assertValidParquetMagic(part1);
  assertValidParquetMagic(part2);
  assertValidParquetMagic(part3);

  // Decode sequentially and release each sliced buffer immediately after its decode completes.
  // hyparquet is CPU-bound on the single JS thread — Promise.all gives no real parallelism, only
  // interleaved async continuations that keep all three buffers + decode scratch live simultaneously.
  // Sequential decode ensures only one part's buffer is live at a time, cutting the transient
  // load-peak (critical for large datasets such as SwissProt 573 K where peak heap reached ~2.3 GB).
  const selectedAnnotationsData = await parquetReadObjects({ file: part1 });
  part1 = null;
  const projectionsMetadataData = await parquetReadObjects({ file: part2 });
  part2 = null;
  const projectionsData = await parquetReadObjects({ file: part3! });
  part3 = null;

  // Parse settings if present
  let settings: BundleSettings | null = null;
  if (part4) {
    settings = await extractSettings(part4);

    // Observability guard for the part-ordering ASSUMPTION documented above.
    // A non-empty part4 that fails to parse as settings is expected (and
    // silent) for the plain 3-delimiter core-only case where part4 doesn't
    // exist at all — but here we've already established part4 has real
    // bytes AND a statistics part is present (4 delimiters). If settings
    // still came back null, either this bundle genuinely has no settings, or
    // the part-ordering assumption doesn't hold for this bundle and we just
    // misread the statistics part as settings. We can't tell which from here
    // without changing the return shape, so just make the ambiguity visible.
    if (delimiterPositions.length === 4 && settings === null) {
      console.warn(
        'protspace bundle: a 5-part bundle (core + settings + statistics) was detected, ' +
          'but the settings part (index 3) did not parse as settings (no settings_json ' +
          'found). This may mean the bundle genuinely has no settings, OR that the ' +
          '`protspace bundle` CLI ordered parts differently than assumed here ' +
          '([core, core, core, settings, statistics]) — in which case auto-generated ' +
          'cluster styles were silently dropped. Verify against the pinned protspace version.',
      );
    }
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
  };
}

/**
 * Extract and parse settings from the 4th part of the bundle.
 * Returns null if parsing fails (graceful degradation).
 */
async function extractSettings(settingsBuffer: ArrayBuffer): Promise<BundleSettings | null> {
  try {
    // A zero-byte settings slot (statistics-without-settings) is "no settings".
    if (settingsBuffer.byteLength === 0) {
      return null;
    }
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
