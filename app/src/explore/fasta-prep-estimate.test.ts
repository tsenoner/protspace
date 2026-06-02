import { describe, expect, it } from 'vitest';
import {
  countFastaSequences,
  estimateEmbedSeconds,
  formatEmbeddingLabel,
  formatEstimate,
} from './fasta-prep-estimate';
import {
  MAX_SEQUENCES,
  MAX_UPLOAD_BYTES,
  MIN_SEQUENCES,
  PIPELINE_TIMEOUT_SECONDS,
} from './fasta-prep-limits';

describe('countFastaSequences', () => {
  it('counts > markers at line starts', async () => {
    const file = new File(['>a\nMKT\n>b\nMK\n>c\nM\n'], 'x.fasta');
    expect(await countFastaSequences(file)).toBe(3);
  });

  it('ignores > characters mid-line', async () => {
    const file = new File(['>a\nM>K\n>b\nM\n'], 'x.fasta');
    expect(await countFastaSequences(file)).toBe(2);
  });

  it('returns 0 for an empty file', async () => {
    expect(await countFastaSequences(new File([''], 'x.fasta'))).toBe(0);
  });

  it('counts a header at the very start of the file', async () => {
    const file = new File(['>only\nM\n'], 'x.fasta');
    expect(await countFastaSequences(file)).toBe(1);
  });
});

describe('estimateEmbedSeconds', () => {
  it('returns base overhead for empty input', () => {
    expect(estimateEmbedSeconds(0)).toBe(10);
    expect(estimateEmbedSeconds(-5)).toBe(10);
  });

  it('matches the calibration anchor (~700 seqs ≈ 3 min)', () => {
    const seconds = estimateEmbedSeconds(700);
    expect(seconds).toBeGreaterThan(150);
    expect(seconds).toBeLessThan(220);
  });

  it('scales roughly linearly with sequence count', () => {
    expect(estimateEmbedSeconds(1500)).toBeCloseTo(385, 0);
  });
});

describe('formatEstimate', () => {
  it('formats sub-minute estimates in 10s steps with a 10s floor', () => {
    expect(formatEstimate(5)).toBe('~10 sec');
    expect(formatEstimate(35)).toBe('~40 sec');
    expect(formatEstimate(59)).toBe('~60 sec');
  });

  it('uses ~1 min for the 60-119s range', () => {
    expect(formatEstimate(60)).toBe('~1 min');
    expect(formatEstimate(119)).toBe('~1 min');
  });

  it('uses half-minute precision for 2-10 min', () => {
    expect(formatEstimate(180)).toBe('~3 min');
    expect(formatEstimate(190)).toBe('~3 min');
    expect(formatEstimate(210)).toBe('~3.5 min');
    expect(formatEstimate(385)).toBe('~6.5 min');
  });

  it('uses whole-minute precision for ≥10 min', () => {
    expect(formatEstimate(600)).toBe('~10 min');
    expect(formatEstimate(900)).toBe('~15 min');
  });
});

describe('formatEmbeddingLabel', () => {
  it('builds a user-facing label from a sequence count', () => {
    expect(formatEmbeddingLabel(700)).toBe('Embedding sequences (~3 min)…');
    expect(formatEmbeddingLabel(1500)).toBe('Embedding sequences (~6.5 min)…');
    expect(formatEmbeddingLabel(50)).toBe('Embedding sequences (~20 sec)…');
  });
});

describe('prep limits', () => {
  it('mirror the backend deploy configuration exactly', () => {
    expect(MAX_UPLOAD_BYTES).toBe(8_388_608);
    expect(MIN_SEQUENCES).toBe(20);
    expect(MAX_SEQUENCES).toBe(1500);
    expect(PIPELINE_TIMEOUT_SECONDS).toBe(420);
  });

  it('keep the max-sequence estimate just under the hard timeout', () => {
    // The estimate for a full job must stay below the server timeout so the
    // UI never silently runs past the point where the server gives up.
    expect(estimateEmbedSeconds(MAX_SEQUENCES)).toBeLessThan(PIPELINE_TIMEOUT_SECONDS);
  });
});
