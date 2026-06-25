import { describe, it, expect } from 'vitest';
import { NA_VALUE } from '@protspace/utils';
import { formatRawNumericTooltipValue } from './protein-tooltip';
import {
  filterAnnotationValues,
  getAnnotationHeaderType,
  getGeneName,
  getProteinName,
  getUniprotKbId,
} from './protein-tooltip-helpers';

describe('filterAnnotationValues', () => {
  it('returns null for undefined input', () => {
    expect(filterAnnotationValues(undefined)).toBeNull();
  });

  it('returns null for empty array', () => {
    expect(filterAnnotationValues([])).toBeNull();
  });

  it('returns null when all values are __NA__', () => {
    expect(filterAnnotationValues([NA_VALUE, NA_VALUE])).toBeNull();
  });

  it('returns null when all values are whitespace', () => {
    expect(filterAnnotationValues(['  ', '\t', ''])).toBeNull();
  });

  it('filters out __NA__ and returns remaining values', () => {
    expect(filterAnnotationValues([NA_VALUE, 'BRCA1'])).toBe('BRCA1');
  });

  it('trims whitespace from values', () => {
    expect(filterAnnotationValues(['  TP53  '])).toBe('TP53');
  });

  it('joins multiple non-NA values with comma', () => {
    expect(filterAnnotationValues(['BRCA1', 'TP53'])).toBe('BRCA1, TP53');
  });

  it('filters NA and whitespace, then joins remaining', () => {
    expect(filterAnnotationValues([NA_VALUE, 'BRCA1', '  ', 'TP53'])).toBe('BRCA1, TP53');
  });

  it('returns single value without comma', () => {
    expect(filterAnnotationValues(['Kinase'])).toBe('Kinase');
  });
});

describe('getGeneName', () => {
  it('resolves gene-name values', () => {
    expect(getGeneName(['BRCA1'])).toBe('BRCA1');
  });

  it('returns null when gene annotation is all __NA__', () => {
    expect(getGeneName([NA_VALUE])).toBeNull();
  });

  it('returns null for empty array', () => {
    expect(getGeneName([])).toBeNull();
  });
});

describe('getProteinName', () => {
  it('resolves protein-name values', () => {
    expect(getProteinName(['Tumor protein p53'])).toBe('Tumor protein p53');
  });

  it('returns null when all values are __NA__', () => {
    expect(getProteinName([NA_VALUE])).toBeNull();
  });

  it('returns null for empty array', () => {
    expect(getProteinName([])).toBeNull();
  });
});

describe('getUniprotKbId', () => {
  it('resolves uniprot-kb-id values', () => {
    expect(getUniprotKbId(['P04637'])).toBe('P04637');
  });

  it('returns null when all values are __NA__', () => {
    expect(getUniprotKbId([NA_VALUE])).toBeNull();
  });

  it('returns null for empty array', () => {
    expect(getUniprotKbId([])).toBeNull();
  });

  it('joins multiple IDs', () => {
    expect(getUniprotKbId(['P04637', 'Q9NZC2'])).toBe('P04637, Q9NZC2');
  });
});

describe('getAnnotationHeaderType', () => {
  it('returns null when both scores and evidence are empty', () => {
    expect(getAnnotationHeaderType([], [])).toBeNull();
  });

  it('returns null when scores are all null and evidence are all null', () => {
    expect(getAnnotationHeaderType([null, null], [null, null])).toBeNull();
  });

  it('returns "bitscore" when scores contain non-empty arrays', () => {
    expect(getAnnotationHeaderType([[1.5e-10]], [null])).toBe('bitscore');
  });

  it('returns "bitscore" when scores have multiple values', () => {
    expect(getAnnotationHeaderType([[1.5e-10, 2.3e-5]], [null])).toBe('bitscore');
  });

  it('returns "evidence" when evidence codes are present but no scores', () => {
    expect(getAnnotationHeaderType([null], ['ECO:0000269'])).toBe('evidence');
  });

  it('returns "evidence" for short evidence codes like EXP', () => {
    expect(getAnnotationHeaderType([], ['EXP'])).toBe('evidence');
  });

  it('returns "bitscore" when both scores and evidence are present (scores take priority)', () => {
    expect(getAnnotationHeaderType([[42]], ['EXP'])).toBe('bitscore');
  });

  it('returns null when scores are empty arrays', () => {
    expect(getAnnotationHeaderType([[]], [])).toBeNull();
  });

  it('returns "bitscore" when at least one entry has scores among nulls', () => {
    expect(getAnnotationHeaderType([null, [0.5], null], [null, null, null])).toBe('bitscore');
  });

  it('returns "evidence" when at least one entry has evidence among nulls', () => {
    expect(getAnnotationHeaderType([null, null], [null, 'IDA'])).toBe('evidence');
  });
});

describe('formatRawNumericTooltipValue', () => {
  it('formats int raw values without grouping or decimals', () => {
    expect(formatRawNumericTooltipValue(1200.75, 'int')).toBe('1200');
  });

  it('formats float raw values with grouping and decimals', () => {
    expect(formatRawNumericTooltipValue(2500.25, 'float')).toBe('2,500.25');
  });

  it('preserves meaningful precision for tiny positive float raw values', () => {
    expect(formatRawNumericTooltipValue(1.2e-7, 'float')).toBe('1.2e-7');
  });

  it('preserves meaningful precision for tiny negative float raw values', () => {
    expect(formatRawNumericTooltipValue(-1.2e-7, 'float')).toBe('-1.2e-7');
  });
});
