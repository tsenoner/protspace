import type { Rows } from './types';
import { sanitizeForMessage } from '@protspace/utils';
import { MAX_POINTS_PER_PROJECTION } from '../../../utils/limits';

// Parquet magic bytes 'PAR1'
const PARQUET_MAGIC = new Uint8Array([0x50, 0x41, 0x52, 0x31]);

/**
 * Safety limits to avoid abusive inputs. Exported so callers and tests read the
 * same numbers the defaults below are built from.
 *
 * `maxRows`: projections_data is long-format — one row per (protein x
 * projection) — so capping ROWS at the per-projection POINT cap bounds
 * proteins-per-projection for any projection count >= 1, with no
 * distinct-protein scan, which matters because this runs before grouping.
 * Derived rather than duplicated so the loader and the renderer cannot disagree
 * again (#456); pinned by limits.invariant.test.ts.
 */
export const DEFAULT_VALIDATION_LIMITS = {
  maxFileSizeBytes: 500 * 1024 * 1024, // 500MB
  maxRows: MAX_POINTS_PER_PROJECTION,
  maxColumns: 200,
  maxTotalCells: 1_000_000_000,
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
    throw new Error(`File too large: ${(sizeBytes / (1024 * 1024)).toFixed(2)}MB exceeds limit`);
  }
}

export function validateRowsBasic(
  rows: unknown,
  {
    maxRows = DEFAULT_VALIDATION_LIMITS.maxRows,
    maxColumns = DEFAULT_VALIDATION_LIMITS.maxColumns,
    maxTotalCells = DEFAULT_VALIDATION_LIMITS.maxTotalCells,
    maxCellStringLength = DEFAULT_VALIDATION_LIMITS.maxCellStringLength,
  }: {
    maxRows?: number;
    maxColumns?: number;
    maxTotalCells?: number;
    maxCellStringLength?: number;
  } = {},
): asserts rows is Rows {
  if (!Array.isArray(rows)) {
    throw new Error('Parsed data is not an array of rows');
  }
  if (rows.length === 0) {
    throw new Error('No data rows found in file');
  }
  if (rows.length > maxRows) {
    // Name the limit and what it counts. The old message ("Too many rows: N
    // exceeds limit") gave the user an unexplained number, no limit, no
    // remediation — and the toast then offered a "Report this" bug-report
    // action for entirely intended behaviour.
    throw new Error(
      `Dataset too large: ${rows.length.toLocaleString()} rows exceeds the limit of ` +
        `${maxRows.toLocaleString()} (proteins x projections). Split the projections into ` +
        `separate bundles, or subset the dataset before bundling.`,
    );
  }
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
  const totalCells = rows.length * columnNames.length;
  if (totalCells > maxTotalCells) {
    throw new Error(`Dataset too large: ${totalCells} cells exceeds limit`);
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
