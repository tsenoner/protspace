/**
 * @vitest-environment jsdom
 *
 * Shift+hover focus vs. the rAF-coalesced hover (task 2.10). The hover runs a
 * frame after its mousemove, so the Shift state it acts on must be the freshest
 * one: a Shift keyup or window blur between the mousemove and its frame must
 * not be undone by the mousemove's stale `shiftKey`, and a Shift keydown in
 * that gap must still count.
 */
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
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

type FocusInternals = HTMLElement & {
  data: VisualizationData;
  selectedAnnotation: string;
  _plotData: PlotData;
  _transform: d3.ZoomTransform;
  _cachedScales: { x(v: number): number; y(v: number): number } | null;
  _scalesCacheDeps: unknown;
  _focusedValues: string[] | null;
  pickInteractivePointAt(mouseX: number, mouseY: number): PlotDataPoint | null;
  _handleCanvasMouseMove(event: MouseEvent): void;
  _handleShiftKey(event: KeyboardEvent): void;
  _handleWindowBlur(): void;
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

function makeScatter(): FocusInternals {
  const sp = document.createElement('protspace-scatterplot') as FocusInternals;
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
  sp._transform = d3.zoomIdentity;
  // Prime the cached-scales getter so `_scales` is non-null (mousemove bails otherwise).
  sp._cachedScales = { x: (v: number) => v, y: (v: number) => v };
  sp._scalesCacheDeps = {
    plotDataLength: sp._plotData.length,
    width: 800,
    height: 600,
    margin: { top: 40, right: 40, bottom: 40, left: 40 },
  };
  // The hit-test is covered elsewhere; always resolve the cursor to p0 (value 'A').
  const p0: PlotDataPoint = { id: 'p0', x: 0, y: 0, originalIndex: 0 };
  sp.pickInteractivePointAt = () => p0;
  return sp;
}

const move = (shiftKey: boolean) => new MouseEvent('mousemove', { shiftKey });
const shiftKey = (type: 'keydown' | 'keyup') => new KeyboardEvent(type, { key: 'Shift' });

describe('Shift+hover focus across the hover frame', () => {
  let rafQueue: FrameRequestCallback[];
  const drain = () => {
    const q = rafQueue;
    rafQueue = [];
    q.forEach((cb) => cb(0));
  };

  beforeEach(() => {
    rafQueue = [];
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
      rafQueue.push(cb);
      return rafQueue.length;
    });
    vi.stubGlobal('cancelAnimationFrame', () => {});
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('a Shift mousemove focuses the hovered category on its frame', () => {
    const sp = makeScatter();
    sp._handleCanvasMouseMove(move(true));
    expect(sp._focusedValues).toBeNull();
    drain();
    expect(sp._focusedValues).toEqual(['A']);
  });

  it('a Shift keyup between the mousemove and its frame keeps the focus off', () => {
    const sp = makeScatter();
    sp._handleCanvasMouseMove(move(true));
    drain();
    expect(sp._focusedValues).toEqual(['A']);

    sp._handleCanvasMouseMove(move(true));
    sp._handleShiftKey(shiftKey('keyup'));
    expect(sp._focusedValues).toBeNull();
    drain(); // the pending event still says shiftKey: true
    expect(sp._focusedValues).toBeNull();
  });

  it('a window blur between the mousemove and its frame keeps the focus off', () => {
    const sp = makeScatter();
    sp._handleCanvasMouseMove(move(true));
    drain();
    expect(sp._focusedValues).toEqual(['A']);

    sp._handleCanvasMouseMove(move(true));
    sp._handleWindowBlur();
    drain();
    expect(sp._focusedValues).toBeNull();
  });

  it('a Shift keydown between the mousemove and its frame still focuses', () => {
    const sp = makeScatter();
    sp._handleCanvasMouseMove(move(false));
    sp._handleShiftKey(shiftKey('keydown'));
    drain(); // the pending event says shiftKey: false
    expect(sp._focusedValues).toEqual(['A']);
  });
});
