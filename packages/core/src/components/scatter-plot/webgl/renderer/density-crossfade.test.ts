import { describe, it, expect } from 'vitest';
import { densityFrameParams } from './density-crossfade';

// N and viewport of the 573K SwissProt reference run: threshold k is 2.231.
const N = 573_649;
const VIEW = 1920;
const CELL = 4;

describe('densityFrameParams', () => {
  it('puts the fade midpoint at the threshold the synthesis derived', () => {
    expect(densityFrameParams(N, 2.231, VIEW, CELL, false).alpha).toBeCloseTo(0.5, 2);
  });

  it('is monotone non-increasing in k, saturating at 1 below and 0 above', () => {
    const at = (k: number) => densityFrameParams(N, k, VIEW, CELL, false).alpha;
    expect(at(0.1)).toBe(1);
    expect(at(1)).toBe(1);
    expect(at(1.3)).toBe(1);
    // The clamp lands at k = 3.6789, so 3.678 is just short of exactly 0.
    expect(at(3.678)).toBeLessThan(1e-3);
    expect(at(4)).toBe(0);
    expect(at(10)).toBe(0);

    const ks = [0.05, 0.1, 0.5, 1, 1.3, 1.8, 2.231, 2.8, 3.4, 3.678, 4, 10, 100];
    const alphas = ks.map(at);
    for (let i = 1; i < alphas.length; i++) expect(alphas[i]).toBeLessThanOrEqual(alphas[i - 1]!);
  });

  it('engages partially at 100K and identity zoom', () => {
    expect(densityFrameParams(100_000, 1, VIEW, CELL, false).alpha).toBeCloseTo(0.43, 2);
  });

  it('scales a cell holding 5x the mean count to exactly 1', () => {
    const { scaler } = densityFrameParams(N, 1, VIEW, CELL, false);
    const meanCellCount = (N * CELL) / (VIEW * VIEW);
    expect(scaler * (5 * meanCellCount)).toBeCloseTo(1, 9);
  });

  it('forceOn keeps the scaler but pins alpha to 1 even far past the fade', () => {
    const forced = densityFrameParams(N, 100, VIEW, CELL, true);
    const faded = densityFrameParams(N, 100, VIEW, CELL, false);
    expect(forced.alpha).toBe(1);
    expect(faded.alpha).toBe(0);
    expect(forced.scaler).toBeCloseTo(faded.scaler, 12);
  });

  it('returns zeros, not NaN, on degenerate inputs', () => {
    for (const params of [
      densityFrameParams(0, 1, VIEW, CELL, false),
      densityFrameParams(N, 0, VIEW, CELL, false),
      densityFrameParams(N, 1, 0, CELL, true),
    ]) {
      expect(params).toEqual({ alpha: 0, scaler: 0 });
      expect(Number.isFinite(params.alpha)).toBe(true);
      expect(Number.isFinite(params.scaler)).toBe(true);
    }
  });
});
