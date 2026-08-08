import { describe, it, expect } from 'vitest';
import {
  computeSearchSuggestions,
  MAX_SEARCH_SUGGESTIONS,
  MAX_SELECTED_SUGGESTIONS,
  type SearchSuggestion,
} from './search-suggestions';

/** Entry IDs in output order — for assertions that only care about ordering. */
const idsOf = (result: SearchSuggestion[]): string[] => result.map((entry) => entry.id);

/** Entry IDs that are marked as already selected. */
const selectedIdsOf = (result: SearchSuggestion[]): string[] =>
  result.filter((entry) => entry.isSelected).map((entry) => entry.id);

/** Entry IDs that are addable. */
const selectableIdsOf = (result: SearchSuggestion[]): string[] =>
  result.filter((entry) => !entry.isSelected).map((entry) => entry.id);

/**
 * An ID array that counts how many entries the scan actually reads, so the early exit can
 * be pinned by iteration count rather than by wall-clock timing. Only numeric index reads
 * are counted — `.length` and other property access are not part of the scan.
 */
function countingIds(length: number): { ids: readonly string[]; reads: () => number } {
  const backing = Array.from({ length }, (_, i) => `P${String(i).padStart(6, '0')}`);
  let reads = 0;
  const ids = new Proxy(backing, {
    get(target, prop) {
      if (typeof prop === 'string' && /^[0-9]+$/.test(prop)) reads++;
      return Reflect.get(target, prop);
    },
  }) as readonly string[];
  return { ids, reads: () => reads };
}

