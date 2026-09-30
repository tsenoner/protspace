import { describe, it, expect } from 'vitest';
import { getBaseAccession } from './structure-service';

describe('getBaseAccession', () => {
  it('returns the ID unchanged when there is no dot', () => {
    expect(getBaseAccession('P0DQE9')).toBe('P0DQE9');
  });

  it('strips the version suffix after the first dot', () => {
    expect(getBaseAccession('P0DQE9.2')).toBe('P0DQE9');
  });

  it('handles multiple dots by splitting on the first one', () => {
    expect(getBaseAccession('A0A.1.2')).toBe('A0A');
  });

  it('handles an empty string', () => {
    expect(getBaseAccession('')).toBe('');
  });
});
