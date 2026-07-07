import { describe, it, expect } from 'vitest';
import {
  findBundleDelimiterPositions,
  countBundleDelimiters,
  splitBundleParts,
} from './delimiter-utils';
import { BUNDLE_DELIMITER_BYTES } from './constants';

function textPart(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

function assemble(parts: Uint8Array[]): Uint8Array {
  let total = 0;
  parts.forEach((p, i) => {
    total += p.length + (i < parts.length - 1 ? BUNDLE_DELIMITER_BYTES.length : 0);
  });
  const out = new Uint8Array(total);
  let offset = 0;
  parts.forEach((p, i) => {
    out.set(p, offset);
    offset += p.length;
    if (i < parts.length - 1) {
      out.set(BUNDLE_DELIMITER_BYTES, offset);
      offset += BUNDLE_DELIMITER_BYTES.length;
    }
  });
  return out;
}

function toStrings(parts: Uint8Array[]): string[] {
  return parts.map((p) => new TextDecoder().decode(p));
}

describe('splitBundleParts', () => {
  it('splits a 3-part bundle (2 delimiters) into 3 parts', () => {
    const original = [textPart('core-a'), textPart('core-b'), textPart('core-c')];
    const bundle = assemble(original);

    const parts = splitBundleParts(bundle);

    expect(parts.length).toBe(3);
    expect(toStrings(parts)).toEqual(['core-a', 'core-b', 'core-c']);
  });

  it('splits a 4-part bundle (3 delimiters) into 4 parts', () => {
    const original = [
      textPart('core-a'),
      textPart('core-b'),
      textPart('core-c'),
      textPart('settings'),
    ];
    const bundle = assemble(original);

    const parts = splitBundleParts(bundle);

    expect(parts.length).toBe(4);
    expect(toStrings(parts)).toEqual(['core-a', 'core-b', 'core-c', 'settings']);
  });

  it('splits a 5-part bundle (4 delimiters) into 5 parts', () => {
    const original = [
      textPart('core-a'),
      textPart('core-b'),
      textPart('core-c'),
      textPart('settings'),
      textPart('statistics'),
    ];
    const bundle = assemble(original);

    const parts = splitBundleParts(bundle);

    expect(parts.length).toBe(5);
    expect(toStrings(parts)).toEqual(['core-a', 'core-b', 'core-c', 'settings', 'statistics']);
  });

  it('yields a zero-length part for an empty settings slot between two delimiters', () => {
    // Simulates a 5-part bundle where the settings slot (index 3) is a
    // zero-byte placeholder because statistics are present without settings.
    const original = [
      textPart('core-a'),
      textPart('core-b'),
      textPart('core-c'),
      new Uint8Array(0),
      textPart('statistics'),
    ];
    const bundle = assemble(original);

    const parts = splitBundleParts(bundle);

    expect(parts.length).toBe(5);
    expect(parts[3].byteLength).toBe(0);
    expect(toStrings(parts)).toEqual(['core-a', 'core-b', 'core-c', '', 'statistics']);
  });

  it('returns subarray views (zero-copy) that share the source buffer', () => {
    const original = [textPart('core-a'), textPart('core-b'), textPart('core-c')];
    const bundle = assemble(original);

    const parts = splitBundleParts(bundle);

    // A `subarray` view shares the underlying ArrayBuffer with the source.
    expect(parts[0].buffer).toBe(bundle.buffer);
    // Mutating the source is visible through the view (proves no copy occurred).
    const before = parts[1][0];
    bundle[parts[1].byteOffset] = (before + 1) % 256;
    expect(parts[1][0]).toBe((before + 1) % 256);
  });

  it('accepts precomputed positions and matches the default (self-derived) result', () => {
    const original = [textPart('core-a'), textPart('core-b'), textPart('core-c')];
    const bundle = assemble(original);
    const positions = findBundleDelimiterPositions(bundle);

    const withPositions = splitBundleParts(bundle, positions);
    const withoutPositions = splitBundleParts(bundle);

    expect(toStrings(withPositions)).toEqual(toStrings(withoutPositions));
  });

  it('produces (delimiter count + 1) parts, matching countBundleDelimiters', () => {
    const original = [
      textPart('core-a'),
      textPart('core-b'),
      textPart('core-c'),
      textPart('settings'),
      textPart('statistics'),
    ];
    const bundle = assemble(original);

    const parts = splitBundleParts(bundle);

    expect(parts.length).toBe(countBundleDelimiters(bundle) + 1);
  });

  it('returns a single part spanning the whole array when there are no delimiters', () => {
    const bundle = textPart('no-delimiters-here');

    const parts = splitBundleParts(bundle);

    expect(parts.length).toBe(1);
    expect(toStrings(parts)).toEqual(['no-delimiters-here']);
  });
});
