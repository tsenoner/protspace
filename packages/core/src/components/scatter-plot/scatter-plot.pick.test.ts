/**
 * @vitest-environment jsdom
 *
 * F-28: hover and click must share ONE hit-test (`pickInteractivePointAt`).
 * We stub the quadtree + scales + a single rendered point and assert:
 *   (a) pickInteractivePointAt returns the interactive in-radius point;
 *   (b) it returns null for a non-interactive (hidden) point;
 *   (c) it returns null when the resolved point is outside the drawn radius,
 *       which is the renderer's pointScale times sqrt(pointSize)/3, floored at 4 px.
 */
import { vi, describe, it, expect, afterEach } from 'vitest';
import * as d3 from 'd3';
import type { PlotData, PlotDataPoint, VisualizationData } from '@protspace/utils';

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

type PickInternals = HTMLElement & {
  data: VisualizationData;
  selectedAnnotation: string;
  hiddenAnnotationValues: string[];
  _plotData: PlotData;
  _transform: d3.ZoomTransform;
  _quadtreeIndex: { findNearest(x: number, y: number, r: number): number };
  _webglRenderer: { isPointRendered(id: string): boolean; pointScale(): number } | null;
  _mergedConfig: { pointSize: number };
  _cachedScales: { x(v: number): number; y(v: number): number } | null;
  _scalesCacheDeps: unknown;
  pickInteractivePointAt(mouseX: number, mouseY: number): PlotDataPoint | null;
};

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

function makePickScatter(): PickInternals {
  const sp = document.createElement('protspace-scatterplot') as PickInternals;
  sp.data = makeData();
  sp.selectedAnnotation = 'fam';
  sp._plotData = {
    length: 2,
    xs: new Float32Array([0, 50]),
    ys: new Float32Array([0, 50]),
    zs: null,
    originalIndices: null,
    proteinIds: sp.data.protein_ids,
  } as unknown as PlotData;
  sp._transform = d3.zoomIdentity; // identity: dataX===mouseX
  sp._webglRenderer = { isPointRendered: () => true, pointScale: () => 1 };
  sp._mergedConfig.pointSize = 225; // nominal radius 5 CSS px
  // Inject identity scales so scales.x(0)===0 / scales.y(0)===0 (the fixture's
  // documented "dataX===mouseX" assumption). _scales is a cached getter keyed on
  // _scalesCacheDeps; priming both backing fields with matching deps makes the
  // getter skip recompute and return this identity pair verbatim.
  sp._cachedScales = { x: (v: number) => v, y: (v: number) => v };
  sp._scalesCacheDeps = {
    plotDataLength: sp._plotData.length,
    width: 800,
    height: 600,
    margin: { top: 40, right: 40, bottom: 40, left: 40 },
  };
  return sp;
}

describe('F-28 pickInteractivePointAt (shared hover/click hit-test)', () => {
  afterEach(() => vi.restoreAllMocks());

  it('returns the interactive in-radius point at the cursor', () => {
    const sp = makePickScatter();
    sp._quadtreeIndex.findNearest = () => 0; // slot 0 (p0 at 0,0)
    const pt = sp.pickInteractivePointAt(0, 0);
    expect(pt?.id).toBe('p0');
  });

  it('hits within the drawn radius at k = 1 and misses just outside it', () => {
    const sp = makePickScatter();
    sp._quadtreeIndex.findNearest = (_x, _y, r) => (r >= 5 ? 0 : -1);
    expect(sp.pickInteractivePointAt(4.9, 0)?.id).toBe('p0');
    expect(sp.pickInteractivePointAt(5.1, 0)).toBeNull();
  });

  it('hits the grown dot when zoomed in, in screen px', () => {
    // k = 4 with pointScale 2: the dot is drawn at radius 10 screen px.
    const sp = makePickScatter();
    sp._transform = d3.zoomIdentity.scale(4);
    sp._webglRenderer = { isPointRendered: () => true, pointScale: () => 2 };
    const radii: number[] = [];
    sp._quadtreeIndex.findNearest = (_x, _y, r) => (radii.push(r), 0);
    expect(sp.pickInteractivePointAt(9.9, 0)?.id).toBe('p0');
    expect(sp.pickInteractivePointAt(12, 0)).toBeNull();
    expect(radii[0]).toBe(2.5);
  });

  it('keeps a 4 px hit radius for dots drawn smaller', () => {
    const sp = makePickScatter();
    sp._webglRenderer = { isPointRendered: () => true, pointScale: () => 0.5 }; // drawn r 2.5
    sp._quadtreeIndex.findNearest = () => 0;
    expect(sp.pickInteractivePointAt(3.9, 0)?.id).toBe('p0');
    expect(sp.pickInteractivePointAt(4.1, 0)).toBeNull();
  });

  it('returns null for a non-interactive (hidden) point', () => {
    const sp = makePickScatter();
    sp.hiddenAnnotationValues = ['A']; // p0 → opacity 0 → non-interactive
    sp._quadtreeIndex.findNearest = () => 0;
    expect(sp.pickInteractivePointAt(0, 0)).toBeNull();
  });

  it('returns null when the resolved point is outside pointRadius', () => {
    const sp = makePickScatter();
    sp._quadtreeIndex.findNearest = () => 0; // nearest is p0 at (0,0)...
    // ...but query far from it; identity scales => distance >> the drawn radius
    expect(sp.pickInteractivePointAt(40, 40)).toBeNull();
  });
});
