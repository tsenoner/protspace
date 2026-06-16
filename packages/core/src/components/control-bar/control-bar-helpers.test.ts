import { describe, it, expect } from 'vitest';
import {
  EXPORT_DEFAULTS,
  shouldDisableSelection,
  getSelectionDisabledMessage,
  toggleProteinSelection,
  mergeProteinSelections,
} from './control-bar-helpers';

describe('control-bar-helpers', () => {
  describe('EXPORT_DEFAULTS', () => {
    it('has correct default values', () => {
      expect(EXPORT_DEFAULTS.FORMAT).toBe('png');
      expect(EXPORT_DEFAULTS.IMAGE_WIDTH).toBe(2048);
      expect(EXPORT_DEFAULTS.IMAGE_HEIGHT).toBe(1024);
      expect(EXPORT_DEFAULTS.LEGEND_WIDTH_PERCENT).toBe(20);
      expect(EXPORT_DEFAULTS.LEGEND_FONT_SIZE_PX).toBe(15);
      expect(EXPORT_DEFAULTS.BASE_FONT_SIZE).toBe(24);
      expect(EXPORT_DEFAULTS.MIN_LEGEND_FONT_SIZE_PX).toBe(8);
      expect(EXPORT_DEFAULTS.MAX_LEGEND_FONT_SIZE_PX).toBe(120);
      expect(EXPORT_DEFAULTS.LOCK_ASPECT_RATIO).toBe(true);
    });

    it('is defined and not undefined', () => {
      expect(EXPORT_DEFAULTS).toBeDefined();
      expect(typeof EXPORT_DEFAULTS).toBe('object');
    });

    it('has all required keys', () => {
      const requiredKeys = [
        'FORMAT',
        'IMAGE_WIDTH',
        'IMAGE_HEIGHT',
        'LEGEND_WIDTH_PERCENT',
        'LEGEND_FONT_SIZE_PX',
        'BASE_FONT_SIZE',
        'MIN_LEGEND_FONT_SIZE_PX',
        'MAX_LEGEND_FONT_SIZE_PX',
        'LOCK_ASPECT_RATIO',
        'INCLUDE_LEGEND',
      ];

      requiredKeys.forEach((key) => {
        expect(EXPORT_DEFAULTS).toHaveProperty(key);
      });
    });

    it('defaults INCLUDE_LEGEND to true', () => {
      expect(EXPORT_DEFAULTS.INCLUDE_LEGEND).toBe(true);
    });

    it('has valid numeric ranges', () => {
      expect(EXPORT_DEFAULTS.IMAGE_WIDTH).toBeGreaterThan(0);
      expect(EXPORT_DEFAULTS.IMAGE_HEIGHT).toBeGreaterThan(0);
      expect(EXPORT_DEFAULTS.LEGEND_WIDTH_PERCENT).toBeGreaterThan(0);
      expect(EXPORT_DEFAULTS.LEGEND_WIDTH_PERCENT).toBeLessThanOrEqual(100);
      expect(EXPORT_DEFAULTS.MIN_LEGEND_FONT_SIZE_PX).toBeLessThan(
        EXPORT_DEFAULTS.MAX_LEGEND_FONT_SIZE_PX,
      );
    });

    describe('export dimension calculations', () => {
      it('calculates correct legend percentage', () => {
        const legendPercent = EXPORT_DEFAULTS.LEGEND_WIDTH_PERCENT / 100;
        expect(legendPercent).toBe(0.2);
      });

      it('calculates correct target width for scatterplot', () => {
        const legendPercent = EXPORT_DEFAULTS.LEGEND_WIDTH_PERCENT / 100;
        const targetWidth = Math.round(EXPORT_DEFAULTS.IMAGE_WIDTH * (1 - legendPercent));
        expect(targetWidth).toBe(1638); // 2048 * 0.80 = 1638
      });

      it('calculates correct legend scale factor', () => {
        const scaleFactor = EXPORT_DEFAULTS.LEGEND_FONT_SIZE_PX / EXPORT_DEFAULTS.BASE_FONT_SIZE;
        expect(scaleFactor).toBe(0.625); // 15 / 24 = 0.625
      });

      it('calculates scale factor for minimum font size', () => {
        const scaleFactor =
          EXPORT_DEFAULTS.MIN_LEGEND_FONT_SIZE_PX / EXPORT_DEFAULTS.BASE_FONT_SIZE;
        expect(scaleFactor).toBeCloseTo(0.333, 2); // 8 / 24 ≈ 0.333
      });

      it('calculates scale factor for maximum font size', () => {
        const scaleFactor =
          EXPORT_DEFAULTS.MAX_LEGEND_FONT_SIZE_PX / EXPORT_DEFAULTS.BASE_FONT_SIZE;
        expect(scaleFactor).toBe(5.0); // 120 / 24 = 5.0
      });
    });
  });

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
