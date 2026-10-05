/**
 * @vitest-environment jsdom
 *
 * F-28: hover and click must share ONE hit-test (`pickInteractivePointAt`).
 * We stub the point index + scales + a single rendered point and assert:
 *   (a) pickInteractivePointAt returns the interactive in-radius point;
 *   (b) it returns null for a non-interactive (hidden) point;
 */
import { vi, describe, it, expect, afterEach } from 'vitest';
import * as d3 from 'd3';
import type { PlotData, VisualizationData } from '@protspace/utils';

import { createPlot, type PlotInternals } from './test-support/plot-fixture';

function makeData(): VisualizationData {
  return {
    protein_ids: ['p0', 'p1'],
    projections: [{ name: 'umap', data: new Float32Array([0, 0, 50, 50]), dimension: 2 }],
    annotations: {
      fam: { values: ['A', 'B'], colors: ['#f00', '#0f0'], shapes: ['circle', 'circle'] },
    },
    annotation_data: { fam: [[0], [1]] },
  } as unknown as VisualizationData;
}

function makePickScatter(): PlotInternals {
  const sp = createPlot({ data: makeData(), selectedAnnotation: 'fam' });
  sp._plotData = {
    length: 2,
    xs: new Float32Array([0, 50]),
    ys: new Float32Array([0, 50]),
    zs: null,
    originalIndices: null,
    proteinIds: sp.data!.protein_ids,
  } as unknown as PlotData;
  sp._transform = d3.zoomIdentity;
  sp._webglRenderer = { pointScale: () => 1 } as never;
  sp._mergedConfig.pointSize = 225;
  // Inject identity scales so scales.x(0)===0 / scales.y(0)===0 (the fixture's
  // documented "dataX===mouseX" assumption). _scales is a cached getter; priming
  // its cache with the current length and key makes the getter skip recompute and
  // return this identity pair verbatim.
  sp._scalesCache = {
    scales: { x: (v: number) => v, y: (v: number) => v },
    plotDataLength: sp._plotData.length,
    key: sp._scalesKey(),
  };
  return sp;
}

describe('F-28 pickInteractivePointAt (shared hover/click hit-test)', () => {
  afterEach(() => vi.restoreAllMocks());

  it('returns the interactive in-radius point at the cursor', () => {
    const sp = makePickScatter();
    sp._pointGridIndex.findNearest = () => 0; // slot 0 (p0 at 0,0)
    const pt = sp.pickInteractivePointAt(0, 0);
    expect(pt?.id).toBe('p0');
  });

  it('hits within the drawn radius at k = 1 and misses just outside it', () => {
    const sp = makePickScatter();
    sp._pointGridIndex.findNearest = (_x, _y, r) => (r >= 5 ? 0 : -1);
    expect(sp.pickInteractivePointAt(4.9, 0)?.id).toBe('p0');
    expect(sp.pickInteractivePointAt(5.1, 0)).toBeNull();
  });

  it('hits the grown dot when zoomed in, in screen px', () => {
    const sp = makePickScatter();
    sp._transform = d3.zoomIdentity.scale(4);
    sp._webglRenderer = { pointScale: () => 2 };
    const radii: number[] = [];
    sp._pointGridIndex.findNearest = (_x, _y, r) => (radii.push(r), 0);
    expect(sp.pickInteractivePointAt(9.9, 0)?.id).toBe('p0');
    expect(sp.pickInteractivePointAt(12, 0)).toBeNull();
    expect(radii[0]).toBe(2.5);
  });

  it('keeps a 4 px hit radius for dots drawn smaller', () => {
    const sp = makePickScatter();
    sp._webglRenderer = { pointScale: () => 0.5 };
    sp._pointGridIndex.findNearest = () => 0;
    expect(sp.pickInteractivePointAt(3.9, 0)?.id).toBe('p0');
    expect(sp.pickInteractivePointAt(4.1, 0)).toBeNull();
  });

  it('returns null for a non-interactive (hidden) point', () => {
    const sp = makePickScatter();
    sp.hiddenAnnotationValues = ['A']; // p0 → opacity 0 → non-interactive
    sp._pointGridIndex.findNearest = () => 0;
    expect(sp.pickInteractivePointAt(0, 0)).toBeNull();
  });

  it('returns null when the resolved point is outside pointRadius', () => {
    const sp = makePickScatter();
    sp._pointGridIndex.findNearest = () => 0; // nearest is p0 at (0,0)...
    expect(sp.pickInteractivePointAt(40, 40)).toBeNull();
  });
});
