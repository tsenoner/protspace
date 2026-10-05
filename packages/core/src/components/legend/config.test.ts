import { describe, it, expect } from 'vitest';
import {
  LEGEND_VALUES,
  NA_VALUE,
  NA_DISPLAY,
  toDisplayValue,
  isNAValue,
  toInternalValue,
  toDataValue,
} from './config';

describe('config', () => {
  describe('isNAValue', () => {
    it('returns true for __NA__', () => {
      expect(isNAValue(NA_VALUE)).toBe(true);
    });

    it('returns false for other values', () => {
      expect(isNAValue('')).toBe(false);
      expect(isNAValue('null')).toBe(false);
      expect(isNAValue('N/A')).toBe(false);
      expect(isNAValue('value')).toBe(false);
    });
  });

  describe('toInternalValue', () => {
    it('converts null to __NA__', () => {
      expect(toInternalValue(null)).toBe(NA_VALUE);
    });

    it('converts undefined to __NA__', () => {
      expect(toInternalValue(undefined)).toBe(NA_VALUE);
    });

    it('preserves non-empty strings', () => {
      expect(toInternalValue('value')).toBe('value');
      expect(toInternalValue(LEGEND_VALUES.OTHER)).toBe('Other');
    });

    it('preserves __NA__ without double-conversion', () => {
      expect(toInternalValue(NA_VALUE)).toBe(NA_VALUE);
    });
  });

  describe('toDataValue', () => {
    it('converts __NA__ to null', () => {
      expect(toDataValue(NA_VALUE)).toBe(null);
    });

    it('preserves other values', () => {
      expect(toDataValue('value')).toBe('value');
      expect(toDataValue(LEGEND_VALUES.OTHER)).toBe('Other');
      expect(toDataValue('')).toBe('');
    });
  });

  describe('toDisplayValue', () => {
    it('converts __NA__ to N/A display text', () => {
      expect(toDisplayValue(NA_VALUE)).toBe(NA_DISPLAY);
      expect(toDisplayValue(NA_VALUE)).toBe('N/A');
    });

    it('preserves other values', () => {
      expect(toDisplayValue('value')).toBe('value');
      expect(toDisplayValue(LEGEND_VALUES.OTHER)).toBe('Other');
    });

    it('formats Other with count', () => {
      expect(toDisplayValue(LEGEND_VALUES.OTHER, 5)).toBe('Other (5 categories)');
      expect(toDisplayValue(LEGEND_VALUES.OTHER, 0)).toBe('Other');
    });
  });
});
