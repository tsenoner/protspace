import { describe, it, expect } from 'vitest';
import { computeSearchSuggestions, MAX_SEARCH_SUGGESTIONS } from './search-suggestions';

describe('computeSearchSuggestions', () => {
  describe('empty query + focused', () => {
    it('returns unselected IDs capped at default limit', () => {
      const ids = Array.from({ length: 200 }, (_, i) => `P${String(i).padStart(5, '0')}`);
      const result = computeSearchSuggestions(ids, [], '', true);
      expect(result).toHaveLength(MAX_SEARCH_SUGGESTIONS);
      expect(result).toEqual(ids.slice(0, MAX_SEARCH_SUGGESTIONS));
    });

    it('returns first limit unselected IDs in order', () => {
      const ids = ['A1', 'A2', 'A3', 'A4', 'A5'];
      const result = computeSearchSuggestions(ids, [], '', true, 3);
      expect(result).toEqual(['A1', 'A2', 'A3']);
    });

    it('skips selected IDs and fills up to limit from remaining', () => {
      const ids = ['A1', 'A2', 'A3', 'A4', 'A5'];
      const result = computeSearchSuggestions(ids, ['A1', 'A3'], '', true, 3);
      expect(result).toEqual(['A2', 'A4', 'A5']);
    });
  });

  describe('empty query + NOT focused', () => {
    it('returns empty array', () => {
      const ids = ['P12345', 'P23456', 'P34567'];
      const result = computeSearchSuggestions(ids, [], '', false);
      expect(result).toEqual([]);
    });

    it('returns empty array even when IDs exist', () => {
      const ids = Array.from({ length: 100 }, (_, i) => `P${i}`);
      const result = computeSearchSuggestions(ids, [], '', false);
      expect(result).toEqual([]);
    });
  });

  describe('non-empty prefix query', () => {
    it('returns only IDs starting with the query (case-insensitive), excluding selected, capped', () => {
      const ids = ['P12345', 'P23456', 'P34567', 'Q12345', 'Q23456'];
      const result = computeSearchSuggestions(ids, [], 'p', true);
      expect(result).toEqual(['P12345', 'P23456', 'P34567']);
    });

    it('caps results at limit when there are many matches', () => {
      const ids = Array.from({ length: 200 }, (_, i) => `P${String(i).padStart(5, '0')}`);
      const result = computeSearchSuggestions(ids, [], 'p', true);
      expect(result).toHaveLength(MAX_SEARCH_SUGGESTIONS);
    });

    it('returns all matches when fewer than limit', () => {
      const ids = ['P12345', 'P23456', 'Q99999'];
      const result = computeSearchSuggestions(ids, [], 'p', true);
      expect(result).toEqual(['P12345', 'P23456']);
    });
  });

  describe('case-insensitivity', () => {
    it('matches lowercase query against uppercase IDs', () => {
      const ids = ['P12345', 'P23456', 'Q12345'];
      const result = computeSearchSuggestions(ids, [], 'p12', true);
      expect(result).toEqual(['P12345']);
    });

    it('matches uppercase query against lowercase IDs', () => {
      const ids = ['p12345', 'p23456', 'q12345'];
      const result = computeSearchSuggestions(ids, [], 'P12', true);
      expect(result).toEqual(['p12345']);
    });

    it('matches mixed case query', () => {
      const ids = ['P12345', 'P23456'];
      const result = computeSearchSuggestions(ids, [], 'p12', true);
      expect(result).toEqual(['P12345']);
    });
  });

  describe('excludes already-selected IDs', () => {
    it('excludes selected IDs provided as an array', () => {
      const ids = ['P12345', 'P23456', 'P34567'];
      const result = computeSearchSuggestions(ids, ['P12345', 'P23456'], 'p', true);
      expect(result).toEqual(['P34567']);
    });

    it('excludes selected IDs provided as a Set', () => {
      const ids = ['P12345', 'P23456', 'P34567'];
      const selected = new Set(['P12345', 'P23456']);
      const result = computeSearchSuggestions(ids, selected, 'p', true);
      expect(result).toEqual(['P34567']);
    });

    it('excludes selected IDs with empty query and focused', () => {
      const ids = ['A1', 'A2', 'A3'];
      const result = computeSearchSuggestions(ids, ['A1'], '', true);
      expect(result).toEqual(['A2', 'A3']);
    });
  });

  describe('fewer-than-limit matches', () => {
    it('returns all matches when total is below limit', () => {
      const ids = ['P12345', 'Q23456', 'R34567'];
      const result = computeSearchSuggestions(ids, [], 'p', true);
      expect(result).toEqual(['P12345']);
    });

    it('returns all unselected when focused and fewer than limit', () => {
      const ids = ['A1', 'A2', 'A3'];
      const result = computeSearchSuggestions(ids, [], '', true);
      expect(result).toEqual(['A1', 'A2', 'A3']);
    });
  });

  describe('custom limit param', () => {
    it('respects a custom limit of 1', () => {
      const ids = ['P12345', 'P23456', 'P34567'];
      const result = computeSearchSuggestions(ids, [], 'p', true, 1);
      expect(result).toEqual(['P12345']);
    });

    it('respects a custom limit larger than available matches', () => {
      const ids = ['P12345', 'P23456'];
      const result = computeSearchSuggestions(ids, [], 'p', true, 100);
      expect(result).toEqual(['P12345', 'P23456']);
    });

    it('respects a custom limit of 10', () => {
      const ids = Array.from({ length: 50 }, (_, i) => `P${i}`);
      const result = computeSearchSuggestions(ids, [], 'p', true, 10);
      expect(result).toHaveLength(10);
      expect(result).toEqual(ids.slice(0, 10));
    });
  });

  describe('large input (early-exit proof)', () => {
    it('returns exactly limit IDs for 100K-entry array with empty+focused', () => {
      const ids = Array.from({ length: 100_000 }, (_, i) => `P${String(i).padStart(6, '0')}`);
      const result = computeSearchSuggestions(ids, [], '', true);
      expect(result).toHaveLength(MAX_SEARCH_SUGGESTIONS);
      expect(result).toEqual(ids.slice(0, MAX_SEARCH_SUGGESTIONS));
    });

    it('returns exactly limit IDs for 100K-entry array with query match', () => {
      const ids = Array.from({ length: 100_000 }, (_, i) => `P${String(i).padStart(6, '0')}`);
      const result = computeSearchSuggestions(ids, [], 'p', true);
      expect(result).toHaveLength(MAX_SEARCH_SUGGESTIONS);
    });
  });

  describe('prefix-only (startsWith), NOT substring', () => {
    it('matches prefix but not infix', () => {
      const ids = ['ABC', 'XABC'];
      const result = computeSearchSuggestions(ids, [], 'abc', true);
      expect(result).toEqual(['ABC']);
    });

    it('does not match mid-string occurrence', () => {
      const ids = ['ABC123', 'XYZ123', 'ABC456'];
      const result = computeSearchSuggestions(ids, [], '123', true);
      expect(result).toEqual([]);
    });
  });
});
