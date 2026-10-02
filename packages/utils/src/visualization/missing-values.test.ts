import { describe, it, expect } from 'vitest';
import {
  MISSING_VALUE_TOKENS,
  NA_VALUE,
  NA_DISPLAY,
  NA_DEFAULT_COLOR,
  normalizeMissingValue,
  isNAValue,
  toInternalValue,
} from './missing-values';

describe('MISSING_VALUE_TOKENS', () => {
  it('contains the canonical missing-value spellings', () => {
    expect(MISSING_VALUE_TOKENS.has('na')).toBe(true);
    expect(MISSING_VALUE_TOKENS.has('n/a')).toBe(true);
    expect(MISSING_VALUE_TOKENS.has('nan')).toBe(true);
    expect(MISSING_VALUE_TOKENS.has('null')).toBe(true);
    expect(MISSING_VALUE_TOKENS.has('none')).toBe(true);
  });

  it('does NOT contain - or .', () => {
    expect(MISSING_VALUE_TOKENS.has('-')).toBe(false);
    expect(MISSING_VALUE_TOKENS.has('.')).toBe(false);
  });

  it('does NOT contain "missing" — only canonical NA/null spellings collapse', () => {
    expect(MISSING_VALUE_TOKENS.has('missing')).toBe(false);
  });

  it('does NOT contain numeric infinity tokens (those are handled by Number.isFinite)', () => {
    expect(MISSING_VALUE_TOKENS.has('infinity')).toBe(false);
    expect(MISSING_VALUE_TOKENS.has('inf')).toBe(false);
  });
});

describe('NA constants', () => {
  it('NA_VALUE is the internal token __NA__', () => {
    expect(NA_VALUE).toBe('__NA__');
  });

  it('NA_DISPLAY is the user-facing label', () => {
    expect(NA_DISPLAY).toBe('N/A');
  });

  it('NA_DEFAULT_COLOR is light grey', () => {
    expect(NA_DEFAULT_COLOR).toBe('#DDDDDD');
  });
});

describe('normalizeMissingValue', () => {
  it('returns null for null and undefined', () => {
    expect(normalizeMissingValue(null)).toBe(null);
    expect(normalizeMissingValue(undefined)).toBe(null);
  });

  it('returns null for empty and whitespace-only strings', () => {
    expect(normalizeMissingValue('')).toBe(null);
    expect(normalizeMissingValue('   ')).toBe(null);
    expect(normalizeMissingValue('\t')).toBe(null);
    expect(normalizeMissingValue('\n')).toBe(null);
  });

  it('returns null for non-finite numbers', () => {
    expect(normalizeMissingValue(NaN)).toBe(null);
    expect(normalizeMissingValue(Infinity)).toBe(null);
    expect(normalizeMissingValue(-Infinity)).toBe(null);
  });

  it('returns null for marker strings, case-insensitive', () => {
    for (const token of [
      'NA',
      'na',
      'Na',
      'nA',
      'N/A',
      'n/a',
      'NaN',
      'nan',
      'NULL',
      'null',
      'None',
      'none',
    ]) {
      expect(normalizeMissingValue(token)).toBe(null);
    }
  });

  it('normalizes the NA_VALUE sentinel spelling itself', () => {
    // The bundle writer drops NA_VALUE from a categorical cell unconditionally, so
    // a category literally spelled `__NA__` would be deleted on export. Reserving
    // the spelling at ingestion keeps writer and reader agreeing on what it means.
    expect(normalizeMissingValue(NA_VALUE)).toBe(null);
    expect(normalizeMissingValue('__na__')).toBe(null);
  });

  it('keeps "missing" as a real categorical value', () => {
    expect(normalizeMissingValue('missing')).toBe('missing');
    expect(normalizeMissingValue('Missing')).toBe('Missing');
  });

  it('handles surrounding whitespace on marker strings', () => {
    expect(normalizeMissingValue('  na  ')).toBe(null);
    expect(normalizeMissingValue('\tN/A\n')).toBe(null);
  });

  it('passes through finite numbers unchanged', () => {
    expect(normalizeMissingValue(0)).toBe(0);
    expect(normalizeMissingValue(1.5)).toBe(1.5);
    expect(normalizeMissingValue(-42)).toBe(-42);
  });

  it('passes through bigint unchanged', () => {
    expect(normalizeMissingValue(BigInt(5))).toBe(BigInt(5));
  });

  it('passes through non-missing strings unchanged', () => {
    expect(normalizeMissingValue('red')).toBe('red');
    expect(normalizeMissingValue('Hemoglobin')).toBe('Hemoglobin');
    expect(normalizeMissingValue('TP53')).toBe('TP53');
  });

  it('keeps - and . as real values (regression for the strict contract)', () => {
    expect(normalizeMissingValue('-')).toBe('-');
    expect(normalizeMissingValue('.')).toBe('.');
    expect(normalizeMissingValue('TP53-')).toBe('TP53-');
    expect(normalizeMissingValue('FAM83A.1')).toBe('FAM83A.1');
  });

  it('preserves original casing/whitespace when the value is not missing', () => {
    expect(normalizeMissingValue('  Hello  ')).toBe('  Hello  ');
  });
});

describe('isNAValue', () => {
  it('returns true only for the internal NA_VALUE token', () => {
    expect(isNAValue(NA_VALUE)).toBe(true);
    expect(isNAValue('__NA__')).toBe(true);
  });

  it('returns false for the display string and for other values', () => {
    expect(isNAValue('N/A')).toBe(false);
    expect(isNAValue('na')).toBe(false);
    expect(isNAValue('')).toBe(false);
    expect(isNAValue('value')).toBe(false);
  });
});

describe('toInternalValue', () => {
  it('returns NA_VALUE for null and undefined', () => {
    expect(toInternalValue(null)).toBe(NA_VALUE);
    expect(toInternalValue(undefined)).toBe(NA_VALUE);
  });

  it('stringifies non-null values', () => {
    expect(toInternalValue('red')).toBe('red');
    expect(toInternalValue(42)).toBe('42');
    expect(toInternalValue(true)).toBe('true');
  });

  it('round-trips with normalizeMissingValue for missing inputs', () => {
    expect(toInternalValue(normalizeMissingValue('NA'))).toBe(NA_VALUE);
    expect(toInternalValue(normalizeMissingValue('N/A'))).toBe(NA_VALUE);
    expect(toInternalValue(normalizeMissingValue(null))).toBe(NA_VALUE);
    expect(toInternalValue(normalizeMissingValue(''))).toBe(NA_VALUE);
  });

  it('round-trips with normalizeMissingValue for real values', () => {
    expect(toInternalValue(normalizeMissingValue('Hemoglobin'))).toBe('Hemoglobin');
    expect(toInternalValue(normalizeMissingValue('-'))).toBe('-');
  });
});
