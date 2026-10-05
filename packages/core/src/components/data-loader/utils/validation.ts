import type { Rows } from './types';
import { sanitizeForMessage } from '@protspace/utils';

// Parquet magic bytes 'PAR1'
const PARQUET_MAGIC = new Uint8Array([0x50, 0x41, 0x52, 0x31]);

/**
 * The most rows a v1/v2 bundle may hold. Its reader decodes every row to an object, at
 * ~1.3 GB of heap per million (#456), and the cap keeps a load inside the ~4.4 GB heap
 * instead of crashing the tab. Format v3 has no such cap: its reader bounds allocation
 * by part size.
 */
const LEGACY_MAX_ROWS = 2_000_000;

/**
 * Safety limits to avoid abusive inputs. Exported so callers and tests read the
 * same numbers the defaults below are built from.
 *
 * `maxRows`: projections_data is long-format — one row per (protein x
 * projection) — so capping ROWS bounds proteins-per-projection for any
 * projection count >= 1, with no distinct-protein scan, which matters because
 * this runs before grouping.
 */
export const DEFAULT_VALIDATION_LIMITS = {
  maxFileSizeBytes: 2 * 1024 * 1024 * 1024, // 2 GB
  maxRows: LEGACY_MAX_ROWS,
  maxColumns: 200,
  maxCellStringLength: 256,
} as const;

export function assertValidParquetMagic(buffer: ArrayBuffer): void {
  const u8 = new Uint8Array(buffer);
  if (u8.length < 12) {
    throw new Error('Invalid Parquet file: too small');
  }
  const head = u8.subarray(0, 4);
  const tail = u8.subarray(u8.length - 4);
  for (let i = 0; i < 4; i++) {
    if (head[i] !== PARQUET_MAGIC[i] || tail[i] !== PARQUET_MAGIC[i]) {
      throw new Error('Invalid Parquet file: magic bytes not found');
    }
  }
}

const ACCEPTED_EXTENSION = '.parquetbundle';

export function assertValidFileExtension(fileName: string): void {
  if (!fileName.endsWith(ACCEPTED_EXTENSION)) {
    throw new Error(`Unsupported file format. Please upload a ${ACCEPTED_EXTENSION} file.`);
  }
}

export function assertWithinFileSizeLimit(
  sizeBytes: number,
  maxSizeBytes = DEFAULT_VALIDATION_LIMITS.maxFileSizeBytes,
): void {
  if (sizeBytes > maxSizeBytes) {
    const mb = (bytes: number, digits: number) => (bytes / (1024 * 1024)).toFixed(digits);
    throw new Error(
      `File too large: ${mb(sizeBytes, 2)} MB exceeds the ${mb(maxSizeBytes, 0)} MB limit`,
    );
  }
}

/**
 * Refuse a v1/v2 dataset of more than `maxRows` rows, naming the count, the limit, what
 * it counts and the way out. A bare "N exceeds limit" reached the user as a toast whose
 * only action was "Report this", inviting a bug report about intended behaviour (#456).
 * Through `validateRowsBasic` it also caps the rows of a plain parquet file read by
 * `loadFromUrl`, which then gets the same v1/v2 wording.
 */
export function assertWithinLegacyRowLimit(
  rows: number,
  maxRows: number = DEFAULT_VALIDATION_LIMITS.maxRows,
): void {
  if (rows > maxRows) {
    throw new Error(
      `Dataset too large for a v1/v2 bundle: ${rows.toLocaleString()} rows (proteins x ` +
        `projections) exceeds the limit of ${maxRows.toLocaleString()}. Run "protspace convert" ` +
        `on the file to upgrade it to the current format, which has no such limit.`,
    );
  }
}

export function validateRowsBasic(
  rows: unknown,
  {
    maxRows = DEFAULT_VALIDATION_LIMITS.maxRows,
    maxColumns = DEFAULT_VALIDATION_LIMITS.maxColumns,
    maxCellStringLength = DEFAULT_VALIDATION_LIMITS.maxCellStringLength,
  }: {
    maxRows?: number;
    maxColumns?: number;
    maxCellStringLength?: number;
  } = {},
): asserts rows is Rows {
  if (!Array.isArray(rows)) {
    throw new Error('Parsed data is not an array of rows');
  }
  if (rows.length === 0) {
    throw new Error('No data rows found in file');
  }
  assertWithinLegacyRowLimit(rows.length, maxRows);
  const first = rows[0];
  if (typeof first !== 'object' || first == null) {
    throw new Error('Rows must be objects');
  }
  const columnNames = Object.keys(first as Record<string, unknown>);
  if (columnNames.length === 0) {
    throw new Error('No columns found in data');
  }
  if (columnNames.length > maxColumns) {
    throw new Error(`Too many columns: ${columnNames.length} exceeds limit`);
  }
  // Scan a small sample for dangerous content and overlong strings
  const sampleSize = Math.min(1000, rows.length);
  for (let i = 0; i < sampleSize; i++) {
    const row = rows[i] as Record<string, unknown>;
    for (const key of columnNames) {
      const val = row[key];
      const safeKey = sanitizeForMessage(key);
      if (typeof val === 'string') {
        const parts = val.split(';');
        for (const part of parts) {
          if (part.length > maxCellStringLength) {
            throw new Error(
              `Cell value too long in column '${safeKey}': a single value has ${part.length} characters (limit: ${maxCellStringLength})`,
            );
          }
        }
        if (/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/.test(val)) {
          throw new Error(`Control characters detected in column '${safeKey}'`);
        }
      }
    }
  }
}

/**
 * Validates projection rows (the raw projection part of a bundle, without annotations spread in).
 * Checks for expected columns: projection_name, x, y, and numeric coordinate sanity.
 */
export function validateProjectionRows(rows: Rows): void {
  validateRowsBasic(rows);
  const columnNames = Object.keys(rows[0]);
  const numericLikeColumns = columnNames.filter((name) => /^[+-]?\d+(?:\.\d+)?$/.test(name));
  if (numericLikeColumns.length > 0) {
    const sampleList = sanitizeForMessage(numericLikeColumns.slice(0, 5).join(', '));
    throw new Error(
      `Invalid bundle: numeric-looking column names detected (${sampleList}). Expected named columns like 'projection_name', 'x', 'y'`,
    );
  }
  // Guard: empty column names are not allowed
  for (const name of columnNames) {
    if (name.trim().length === 0) {
      throw new Error('Invalid bundle: empty column name found');
    }
  }
  const hasX = columnNames.includes('x');
  const hasY = columnNames.includes('y');
  const hasProjectionName = columnNames.includes('projection_name');
  if (!hasX || !hasY || !hasProjectionName) {
    throw new Error("Invalid bundle: expected columns 'projection_name', 'x', 'y'");
  }
  // Check numeric sanity for coordinates on a sample
  const sampleSize = Math.min(1000, rows.length);
  for (let i = 0; i < sampleSize; i++) {
    const r = rows[i] as Record<string, unknown>;
    const x = Number(r['x']);
    const y = Number(r['y']);
    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      throw new Error('Invalid coordinates detected in bundle data');
    }
  }
}
