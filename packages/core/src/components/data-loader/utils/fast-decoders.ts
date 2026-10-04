/**
 * A drop-in replacement for hyparquet's snappy decoder on the v3 read path, giving the
 * same output as hyparquet's own for every valid page.
 */

import type { Compressors } from 'hyparquet';
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
