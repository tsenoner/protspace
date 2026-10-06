import { describe, it, expect } from 'vitest';
import {
  shouldDisableSelection,
  getSelectionDisabledMessage,
  toggleProteinSelection,
  mergeProteinSelections,
} from './control-bar-helpers';

describe('control-bar-helpers', () => {
  describe('shouldDisableSelection', () => {
    it('returns true when data size is 0', () => {
      expect(shouldDisableSelection(0)).toBe(true);
    });

    it('returns true when data size is 1', () => {
      expect(shouldDisableSelection(1)).toBe(true);
    });

    it('returns false when data size is 2', () => {
      expect(shouldDisableSelection(2)).toBe(false);
    });

    it('returns false for larger data sizes', () => {
      expect(shouldDisableSelection(100)).toBe(false);
      expect(shouldDisableSelection(1000)).toBe(false);
    });
  });

  describe('getSelectionDisabledMessage', () => {
    it('returns correct message for insufficient data with 0 points', () => {
      const msg = getSelectionDisabledMessage('insufficient-data', 0);
      expect(msg).toBe('Selection mode disabled: Only 0 points remaining');
    });

    it('returns correct message for insufficient data with 1 point', () => {
      const msg = getSelectionDisabledMessage('insufficient-data', 1);
      expect(msg).toBe('Selection mode disabled: Only 1 point remaining');
    });

    it('uses correct singular/plural for points', () => {
      const msg2 = getSelectionDisabledMessage('insufficient-data', 2);
      expect(msg2).toContain('2 points');
    });

    it('returns generic message for other reasons', () => {
      const msg = getSelectionDisabledMessage('other-reason', 10);
      expect(msg).toBe('Selection mode disabled');
    });
  });

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
