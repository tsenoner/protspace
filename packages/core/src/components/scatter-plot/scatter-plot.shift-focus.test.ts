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

import { createPlot, fakeFrames, type PlotInternals } from './test-support/plot-fixture';

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

function makeScatter(): PlotInternals {
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
  // Prime the cached-scales getter so `_scales` is non-null (mousemove bails otherwise).
  sp._scalesCache = {
    scales: { x: (v: number) => v, y: (v: number) => v },
    plotDataLength: sp._plotData.length,
    key: sp._scalesKey(),
  };
  // The hit-test is covered elsewhere; always resolve the cursor to p0 (value 'A').
  const p0: PlotDataPoint = { id: 'p0', x: 0, y: 0, originalIndex: 0 };
  sp.pickInteractivePointAt = () => p0;
  return sp;
}

const move = (shiftKey: boolean) => new MouseEvent('mousemove', { shiftKey });
const shiftKey = (type: 'keydown' | 'keyup') => new KeyboardEvent(type, { key: 'Shift' });

describe('Shift+hover focus across the hover frame', () => {
  let frames: ReturnType<typeof fakeFrames>;

  beforeEach(() => {
    frames = fakeFrames();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('a Shift mousemove focuses the hovered category on its frame', () => {
    const sp = makeScatter();
    sp._handleCanvasMouseMove(move(true));
    expect(sp._focusedValues).toBeNull();
    frames.run();
    expect(sp._focusedValues).toEqual(['A']);
  });

  it('a Shift keyup between the mousemove and its frame keeps the focus off', () => {
    const sp = makeScatter();
    sp._handleCanvasMouseMove(move(true));
    frames.run();
    expect(sp._focusedValues).toEqual(['A']);

    sp._handleCanvasMouseMove(move(true));
    sp._handleShiftKey(shiftKey('keyup'));
    expect(sp._focusedValues).toBeNull();
    frames.run(); // the pending event still says shiftKey: true
    expect(sp._focusedValues).toBeNull();
  });

  it('a window blur between the mousemove and its frame keeps the focus off', () => {
    const sp = makeScatter();
    sp._handleCanvasMouseMove(move(true));
    frames.run();
    expect(sp._focusedValues).toEqual(['A']);

    sp._handleCanvasMouseMove(move(true));
    sp._handleWindowBlur();
    frames.run();
    expect(sp._focusedValues).toBeNull();
  });

  it('a Shift keydown between the mousemove and its frame still focuses', () => {
    const sp = makeScatter();
    sp._handleCanvasMouseMove(move(false));
    sp._handleShiftKey(shiftKey('keydown'));
    frames.run(); // the pending event says shiftKey: false
    expect(sp._focusedValues).toEqual(['A']);
  });
});
