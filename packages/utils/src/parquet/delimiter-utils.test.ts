import { describe, it, expect } from 'vitest';
import { findBundleDelimiterPositions } from './delimiter-utils';
import { BUNDLE_DELIMITER_BYTES } from './constants';

/** The byte-by-byte scan the Horspool search replaced: every offset, in order. */
function naivePositions(bytes: Uint8Array, limit = Infinity): number[] {
  const positions: number[] = [];
  const len = BUNDLE_DELIMITER_BYTES.length;
  for (let i = 0; i <= bytes.length - len; i++) {
    let j = 0;
    while (j < len && bytes[i + j] === BUNDLE_DELIMITER_BYTES[j]) j++;
    if (j === len) {
      positions.push(i);
      if (positions.length >= limit) break;
    }
  }
  return positions;
}

const encode = (text: string) => new TextEncoder().encode(text);
const DELIMITER = new TextDecoder().decode(BUNDLE_DELIMITER_BYTES);

/** Deterministic noise drawn from the delimiter's own bytes, so near-misses are common. */
function noise(length: number, seed: number): Uint8Array {
  const bytes = new Uint8Array(length);
  let state = seed;
  for (let i = 0; i < length; i++) {
    state = (state * 1103515245 + 12345) & 0x7fffffff;
    bytes[i] =
      state % 4 === 0
        ? state & 0xff
        : BUNDLE_DELIMITER_BYTES[state % BUNDLE_DELIMITER_BYTES.length];
  }
  return bytes;
}

describe('findBundleDelimiterPositions', () => {
  it.each([
    ['empty input', ''],
    ['shorter than the delimiter', DELIMITER.slice(1)],
    ['exactly the delimiter', DELIMITER],
    ['delimiter at both ends', `${DELIMITER}abc${DELIMITER}`],
    ['delimiter truncated at the end', `abc${DELIMITER.slice(0, -1)}`],
    ['adjacent delimiters', `${DELIMITER}${DELIMITER}`],
    ['overlapping delimiters', `${DELIMITER}${DELIMITER.slice(3)}`],
    ['near-misses around a match', `-${DELIMITER.slice(0, -1)}x${DELIMITER}--`],
    ['non-ASCII neighbours', `é${DELIMITER}ü${DELIMITER}✓`],
  ])('matches the byte-by-byte scan: %s', (_label, text) => {
    const bytes = encode(text);
    expect(findBundleDelimiterPositions(bytes)).toEqual(naivePositions(bytes));
  });

  it('reports overlapping occurrences', () => {
    const bytes = encode(`${DELIMITER}${DELIMITER.slice(3)}`);
    expect(findBundleDelimiterPositions(bytes)).toEqual([0, DELIMITER.length - 3]);
  });

  it('matches the byte-by-byte scan on noisy buffers with planted delimiters', () => {
    for (let seed = 1; seed <= 200; seed++) {
      const bytes = noise(64 + seed * 7, seed);
      for (let k = 0; k < seed % 4; k++) {
        const at = (seed * 31 * (k + 1)) % (bytes.length - BUNDLE_DELIMITER_BYTES.length + 1);
        bytes.set(BUNDLE_DELIMITER_BYTES, at);
      }
      expect(findBundleDelimiterPositions(bytes)).toEqual(naivePositions(bytes));
    }
  });

  it('stops after `limit` matches', () => {
    const bytes = encode(`${DELIMITER}a${DELIMITER}b${DELIMITER}`);
    expect(findBundleDelimiterPositions(bytes, 2)).toEqual(naivePositions(bytes, 2));
    expect(findBundleDelimiterPositions(bytes, 2)).toHaveLength(2);
  });

  it('searches a subarray view from its own start', () => {
    const backing = encode(`xx${DELIMITER}yy`);
    expect(findBundleDelimiterPositions(backing.subarray(1))).toEqual([1]);
  });
});
