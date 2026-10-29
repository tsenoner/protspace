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

    // The merge as it was before `newAreDistinct`, which every result must match in order.
    const oldMerge = (current: string[], added: string[]) => {
      const merged = new Set(current);
      added.forEach((id) => merged.add(id));
      return Array.from(merged);
    };

    it.each([
      ['empty current', [], ['P3', 'P1', 'P2']],
      ['disjoint', ['P2', 'P1'], ['P4', 'P3']],
      ['overlapping', ['P2', 'P1'], ['P3', 'P1', 'P4', 'P2']],
      ['repeats in the current selection', ['P1', 'P2', 'P1'], ['P3', 'P2']],
      ['no new ids', ['P2', 'P1'], []],
    ])('matches the old merge for distinct new ids: %s', (_, current, added) => {
      expect(mergeProteinSelections(current, added, true)).toEqual(oldMerge(current, added));
      expect(mergeProteinSelections(current, added)).toEqual(oldMerge(current, added));
    });

    it('matches the old merge on random selections with distinct new ids', () => {
      let seed = 1;
      const rand = (n: number) => (seed = (seed * 16807) % 2147483647) % n;
      for (let run = 0; run < 200; run++) {
        const current = Array.from({ length: rand(8) }, () => `P${rand(12)}`);
        const added = [...new Set(Array.from({ length: rand(8) }, () => `P${rand(12)}`))];
        expect(mergeProteinSelections(current, added, true)).toEqual(oldMerge(current, added));
      }
    });

    it('dedupes repeated new ids when they are not flagged distinct', () => {
      expect(mergeProteinSelections([], ['P1', 'P2', 'P1'])).toEqual(['P1', 'P2']);
      expect(mergeProteinSelections(['P3'], ['P1', 'P3', 'P1'])).toEqual(['P3', 'P1']);
      expect(mergeProteinSelections(['P3'], ['P1', 'P3', 'P1'])).toEqual(
        oldMerge(['P3'], ['P1', 'P3', 'P1']),
      );
    });

    it('returns a copy of distinct new ids when nothing is selected', () => {
      const added = ['P1', 'P2'];
      const result = mergeProteinSelections([], added, true);
      expect(result).toEqual(added);
      expect(result).not.toBe(added);
    });
  });
});
