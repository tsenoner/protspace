import { parquetReadObjects } from 'hyparquet';
import {
  BUNDLE_DELIMITER_BYTES,
  PROJECTION_STATISTIC_COLUMNS,
  findBundleDelimiterPositions,
  normalizeBundleSettings,
  type BundleSettings,
  type ProjectionStatisticRow,
} from '@protspace/utils';
import { assertValidParquetMagic } from './validation';
import { sanitizePublishState } from '../../publish/publish-state-validator';

/**
 * A parquetbundle's parts in writer order: annotations, projections metadata,
 * projections, then the optional settings, statistics and (format v3 only) payloads.
 * The three core parts are always present parquet; an optional slot is `null` when
 * absent. Readers null entries out as they take ownership, hence the nullable slots.
 */
export type BundleParts = [ArrayBuffer, ArrayBuffer, ArrayBuffer, ...(ArrayBuffer | null)[]];

/**
 * Split a parquetbundle into its parts, one entry per slot in writer order. A zero-byte
 * slot — the sentinel the producer writes when a later optional part is present but this
 * one is not — comes back as `null`. Throws when a core part is missing or is not parquet,
 * so every format version's reader starts from three readable core parts.
 *
 * Every layout the Python producer can write is accepted (see `_parse_bundle` in
 * `apps/protspace/src/protspace/data/io/bundle.py`):
 * - 2 delimiters (3 parts): original format without settings
 * - 3 delimiters (4 parts): extended format with settings
 * - 4 delimiters (5 parts): settings plus a projection-statistics part (backend `--stats`)
 * - 5 delimiters (6 parts): format v3, which appends the required payloads part
 *
 * Each part is copied out of the container so the (possibly very large) bundle buffer
 * can be released as soon as the parts it still needs have been decoded.
 */
export function splitBundleParts(arrayBuffer: ArrayBuffer): BundleParts {
  const uint8Array = new Uint8Array(arrayBuffer);
  const delimiterPositions = findBundleDelimiterPositions(uint8Array);

  if (delimiterPositions.length < 2 || delimiterPositions.length > 5) {
    throw new Error(
      `Expected 2 to 5 delimiters in parquetbundle, found ${delimiterPositions.length}`,
    );
  }

  // Part 0 starts at byte 0, every later part right after the preceding delimiter, and
  // the final part runs to the end of the buffer. Bounding each part by the *next*
  // delimiter is what keeps a trailing part from being glued onto its predecessor's
  // tail — without it, a 5-part bundle would hand the settings parser the statistics
  // part too.
  const parts: (ArrayBuffer | null)[] = [];
  for (let index = 0; index <= delimiterPositions.length; index++) {
    const view = uint8Array.subarray(
      index === 0 ? 0 : delimiterPositions[index - 1] + BUNDLE_DELIMITER_BYTES.length,
      index < delimiterPositions.length ? delimiterPositions[index] : uint8Array.length,
    );
    parts.push(view.byteLength > 0 ? view.slice().buffer : null);
  }

  const [part1, part2, part3] = parts;
  if (!part1 || !part2 || !part3) {
    throw new Error('Parquetbundle is missing one of its three required core parts');
  }
  assertValidParquetMagic(part1);
  assertValidParquetMagic(part2);
  assertValidParquetMagic(part3);
  return parts as BundleParts;
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
export async function extractStatistics(
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
export async function extractSettings(settingsBuffer: ArrayBuffer): Promise<BundleSettings | null> {
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
