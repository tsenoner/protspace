import { describe, expect, it } from 'vitest';
import { countNoun, formatCount } from './count-text';

describe('formatCount', () => {
  it('groups thousands', () => {
    expect([0, 1, 2, 1234, 123456].map((n) => formatCount(n))).toEqual([
      '0',
      '1',
      '2',
      '1,234',
      '123,456',
    ]);
  });
});

describe('countNoun', () => {
  it('picks one or other by plural rules', () => {
    expect(countNoun(0, 'protein', 'proteins')).toBe('0 proteins');
    expect(countNoun(1, 'protein', 'proteins')).toBe('1 protein');
    expect(countNoun(2, 'protein', 'proteins')).toBe('2 proteins');
    expect(countNoun(1234, 'category', 'categories')).toBe('1,234 categories');
  });
});
