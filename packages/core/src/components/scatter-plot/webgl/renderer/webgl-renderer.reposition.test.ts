// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import type { PlotData } from '@protspace/utils';
import { makeRenderer, plotDataFrom, styleGetters } from './test-support/renderer-fixture';
import { internalsOf } from './test-support/renderer-internals';
import { seededRandom } from '../../../../test-support/seeded-random';

/** `n` points with depths in four tiers and opacities in three, so the paint order is not the slot order. */
function style() {
  return {
    ...styleGetters(['#f00']),
    getDepth: (p: { originalIndex: number }) => (p.originalIndex % 4) / 4,
    getOpacity: (p: { originalIndex: number }) => [1, 0.5, 0][p.originalIndex % 3],
    getColors: (p: { originalIndex: number }) => [p.originalIndex % 2 ? '#00f' : '#f00'],
  };
}

function points(n: number, seed: number): PlotData {
  const random = seededRandom(seed);
  const xs = Array.from({ length: n }, () => random());
  const ys = Array.from({ length: n }, () => random());
  return plotDataFrom(xs, ys);
}

/** The renderer's private plans, spied on by name. */
type Plans = { repositionPoints(): boolean; resortPoints(): boolean };

/** Every staged array a draw reads, copied out of `renderer`. */
function staged(renderer: ReturnType<typeof makeRenderer>['renderer']) {
  const { stageArrays, sortOrder } = internalsOf(renderer);
  const copy = (a: ArrayLike<number> | null | undefined) => (a ? Array.from(a) : a);
  return {
    sortOrder: copy(sortOrder),
    dataPositions: copy(stageArrays.dataPositions),
    colors: copy(stageArrays.colors),
    depths: copy(stageArrays.depths),
    sizes: copy(stageArrays.sizes),
    shapes: copy(stageArrays.shapes),
  };
}

describe('WebGLRenderer reposition (projection switch)', () => {
  it('stages what a full re-sort of the new positions stages', () => {
    const n = 300;
    const moved = points(n, 2);

    const { renderer } = makeRenderer({ style: style() });
    vi.spyOn(internalsOf(renderer), 'renderWithGammaCorrection').mockImplementation(() => {});
    renderer.render(points(n, 1));
    const reposition = vi.spyOn(renderer as unknown as Plans, 'repositionPoints');
    const resort = vi.spyOn(renderer as unknown as Plans, 'resortPoints');
    renderer.invalidatePositionCache();
    renderer.render(moved);
    expect(reposition).toHaveBeenCalledOnce();
    expect(resort).not.toHaveBeenCalled();

    const { renderer: fresh } = makeRenderer({ style: style() });
    vi.spyOn(internalsOf(fresh), 'renderWithGammaCorrection').mockImplementation(() => {});
    fresh.render(moved);

    expect(staged(renderer)).toEqual(staged(fresh));
  });

  it('re-sorts when the slots no longer hold the same points', () => {
    const n = 50;
    const { renderer } = makeRenderer({ style: style() });
    vi.spyOn(internalsOf(renderer), 'renderWithGammaCorrection').mockImplementation(() => {});
    renderer.render(points(n, 1));
    const shuffled = {
      ...points(n, 3),
      originalIndices: Int32Array.from({ length: n }, (_, i) => n - 1 - i),
    };
    const resort = vi.spyOn(renderer as unknown as Plans, 'resortPoints');
    renderer.invalidatePositionCache();
    renderer.render(shuffled);
    expect(resort).toHaveBeenCalledOnce();

    const { renderer: fresh } = makeRenderer({ style: style() });
    vi.spyOn(internalsOf(fresh), 'renderWithGammaCorrection').mockImplementation(() => {});
    fresh.render(shuffled);

    expect(staged(renderer)).toEqual(staged(fresh));
  });
});
