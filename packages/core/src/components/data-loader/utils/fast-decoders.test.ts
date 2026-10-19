import { describe, expect, it } from 'vitest';
import { snappyUncompress as hyparquetSnappy } from 'hyparquet';
import { snappyCompress } from 'hysnappy';
import { V3_COMPRESSORS, V3_PARSERS } from './fast-decoders';

const uncompress = V3_COMPRESSORS.SNAPPY!;
const stringFromBytes = V3_PARSERS.stringFromBytes!;

/** What hyparquet's own JS decoder makes of the page, or the error it throws. */
function reference(input: Uint8Array, outputLength: number): Uint8Array | Error {
  try {
    const output = new Uint8Array(outputLength);
    hyparquetSnappy(input, output);
    return output;
  } catch (error) {
    return error as Error;
  }
}

function attempt(input: Uint8Array, outputLength: number): Uint8Array | Error {
  try {
    return uncompress(input, outputLength);
  } catch (error) {
    return error as Error;
  }
}

/** Deterministic bytes over a small alphabet, so the compressor emits plenty of copies. */
function sample(length: number, alphabet: number, seed: number): Uint8Array {
  const bytes = new Uint8Array(length);
  let state = seed;
  for (let i = 0; i < length; i++) {
    state = (state * 1103515245 + 12345) & 0x7fffffff;
    bytes[i] = state % alphabet;
  }
  return bytes;
}

describe('V3_COMPRESSORS.SNAPPY', () => {
  it.each([
    ['an empty page', new Uint8Array(0)],
    ['a single byte', Uint8Array.of(7)],
    ['a run (overlapping copies)', new Uint8Array(5000).fill(0x41)],
    ['a short-period pattern', Uint8Array.from({ length: 4000 }, (_, i) => i % 3)],
    ['non-ASCII text', new TextEncoder().encode('Résumé ✓ 蛋白质 '.repeat(400))],
    ['a long incompressible literal', sample(70_000, 256, 1)],
    [
      'far back-references',
      (() => {
        const block = sample(3000, 256, 2);
        const bytes = new Uint8Array(140_000);
        for (let at = 0; at + block.length <= bytes.length; at += 70_000) bytes.set(block, at);
        return bytes;
      })(),
    ],
    [
      'little-endian floats',
      new Uint8Array(Float64Array.from({ length: 5000 }, (_, i) => i * 0.25).buffer),
    ],
  ])('decodes %s exactly as hyparquet does', (_label, raw) => {
    const compressed = snappyCompress(raw);
    const output = uncompress(compressed, raw.length);
    expect(output).toEqual(reference(compressed, raw.length));
    expect(output).toEqual(raw);
  });

  it('decodes a hand-written stream whose copy overlaps its own output', () => {
    // Header 10, literal "ab", then a 1-byte-offset copy of 8 bytes at offset 2.
    const stream = Uint8Array.of(10, 0x04, 0x61, 0x62, 0x11, 0x02);
    expect(new TextDecoder().decode(uncompress(stream, 10))).toBe('ababababab');
    expect(uncompress(stream, 10)).toEqual(reference(stream, 10));
  });

  it('rejects a page whose declared size disagrees with the stream', () => {
    const compressed = snappyCompress(sample(300, 4, 3));
    for (const outputLength of [298, 299, 301, 302]) {
      expect(reference(compressed, outputLength)).toBeInstanceOf(Error);
      expect(() => uncompress(compressed, outputLength)).toThrow('premature end of input');
    }
  });

  it('never accepts a corrupted page that hyparquet rejects, nor decodes one differently', () => {
    for (let seed = 1; seed <= 2000; seed++) {
      const raw = sample(1 + (seed % 300), 1 + (seed % 8), seed);
      const compressed = snappyCompress(raw).slice();
      const at = seed % compressed.length;
      compressed[at] ^= 1 << (seed % 8);
      const page = seed % 3 === 0 ? compressed.subarray(0, at) : compressed;
      const expected = reference(page, raw.length);
      const actual = attempt(page, raw.length);
      if (expected instanceof Error) expect(actual).toBeInstanceOf(Error);
      else if (!(actual instanceof Error)) expect(actual).toEqual(expected);
    }
  });

  it('keeps decoding correctly after a page large enough to drop the instance', () => {
    const large = new Uint8Array(9 * 1024 * 1024).fill(0x5a);
    large.set(sample(4096, 256, 4));
    const small = sample(1000, 4, 5);
    const decoded = uncompress(snappyCompress(large), large.length);
    // A byte loop: deep equality over 9 MB is far slower than the decode itself.
    expect(decoded.length === large.length && decoded.every((byte, i) => byte === large[i])).toBe(
      true,
    );
    expect(uncompress(snappyCompress(small), small.length)).toEqual(small);
  });
});

describe('V3_PARSERS.stringFromBytes', () => {
  // hyparquet's default parser, which the fast path must match value for value.
  const hyparquetString = (bytes: Uint8Array) => bytes && new TextDecoder().decode(bytes);
  const bytesOf = (...values: number[]) => Uint8Array.from(values);

  it.each([
    ['an empty value', new Uint8Array(0)],
    ['an ASCII id', new TextEncoder().encode('A0A023GPI8')],
    ['ASCII control and edge bytes', bytesOf(0, 9, 10, 0x7f)],
    ['two-byte UTF-8', new TextEncoder().encode('Résumé')],
    ['CJK and emoji', new TextEncoder().encode('蛋白质 🧬')],
    ['a leading BOM, which hyparquet drops', new TextEncoder().encode('\uFEFFlabel')],
    ['invalid UTF-8', bytesOf(0x61, 0xff, 0x62, 0xc3)],
    ['non-ASCII as the last byte', bytesOf(0x61, 0x62, 0xe9)],
    ['a long ASCII value', new TextEncoder().encode('x'.repeat(5000))],
    ['a long non-ASCII value', new TextEncoder().encode('é'.repeat(3000))],
    ['a subarray view', new TextEncoder().encode('__P12345__').subarray(2, 8)],
  ])('decodes %s exactly as hyparquet does', (_label, bytes) => {
    expect(stringFromBytes(bytes)).toBe(hyparquetString(bytes));
  });

  it('passes a missing value through', () => {
    expect(stringFromBytes(undefined as unknown as Uint8Array)).toBeUndefined();
  });

  it('matches hyparquet on every single byte value', () => {
    for (let byte = 0; byte < 256; byte++) {
      const bytes = bytesOf(0x41, byte, 0x42);
      expect(stringFromBytes(bytes)).toBe(hyparquetString(bytes));
    }
  });
});
