/**
 * @vitest-environment jsdom
 *
 * The camera path: what `_getPointsForRendering` hands the renderer, and whether
 * it is the same object from one frame to the next.
 *
 * That identity is the whole fix for #456. The renderer's dirty gate compares
 * content signatures, so a *new* PlotData whose length differs — which is exactly
 * what a viewport cull produces as points enter and leave — trips a full
 * re-stage: an O(N log N) depth sort, ~8 style-getter calls per point, and
 * ~44 MB of buffer uploads. Measured at 1,000,000 points that turned a 1.0 ms
 * zoom into 888 ms and a 1.0 ms pan into 120 ms.
 *
 * The gate reads `_plotData.length` and nothing else, so these tests install a
 * `{ length }` fake rather than allocating a million-element array. They run in
 * milliseconds and fail on the pre-fix tree for the right reason: at 1.5M the old
 * code took the cull branch and returned a freshly materialised object.
 */
import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest';
import type { PlotData } from '@protspace/utils';
import * as d3 from 'd3';

beforeAll(() => {
  if (!('ResizeObserver' in globalThis)) {
    (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    };
  }
});

import './scatter-plot';

type Internals = HTMLElement & {
  _plotData: PlotData;
  _scales: unknown;
  _transform: d3.ZoomTransform;
  _quadtreeIndex: { hasTree: () => boolean; queryByPixels: (...a: number[]) => number[] };
  _getPointsForRendering(): PlotData;
};

/**
 * A scatter-plot with just enough state for `_getPointsForRendering` to run: a
 * non-null `_scales`, a `_plotData` of the given length, and a quadtree that
 * claims to exist so the pre-fix code cannot fall through to the direct path on
 * the second disjunct of its gate.
 */
function hostWithPointCount(length: number) {
  const el = document.createElement('protspace-scatterplot') as Internals;
  const queryByPixels = vi.fn(() => [0, 1, 2]);

  el._plotData = {
    length,
    xs: new Float32Array([0, 1, 2]),
    ys: new Float32Array([0, 1, 2]),
    zs: null,
    originalIndices: null,
    proteinIds: ['p0', 'p1', 'p2'],
  } as unknown as PlotData;

  Object.defineProperty(el, '_scales', {
    configurable: true,
    get: () => ({
      x: d3.scaleLinear().domain([0, 1]).range([0, 800]),
      y: d3.scaleLinear().domain([0, 1]).range([0, 600]),
    }),
  });

  el._quadtreeIndex = {
    hasTree: () => true,
    queryByPixels,
  } as unknown as Internals['_quadtreeIndex'];

  return { el, queryByPixels };
}

describe('_getPointsForRendering returns a referentially stable set', () => {
  afterEach(() => vi.restoreAllMocks());

  // Straddles the old VIRTUALIZATION_THRESHOLD of 1,000,000 — 1.5M is also the
  // size at which the old code both culled AND truncated. Post-fix the method
  // branches only on emptiness, so these two cases are what is left of a gate
  // that used to be size-dependent; the empty case is covered separately below.
  it.each([999_999, 1_500_000])(
    'hands the renderer the same object across camera moves at %i points',
    (length) => {
      const { el, queryByPixels } = hostWithPointCount(length);

      el._transform = d3.zoomIdentity;
      const first = el._getPointsForRendering();

      el._transform = d3.zoomIdentity.translate(137, -84).scale(3.5);
      const second = el._getPointsForRendering();

      // Object identity, not deep equality: a new array with identical contents
      // would still be a new array, and the renderer's length-sensitive signature
      // is what turns that into a full re-stage.
      expect(first).toBe(el._plotData);
      expect(second).toBe(el._plotData);
      expect(second).toBe(first);

      // And nothing consulted the quadtree to get there. The pre-fix gate was
      // `length < THRESHOLD || !hasTree()`, and the fixture always reports a
      // ready tree — so a large dataset whose quadtree was still being built took
      // the direct path while one whose quadtree was ready took the culled one,
      // meaning *which* points were drawn changed with quadtree readiness, frame
      // to frame, during the rAF-deferred rebuild.
      expect(queryByPixels).not.toHaveBeenCalled();
    },
  );

  it('still returns the empty set when there is nothing to draw', () => {
    const { el } = hostWithPointCount(0);
    el._transform = d3.zoomIdentity;
    expect(el._getPointsForRendering().length).toBe(0);
  });
});
