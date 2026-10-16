import { describe, expect, it } from 'vitest';
import {
  REPORT_MISSING_LIMIT,
  lowerCaseIndex,
  parsePastedIds,
  resolveProteinIds,
} from './resolve-ids';

describe('parsePastedIds', () => {
  it('splits on whitespace, commas, semicolons and newlines, and drops empties', () => {
    expect(parsePastedIds(' P1, P2;P3\nP4\tP5\r\n ;; ,')).toEqual(['P1', 'P2', 'P3', 'P4', 'P5']);
    expect(parsePastedIds('   ')).toEqual([]);
  });

  it('dedupes in order, by exact spelling', () => {
    expect(parsePastedIds('P2 P1 P2 p1')).toEqual(['P2', 'P1', 'p1']);
  });
});

describe('resolveProteinIds', () => {
  const available = ['P00595', 'Q12345', 'A0JMF6'];

  it('splits tokens into found, already selected and missing', () => {
    expect(resolveProteinIds(['P00595', 'Q12345', 'NOPE'], available, ['Q12345'])).toEqual({
      found: ['P00595'],
      alreadySelected: ['Q12345'],
      missing: ['NOPE'],
    });
  });

  it('resolves case-insensitively to the dataset’s spelling, once per protein', () => {
    expect(resolveProteinIds(['p00595', 'P00595', 'a0jmf6'], available, [])).toEqual({
      found: ['P00595', 'A0JMF6'],
      alreadySelected: [],
      missing: [],
    });
  });

  it('the index is reused for the same array and rebuilt for a new one', () => {
    const ids = ['P1', 'P2', 'P3'];
    expect(lowerCaseIndex(ids)).toBe(lowerCaseIndex(ids));
    expect(lowerCaseIndex([...ids])).not.toBe(lowerCaseIndex(ids));
    expect(lowerCaseIndex(ids).get('p2')).toBe('P2');
  });

  it('resolves 10,000 tokens against 50,000 ids in well under a second (a coarse guard against a quadratic resolve)', () => {
    const ids = Array.from({ length: 50_000 }, (_, i) => `P${String(i).padStart(6, '0')}`);
    const tokens = Array.from({ length: 10_000 }, (_, i) =>
      i % 3 === 0 ? `MISSING${i}` : i % 3 === 1 ? ids[i * 4] : ids[i * 4].toLowerCase(),
    );
    const selected = ids.slice(0, 5_000);

    const start = performance.now();
    const result = resolveProteinIds(tokens, ids, selected);
    const elapsed = performance.now() - start;

    expect(result.found.length + result.alreadySelected.length + result.missing.length).toBe(
      10_000,
    );
    expect(elapsed).toBeLessThan(1_000);
  });

  it('caps the report at 50 missing IDs', () => {
    expect(REPORT_MISSING_LIMIT).toBe(50);
  });
});
