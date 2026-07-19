/**
 * Shared PlotData fixtures for the duplicate-stack tests. Kept in one place so
 * the full-extent compute suite and the overlay-controller capture suite test
 * the exact same coordinate layout instead of maintaining byte-identical
 * copies that can silently drift apart.
 */
import type { PlotData } from '@protspace/utils';

/** Minimal PlotData from parallel x/y arrays; ids default to `p0`, `p1`, … */
export function makePD(xs: number[], ys: number[], ids?: string[]): PlotData {
  return {
    length: xs.length,
    xs: new Float32Array(xs),
    ys: new Float32Array(ys),
    zs: null,
    originalIndices: null,
    proteinIds: ids ?? xs.map((_, i) => `p${i}`),
  };
}

/**
 * Stack A = slots 0-1 at (0,0); B = slots 2-4 at (50,50); C = slots 5-6 at
 * (90,90); slots 7-9 are solos.
 */
export function tenPointPD(): PlotData {
  return makePD([0, 0, 50, 50, 50, 90, 90, 20, 30, 40], [0, 0, 50, 50, 50, 90, 90, 70, 80, 85]);
}
