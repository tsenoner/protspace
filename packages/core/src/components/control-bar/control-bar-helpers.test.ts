import { describe, it, expect } from 'vitest';
import { toggleProteinSelection, mergeProteinSelections } from './control-bar-helpers';

describe('control-bar-helpers', () => {
  describe('toggleProteinSelection', () => {
    it('adds protein when not selected', () => {
      const result = toggleProteinSelection('P1', ['P2', 'P3']);
      expect(result).toContain('P1');
      expect(result).toContain('P2');
      expect(result).toContain('P3');
      expect(result.length).toBe(3);
    });

    it('removes protein when already selected', () => {
      const result = toggleProteinSelection('P2', ['P1', 'P2', 'P3']);
      expect(result).toContain('P1');
      expect(result).toContain('P3');
      expect(result).not.toContain('P2');
      expect(result.length).toBe(2);
    });

    it('handles empty selection', () => {
      const result = toggleProteinSelection('P1', []);
      expect(result).toEqual(['P1']);
    });

    it('handles removing last selection', () => {
      const result = toggleProteinSelection('P1', ['P1']);
      expect(result).toEqual([]);
    });
  });

  describe('mergeProteinSelections', () => {
    it('merges two selections', () => {
      const result = mergeProteinSelections(['P1', 'P2'], ['P3', 'P4']);
      expect(result).toEqual(expect.arrayContaining(['P1', 'P2', 'P3', 'P4']));
      expect(result.length).toBe(4);
    });

    it('deduplicates overlapping selections', () => {
      const result = mergeProteinSelections(['P1', 'P2'], ['P2', 'P3']);
      expect(result).toEqual(expect.arrayContaining(['P1', 'P2', 'P3']));
      expect(result.length).toBe(3);
    });

    it('handles empty current selection', () => {
      const result = mergeProteinSelections([], ['P1', 'P2']);
      expect(result).toEqual(expect.arrayContaining(['P1', 'P2']));
    });

    it('handles empty new selections', () => {
      const result = mergeProteinSelections(['P1', 'P2'], []);
      expect(result).toEqual(expect.arrayContaining(['P1', 'P2']));
    });

    it('handles both empty', () => {
      const result = mergeProteinSelections([], []);
      expect(result).toEqual([]);
    });
  });
});
