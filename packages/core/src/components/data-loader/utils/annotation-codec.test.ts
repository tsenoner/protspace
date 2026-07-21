import { describe, it, expect } from 'vitest';
import { encodeAnnotationField } from '@protspace/utils';
import { decodeField } from './annotation-codec';

// The encoder is the single production one in `@protspace/utils`
// (`encodeAnnotationField`); `decodeField` here is its read-path partner. Pairing
// them in these round-trips guards the actual cross-package write→read contract.
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