describe('computeSearchSuggestions', () => {
  describe('empty query + focused', () => {
    it('returns entries capped at the default selectable limit', () => {
      const ids = Array.from({ length: 200 }, (_, i) => `P${String(i).padStart(5, '0')}`);
      const result = computeSearchSuggestions(ids, [], '', true);
      expect(result).toHaveLength(MAX_SEARCH_SUGGESTIONS);
      expect(idsOf(result)).toEqual(ids.slice(0, MAX_SEARCH_SUGGESTIONS));
      expect(result.every((entry) => entry.isSelected === false)).toBe(true);
    });

    it('returns the first limit IDs in order', () => {
      const ids = ['A1', 'A2', 'A3', 'A4', 'A5'];
      const result = computeSearchSuggestions(ids, [], '', true, 3);
      expect(idsOf(result)).toEqual(['A1', 'A2', 'A3']);
    });

    it('surfaces current selections alongside selectable IDs', () => {
      const ids = ['A1', 'A2', 'A3', 'A4', 'A5'];
      const result = computeSearchSuggestions(ids, ['A1', 'A3'], '', true, 3);
      expect(idsOf(result)).toEqual(['A1', 'A2', 'A3', 'A4', 'A5']);
      expect(selectedIdsOf(result)).toEqual(['A1', 'A3']);
      expect(selectableIdsOf(result)).toEqual(['A2', 'A4', 'A5']);
    });
  });

  describe('empty query + NOT focused', () => {
    it('returns empty array', () => {
      const ids = ['P12345', 'P23456', 'P34567'];
      expect(computeSearchSuggestions(ids, [], '', false)).toEqual([]);
    });

    it('returns empty array even when IDs are selected', () => {
      const ids = Array.from({ length: 100 }, (_, i) => `P${i}`);
      expect(computeSearchSuggestions(ids, ['P1'], '', false)).toEqual([]);
    });
  });

  describe('non-empty prefix query', () => {
    it('returns only IDs starting with the query, case-insensitively', () => {
      const ids = ['P12345', 'P23456', 'P34567', 'Q12345', 'Q23456'];
      const result = computeSearchSuggestions(ids, [], 'p', true);
      expect(idsOf(result)).toEqual(['P12345', 'P23456', 'P34567']);
    });

    it('caps selectable results at the limit when there are many matches', () => {
      const ids = Array.from({ length: 200 }, (_, i) => `P${String(i).padStart(5, '0')}`);
      const result = computeSearchSuggestions(ids, [], 'p', true);
      expect(result).toHaveLength(MAX_SEARCH_SUGGESTIONS);
    });

    it('returns all matches when fewer than the limit', () => {
      const ids = ['P12345', 'P23456', 'Q99999'];
      const result = computeSearchSuggestions(ids, [], 'p', true);
      expect(idsOf(result)).toEqual(['P12345', 'P23456']);
    });
  });

  describe('case-insensitivity', () => {
    it('matches lowercase query against uppercase IDs', () => {
      const result = computeSearchSuggestions(['P12345', 'P23456', 'Q12345'], [], 'p12', true);
      expect(idsOf(result)).toEqual(['P12345']);
    });

    it('matches uppercase query against lowercase IDs', () => {
      const result = computeSearchSuggestions(['p12345', 'p23456', 'q12345'], [], 'P12', true);
      expect(idsOf(result)).toEqual(['p12345']);
    });

    it('marks a case-insensitively matched selected ID', () => {
      const result = computeSearchSuggestions(['P00595', 'Q12345'], ['P00595'], 'p00595', true);
      expect(result).toEqual([{ id: 'P00595', isSelected: true }]);
    });
  });

  describe('includes already-selected IDs as marked', () => {
    it('marks selected IDs given as an array instead of dropping them', () => {
      const ids = ['P12345', 'P23456', 'P34567'];
      const result = computeSearchSuggestions(ids, ['P12345', 'P23456'], 'p', true);
      expect(result).toEqual([
        { id: 'P12345', isSelected: true },
        { id: 'P23456', isSelected: true },
        { id: 'P34567', isSelected: false },
      ]);
    });

    it('marks selected IDs given as a Set', () => {
      const ids = ['P12345', 'P23456', 'P34567'];
      const result = computeSearchSuggestions(ids, new Set(['P12345', 'P23456']), 'p', true);
      expect(selectedIdsOf(result)).toEqual(['P12345', 'P23456']);
    });

    it('returns every match marked when all prefix matches are selected', () => {
      const ids = ['P00595', 'P00596', 'P00597', 'P00598', 'P00599', 'Q12345'];
      const selected = ['P00595', 'P00596', 'P00597', 'P00598', 'P00599'];
      const result = computeSearchSuggestions(ids, selected, 'P0059', true);
      expect(result).toHaveLength(5);
      expect(result.every((entry) => entry.isSelected)).toBe(true);
    });

    it('keeps a selected ID visible when it is a strict prefix of unselected IDs', () => {
      const ids = ['GT4', 'GT40', 'GT41', 'GT42'];
      const result = computeSearchSuggestions(ids, ['GT4'], 'GT4', true);
      expect(result).toEqual([
        { id: 'GT4', isSelected: true },
        { id: 'GT40', isSelected: false },
        { id: 'GT41', isSelected: false },
        { id: 'GT42', isSelected: false },
      ]);
    });

    it('returns an empty array when nothing prefix-matches', () => {
      const ids = ['P12345', 'Q23456'];
      expect(computeSearchSuggestions(ids, ['P12345'], 'zzz', true)).toEqual([]);
    });
  });

  describe('independent budgets', () => {
    it('caps selected entries at the selected limit', () => {
      const ids = Array.from({ length: 40 }, (_, i) => `A${String(i).padStart(3, '0')}`);
      const result = computeSearchSuggestions(ids, ids, 'a', true);
      expect(result).toHaveLength(MAX_SELECTED_SUGGESTIONS);
      expect(result.every((entry) => entry.isSelected)).toBe(true);
    });

    it('still surfaces selectable entries when selected matches exceed their budget', () => {
      const selected = Array.from({ length: 80 }, (_, i) => `A${String(i).padStart(3, '0')}`);
      const selectable = Array.from(
        { length: 20 },
        (_, i) => `A${String(i + 800).padStart(3, '0')}`,
      );
      const result = computeSearchSuggestions([...selected, ...selectable], selected, 'a', true);
      expect(selectedIdsOf(result)).toHaveLength(MAX_SELECTED_SUGGESTIONS);
      expect(selectableIdsOf(result)).toEqual(selectable);
    });

    it('respects custom limits for both budgets', () => {
      const ids = ['S1', 'S2', 'S3', 'U1', 'U2', 'U3'];
      const result = computeSearchSuggestions(ids, ['S1', 'S2', 'S3'], '', true, 2, 1);
      expect(selectedIdsOf(result)).toEqual(['S1']);
      expect(selectableIdsOf(result)).toEqual(['U1', 'U2']);
    });

    it('preserves natural array order across mixed selected and unselected runs', () => {
      const ids = ['A1', 'A2', 'A3', 'A4'];
      const result = computeSearchSuggestions(ids, ['A2', 'A4'], 'a', true);
      expect(idsOf(result)).toEqual(['A1', 'A2', 'A3', 'A4']);
    });
  });

  describe('custom limit param', () => {
    it('respects a custom selectable limit of 1', () => {
      const result = computeSearchSuggestions(['P12345', 'P23456', 'P34567'], [], 'p', true, 1);
      expect(idsOf(result)).toEqual(['P12345']);
    });

    it('respects a custom limit larger than available matches', () => {
      const result = computeSearchSuggestions(['P12345', 'P23456'], [], 'p', true, 100);
      expect(idsOf(result)).toEqual(['P12345', 'P23456']);
    });
  });

  describe('large input (early-exit proof)', () => {
    it('returns exactly the selectable limit for a 100K array with empty query + focus', () => {
      const ids = Array.from({ length: 100_000 }, (_, i) => `P${String(i).padStart(6, '0')}`);
      const result = computeSearchSuggestions(ids, [], '', true);
      expect(result).toHaveLength(MAX_SEARCH_SUGGESTIONS);
      expect(idsOf(result)).toEqual(ids.slice(0, MAX_SEARCH_SUGGESTIONS));
    });

    it('exits early once both budgets are full on a 100K array', () => {
      const ids = Array.from({ length: 100_000 }, (_, i) => `P${String(i).padStart(6, '0')}`);
      const selected = ids.slice(0, 500);
      const result = computeSearchSuggestions(ids, selected, 'p', true);
      expect(selectedIdsOf(result)).toHaveLength(MAX_SELECTED_SUGGESTIONS);
      expect(selectableIdsOf(result)).toHaveLength(MAX_SEARCH_SUGGESTIONS);
    });

    it('stops scanning once the selectable budget is full and selections are exhausted', () => {
      const { ids, reads } = countingIds(100_000);

      const result = computeSearchSuggestions(ids, ['P000002'], '', true);

      expect(result).toHaveLength(MAX_SEARCH_SUGGESTIONS + 1);
      expect(reads()).toBeLessThan(100);
    });

    it('stops scanning with no selections at all', () => {
      const { ids, reads } = countingIds(100_000);

      computeSearchSuggestions(ids, [], 'p', true);

      expect(reads()).toBeLessThan(100);
    });
  });

  describe('prefix-only (startsWith), NOT substring', () => {
    it('matches prefix but not infix', () => {
      const result = computeSearchSuggestions(['ABC', 'XABC'], [], 'abc', true);
      expect(idsOf(result)).toEqual(['ABC']);
    });

    it('does not match mid-string occurrence', () => {
      const result = computeSearchSuggestions(['ABC123', 'XYZ123', 'ABC456'], [], '123', true);
      expect(result).toEqual([]);
    });
  });
});
