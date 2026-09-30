/**
 * @vitest-environment jsdom
 *
 * The public read accessors automation uses instead of private fields: where a
 * data point or protein lands on screen, and which duplicate stacks exist. The
 * e2e suite and the docs captures each used to re-derive the projection from
 * `_plotData`/`_scales`/`_transform`, and one copy went stale when PlotData
 * became columnar.
 */
import { vi, describe, it, expect } from 'vitest';
import * as d3 from 'd3';
import type { PlotData } from '@protspace/utils';

vi.hoisted(() => {
  if (!('ResizeObserver' in globalThis)) {
    (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    };
  }
});

import './scatter-plot';

type GeometryInternals = HTMLElement & {
  _plotData: PlotData;
  _transform: d3.ZoomTransform;
  _cachedScales: { x(v: number): number; y(v: number): number } | null;
  _scalesCacheDeps: unknown;
  _dupOverlay: unknown;
  dataToClient(x: number, y: number): { x: number; y: number } | null;
  getProteinClientPosition(proteinId: string): { x: number; y: number } | null;
  getDuplicateStacks(): { key: string; x: number; y: number; count: number }[];
  getExpandedDuplicateStackKey(): string | null;
};

/** Three proteins; `originalIndices` plots only p0 and p2, as isolation would. */
function makeScatter(originalIndices: Int32Array | null = null): GeometryInternals {
  const sp = document.createElement('protspace-scatterplot') as GeometryInternals;
  const proteinIds = ['p0', 'p1', 'p2'];
  sp._plotData = originalIndices
    ? ({
        length: 2,
        xs: new Float32Array([1, 3]),
        ys: new Float32Array([10, 30]),
        zs: null,
        originalIndices,
        proteinIds,
      } as PlotData)
    : ({
        length: 3,
        xs: new Float32Array([1, 2, 3]),
        ys: new Float32Array([10, 20, 30]),
        zs: null,
        originalIndices: null,
        proteinIds,
      } as PlotData);
  // Scales double the data coordinate; primed with matching deps so the cached
  // getter returns them verbatim (same technique as scatter-plot.pick.test.ts).
  sp._cachedScales = { x: (v) => v * 2, y: (v) => v * 2 };
  sp._scalesCacheDeps = {
    plotDataLength: sp._plotData.length,
    width: 800,
    height: 600,
    margin: { top: 40, right: 40, bottom: 40, left: 40 },
  };
  sp._transform = d3.zoomIdentity.translate(5, 7).scale(3);
  sp.getBoundingClientRect = () => ({ left: 100, top: 200 }) as DOMRect;
  return sp;
}

describe('scatter-plot client geometry', () => {
  it('maps a data point through scale, zoom and host offset without a layout', () => {
    const sp = makeScatter();
    // x: 100 + (4 * 2) * 3 + 5 = 129; y: 200 + (6 * 2) * 3 + 7 = 243
    expect(sp.dataToClient(4, 6)).toEqual({ x: 129, y: 243 });
  });

  it("maps through the interaction SVG's screen matrix when it has one", () => {
    const sp = makeScatter();
    // The SVG drawn at half size (viewBox scaling), offset to (40, 60) on screen.
    Object.defineProperty(sp, '_svg', {
      value: { getScreenCTM: () => ({ a: 0.5, b: 0, c: 0, d: 0.5, e: 40, f: 60 }) },
    });
    // svg space: x = (4 * 2) * 3 + 5 = 29, y = (6 * 2) * 3 + 7 = 43
    expect(sp.dataToClient(4, 6)).toEqual({ x: 40 + 29 * 0.5, y: 60 + 43 * 0.5 });
  });

  it('returns null while there is nothing plotted to scale', () => {
    const sp = makeScatter();
    sp._plotData = { ...sp._plotData, length: 0 } as PlotData;
    expect(sp.dataToClient(4, 6)).toBeNull();
  });

  it('locates a protein by id', () => {
    const sp = makeScatter();
    // p1 is slot 1: data (2, 20) → x: 100 + 4 * 3 + 5, y: 200 + 40 * 3 + 7
    expect(sp.getProteinClientPosition('p1')).toEqual({ x: 117, y: 327 });
    expect(sp.getProteinClientPosition('nope')).toBeNull();
  });

  it('follows the slot mapping when only some proteins are plotted', () => {
    const sp = makeScatter(new Int32Array([0, 2]));
    // p2 sits in slot 1: data (3, 30)
    expect(sp.getProteinClientPosition('p2')).toEqual({ x: 123, y: 387 });
    expect(sp.getProteinClientPosition('p1')).toBeNull();
  });

  it('reports duplicate stacks with member counts, and the expanded key', () => {
    const sp = makeScatter();
    sp._dupOverlay = {
      getStacks: () => [
        { key: 'a', x: 1, y: 2, px: 0, py: 0, points: [{}, {}] },
        { key: 'b', x: 3, y: 4, px: 0, py: 0, points: [{}, {}, {}] },
      ],
      getExpandedKey: () => 'b',
    };
    expect(sp.getDuplicateStacks()).toEqual([
      { key: 'a', x: 1, y: 2, count: 2 },
      { key: 'b', x: 3, y: 4, count: 3 },
    ]);
    expect(sp.getExpandedDuplicateStackKey()).toBe('b');
  });
});
