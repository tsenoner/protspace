import { describe, it, expect } from 'vitest';
import {
  pxToMm,
  mmToPx,
  adjustDpiForWidthMm,
  clampHeight,
  inToMm,
  mmToIn,
  cmToMm,
  mmToCm,
  SIZE_MODE_WIDTH_MM,
} from './dimension-utils';
import { getPreset } from './journal-presets';

describe('dimension-utils', () => {
  describe('pxToMm', () => {
    it('converts 300px at 300 DPI to 25.4mm', () => {
      expect(pxToMm(300, 300)).toBeCloseTo(25.4, 1);
    });

    it('converts 1051px at 300 DPI to ~89mm', () => {
      expect(pxToMm(1051, 300)).toBeCloseTo(89, 0);
    });

    it('converts 2161px at 300 DPI to ~183mm', () => {
      expect(pxToMm(2161, 300)).toBeCloseTo(183, 0);
    });
  });

  describe('mmToPx', () => {
    it('converts 89mm at 300 DPI to 1051px', () => {
      expect(mmToPx(89, 300)).toBe(1051);
    });

    it('converts 183mm at 300 DPI to 2161px', () => {
      expect(mmToPx(183, 300)).toBe(2161);
    });
  });

  describe('adjustDpiForWidthMm', () => {
    it('calculates DPI needed for 89mm at 1051px', () => {
      const dpi = adjustDpiForWidthMm(1051, 89);
      expect(dpi).toBeCloseTo(300, 0);
    });

    it('calculates DPI needed for 183mm at 2161px', () => {
      const dpi = adjustDpiForWidthMm(2161, 183);
      expect(dpi).toBeCloseTo(300, 0);
    });
  });

  describe('clampHeight', () => {
    it('clamps to max 170mm equivalent at given DPI', () => {
      const maxPx = clampHeight(3000, 300, 170);
      expect(maxPx).toBe(2008);
    });

    it('returns original height if below max', () => {
      expect(clampHeight(1000, 300, 170)).toBe(1000);
    });

    it('returns original when maxMm is undefined', () => {
      expect(clampHeight(5000, 300, undefined)).toBe(5000);
    });
  });

  describe('SIZE_MODE_WIDTH_MM', () => {
    // The modal maps a preset to a size mode by width, so the modes must match the presets.
    it('matches the Nature column widths, and flexible has none', () => {
      expect(SIZE_MODE_WIDTH_MM).toEqual({
        '1-column': getPreset('nature-1col')!.widthMm,
        '2-column': getPreset('nature-2col')!.widthMm,
        flexible: undefined,
      });
    });
  });

  describe('inToMm / mmToIn', () => {
    it('converts 1 inch to 25.4 mm', () => {
      expect(inToMm(1)).toBeCloseTo(25.4, 4);
    });

    it('converts 25.4 mm to 1 inch', () => {
      expect(mmToIn(25.4)).toBeCloseTo(1, 4);
    });

    it('round-trips arbitrary values', () => {
      expect(mmToIn(inToMm(3.5))).toBeCloseTo(3.5, 4);
    });
  });

  describe('cmToMm / mmToCm', () => {
    it('converts 1 cm to 10 mm', () => {
      expect(cmToMm(1)).toBeCloseTo(10, 4);
    });

    it('converts 89 mm to 8.9 cm', () => {
      expect(mmToCm(89)).toBeCloseTo(8.9, 4);
    });

    it('round-trips arbitrary values', () => {
      expect(mmToCm(cmToMm(7.25))).toBeCloseTo(7.25, 4);
    });
  });
});
