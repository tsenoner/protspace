import { describe, it, expect } from 'vitest';
import { densityFrameAlpha } from './density-crossfade';

const N = 573_649;
const VIEW = 1920;

describe('densityFrameAlpha', () => {
  it('is monotone non-increasing in k, saturating at 1 below and 0 above', () => {
    const at = (k: number) => densityFrameAlpha(N, k, VIEW, false);
    expect(at(1)).toBe(1);
    expect(at(100)).toBe(0);

    const ks = [0.05, 0.1, 0.5, 1, 2, 4, 8, 12, 16, 24, 32, 100];
    const alphas = ks.map(at);
    for (let i = 1; i < alphas.length; i++) expect(alphas[i]).toBeLessThanOrEqual(alphas[i - 1]!);
  });

  it('engages on the ~7.8K demo view and fades out by k = 8', () => {
    expect(densityFrameAlpha(7_800, 1, 1280, false)).toBe(1);
    expect(densityFrameAlpha(7_800, 8, 1280, false)).toBe(0);
  });

  it('forceOn pins alpha to 1 even far past the fade', () => {
    expect(densityFrameAlpha(N, 1000, VIEW, true)).toBe(1);
    expect(densityFrameAlpha(N, 1000, VIEW, false)).toBe(0);
  });

  it('returns 0, not NaN, on degenerate inputs', () => {
    expect(densityFrameAlpha(0, 1, VIEW, false)).toBe(0);
    expect(densityFrameAlpha(N, 0, VIEW, false)).toBe(0);
    expect(densityFrameAlpha(N, 1, 0, true)).toBe(0);
  });
});
