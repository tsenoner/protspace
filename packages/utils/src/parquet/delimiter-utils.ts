/**
 * Utilities for finding and counting delimiters in parquetbundle files.
 * These are shared between the bundle reader (core) and bundle writer (utils).
 */

import { BUNDLE_DELIMITER_BYTES } from './constants';

/**
 * Find all positions of the bundle delimiter in a Uint8Array.
 *
 * @param uint8Array - The binary data to search
 * @returns Array of byte positions where delimiters start
 */
export function findBundleDelimiterPositions(uint8Array: Uint8Array): number[] {
  const positions: number[] = [];
  const len = BUNDLE_DELIMITER_BYTES.length;

  for (let i = 0; i <= uint8Array.length - len; i++) {
    let match = true;
    for (let j = 0; j < len; j++) {
      if (uint8Array[i + j] !== BUNDLE_DELIMITER_BYTES[j]) {
        match = false;
        break;
      }
    }
    if (match) positions.push(i);
  }

  return positions;
}

/**
 * Check if an ArrayBuffer contains the bundle delimiter.
 *
 * @param arrayBuffer - The binary data to check
 * @returns true if at least one delimiter is found
 */
export function isParquetBundle(arrayBuffer: ArrayBuffer): boolean {
  const uint8Array = new Uint8Array(arrayBuffer);
  return findBundleDelimiterPositions(uint8Array).length > 0;
}

/**
 * Count the number of delimiters in a Uint8Array.
 * Useful for validating bundle structure in tests.
 *
 * @param uint8Array - The binary data to search
 * @returns Number of delimiters found
 */
export function countBundleDelimiters(uint8Array: Uint8Array): number {
  return findBundleDelimiterPositions(uint8Array).length;
}

/**
 * Split a parquetbundle byte array into its delimiter-separated parts.
 *
 * For N delimiter positions this yields N + 1 parts. Part `i` spans
 * `[partStart(i), partEnd(i))` where:
 *  - the first part starts at byte 0,
 *  - each subsequent part starts right after the previous delimiter,
 *  - the last part ends at `uint8Array.length`,
 *  - every other part ends at the position of its following delimiter.
 *
 * Two adjacent delimiters (no bytes between them) correctly yield a
 * zero-length part — used by the bundle format to represent an empty
 * settings slot when statistics are present without settings.
 *
 * The returned parts are `subarray` views into `uint8Array` (zero-copy).
 * Callers that need an owned, detachable buffer (e.g. to pass to a parser
 * that takes an `ArrayBuffer`) must copy explicitly, e.g. `part.slice().buffer`.
 *
 * @param uint8Array - The binary data to split
 * @param positions - Delimiter positions; defaults to
 *   `findBundleDelimiterPositions(uint8Array)` when omitted
 * @returns One `Uint8Array` view per part (`positions.length + 1` parts)
 */
export function splitBundleParts(
  uint8Array: Uint8Array,
  positions: number[] = findBundleDelimiterPositions(uint8Array),
): Uint8Array[] {
  const delimLen = BUNDLE_DELIMITER_BYTES.length;
  const partStart = (i: number): number => (i === 0 ? 0 : positions[i - 1] + delimLen);
  const partEnd = (i: number): number => (i < positions.length ? positions[i] : uint8Array.length);

  const parts: Uint8Array[] = [];
  for (let i = 0; i <= positions.length; i++) {
    parts.push(uint8Array.subarray(partStart(i), partEnd(i)));
  }
  return parts;
}
