import { describe, it, expect } from 'vitest';
import { decodeField } from './annotation-codec';

// The only production encoder is Python's `encode_field` (encoding.py): the web exporter
// writes v3, whose labels are stored decoded. This reference copy of its rule, pinned by
// the literal cases below, is what the round trips pair `decodeField` with.
const encodeAnnotationField = (value: string): string =>
  value.replace(
    /[;|%\x00-\x1F\x7F]/g,
    (character) => `%${character.charCodeAt(0).toString(16).toUpperCase().padStart(2, '0')}`,
  );

describe('annotation codec (v2)', () => {
  const cases = [
    '',
    '7tm_1',
    'Acting on peptide bonds (peptidases)', // parens NOT encoded
    'Ribosomal Protein L15; Chain: K; domain 2',
    'YojJ-like (1',
    'weird|pipe and 50% and %3B literal',
    'tab\tnl\ncr\r',
    'Kinase, ATP-binding', // comma stays
    'Café ĸμ 名前',
  ];
  it.each(cases)('round-trips %j', (raw) => {
    expect(decodeField(encodeAnnotationField(raw))).toBe(raw);
  });
  it('encodes only the reserved set', () => {
    expect(encodeAnnotationField('a,b(c):d/e')).toBe('a,b(c):d/e');
    expect(encodeAnnotationField('a;b|c%d')).toBe('a%3Bb%7Cc%25d');
    expect(encodeAnnotationField('x\ty')).toBe('x%09y');
  });
  it('decode is a no-op on plain text', () => {
    expect(decodeField('plain (parens), commas')).toBe('plain (parens), commas');
  });
});
