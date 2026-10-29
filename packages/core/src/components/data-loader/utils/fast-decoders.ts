/**
 * Drop-in replacements for two of hyparquet's per-value decoders on the v3 read path,
 * each giving the same output as hyparquet's own for every valid input.
 */

import type { Compressors, ParquetParsers } from 'hyparquet';
import { snappyUncompressor } from 'hysnappy';

/**
 * Pages past this size grow the wasm memory to fit them, and wasm memory never shrinks,
 * so the instance is dropped after such a page rather than pinning that much for good.
 */
const RETAINED_PAGE_BYTES = 8 * 1024 * 1024;

let uncompress: ReturnType<typeof snappyUncompressor> | null = null;

/**
 * Snappy page decompression through hysnappy's wasm decoder, about twice as fast as the
 * JS decoder hyparquet bundles.
 *
 * hysnappy sizes its output from the stream's own length header, so a header that
 * disagrees with the page's declared size would come back truncated instead of
 * failing. That check is made here, with the error hyparquet's decoder gives for it.
 */
function snappyUncompress(input: Uint8Array, outputLength: number): Uint8Array {
  let declared = 0;
  for (let pos = 0, shift = 0; pos < input.length && shift < 35; pos++, shift += 7) {
    declared += (input[pos] & 0x7f) * 2 ** shift;
    if (input[pos] < 0x80) break;
  }
  if (declared !== outputLength) throw new Error('premature end of input');

  // A page that fails, or grows the memory past the cap, leaves a fresh instance for the next.
  const instance = uncompress ?? snappyUncompressor();
  uncompress = null;
  const output = instance(input, outputLength);
  if (input.byteLength + outputLength <= RETAINED_PAGE_BYTES) uncompress = instance;
  return output;
}

/** hyparquet `compressors` option for the v3 parts, all of which are snappy. */
export const V3_COMPRESSORS: Compressors = { SNAPPY: snappyUncompress };

// Configured like hyparquet's own decoder (a leading BOM is dropped), so a non-ASCII
// value decodes exactly as it did before.
const UTF8 = new TextDecoder();

/** Longest value spread into one `String.fromCharCode` call, well inside argument limits. */
const MAX_CHAR_CODE_ARGS = 1024;

/**
 * hyparquet's `stringFromBytes` with an ASCII fast path. A `TextDecoder` call per value
 * dominates a string column of short ids (~5x slower in Chrome on 573K of them), while
 * for ASCII bytes the char codes are the bytes themselves.
 */
function stringFromBytes(bytes: Uint8Array | undefined): string | undefined {
  if (!bytes) return bytes;
  if (bytes.length > MAX_CHAR_CODE_ARGS) return UTF8.decode(bytes);
  for (let i = 0; i < bytes.length; i++) {
    if (bytes[i] > 0x7f) return UTF8.decode(bytes);
  }
  return String.fromCharCode.apply(null, bytes as unknown as number[]);
}

/** hyparquet `parsers` option for the v3 parts. */
export const V3_PARSERS: Partial<ParquetParsers> = { stringFromBytes };
