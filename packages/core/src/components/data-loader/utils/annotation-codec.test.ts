import { describe, it, expect } from 'vitest';
import { encodeField, decodeField } from './annotation-codec';

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
    expect(decodeField(encodeField(raw))).toBe(raw);
  });
  it('encodes only the reserved set', () => {
    expect(encodeField('a,b(c):d/e')).toBe('a,b(c):d/e');
    expect(encodeField('a;b|c%d')).toBe('a%3Bb%7Cc%25d');
    expect(encodeField('x\ty')).toBe('x%09y');
  });
  it('decode is a no-op on plain text', () => {
    expect(decodeField('plain (parens), commas')).toBe('plain (parens), commas');
  });
});
