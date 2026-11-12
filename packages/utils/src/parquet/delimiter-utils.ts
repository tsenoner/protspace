/**
 * Utilities for finding and counting delimiters in parquetbundle files.
 * These are shared between the bundle reader (core) and bundle writer (utils).
 */

import { BUNDLE_DELIMITER, BUNDLE_DELIMITER_BYTES } from './constants';

/**
 * Boyer-Moore-Horspool shift per byte: how far the search window may advance when this
 * byte sits under the delimiter's last position without skipping a possible match.
 */
const DELIMITER_SHIFT = new Uint8Array(256).fill(BUNDLE_DELIMITER_BYTES.length);
for (let j = 0; j < BUNDLE_DELIMITER_BYTES.length - 1; j++) {
  DELIMITER_SHIFT[BUNDLE_DELIMITER_BYTES[j]] = BUNDLE_DELIMITER_BYTES.length - 1 - j;
}

/**
 * Find all positions of the bundle delimiter in a Uint8Array.
 *
 * A Horspool search: it reads about one byte per delimiter length instead of every byte,
 * which is ~10x faster on a large bundle. Overlapping matches are still all reported.
 *
 * @param uint8Array - The binary data to search
 * @param limit - Stop after this many matches (callers that only need "is there one"
 *   pass 1 and avoid a full pass over hundreds of MB)
 * @returns Array of byte positions where delimiters start
 */
export function findBundleDelimiterPositions(uint8Array: Uint8Array, limit = Infinity): number[] {
  const positions: number[] = [];
  const last = BUNDLE_DELIMITER_BYTES.length - 1;
  const lastByte = BUNDLE_DELIMITER_BYTES[last];

  for (let i = 0; i + last < uint8Array.length; ) {
    const tail = uint8Array[i + last];
    if (tail === lastByte) {
      let j = 0;
      while (j < last && uint8Array[i + j] === BUNDLE_DELIMITER_BYTES[j]) j++;
      if (j === last) {
        positions.push(i);
        if (positions.length >= limit) break;
      }
    }
    i += DELIMITER_SHIFT[tail];
  }

  return positions;
}

/**
 * Guard: a serialized part must not contain the bundle delimiter.
 *
 * The delimiter is in-band with no escaping, so a part whose bytes happen to
 * contain it would be split into two on read-back. Fail loudly at write time
 * rather than emit a bundle that decodes into the wrong shape.
 *
 * Mirrors `_check_no_delimiter` in the Python producer
 * (`apps/protspace/src/protspace/data/io/bundle.py`) — both sides must enforce
 * this or the format's invariants hold only in one direction.
 *
 * @param arrayBuffer - The serialized part to check
 * @param partName - Which part this is, so the message points at the offending data
 * @throws If the part contains the reserved delimiter byte string
 */
export function assertNoBundleDelimiter(arrayBuffer: ArrayBuffer, partName = 'parquet'): void {
  if (isParquetBundle(arrayBuffer)) {
    throw new Error(
      `Serialized ${partName} part contains the bundle delimiter "${BUNDLE_DELIMITER}"; ` +
        'a value includes this reserved byte string and would corrupt the bundle on read.',
    );
  }
}

/**
 * Check if an ArrayBuffer contains the bundle delimiter.
 *
 * @param arrayBuffer - The binary data to check
 * @returns true if at least one delimiter is found
 */
export function isParquetBundle(arrayBuffer: ArrayBuffer): boolean {
  const uint8Array = new Uint8Array(arrayBuffer);
  return findBundleDelimiterPositions(uint8Array, 1).length > 0;
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
