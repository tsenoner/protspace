import { describe, it, expect } from 'vitest';
import { shouldDisableSelection, getSelectionDisabledMessage } from './control-bar-helpers';

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
});
