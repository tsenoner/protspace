/**
 * When the point grid rebuilds and when it only re-marks the visible slots, against
 * a host whose plot data, scales and marks a test sets by hand. The perf counters
 * count the full rebuilds, as `perf:counts` does.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as d3 from 'd3';
import type { PlotData } from '@protspace/utils';
import type * as PerfCounters from '../../../utils/perf-counters';

vi.mock('../../../utils/perf-counters', async (importOriginal) => {
  const actual = await importOriginal<typeof PerfCounters>();
  return { ...actual, perfCounters: actual.createPerfCounters() };
});

import { createPerfCounters, perfCounters } from '../../../utils/perf-counters';
import { PointGridController } from './point-grid-controller';

const counters = perfCounters!;
const SCALES = {
  x: d3.scaleLinear().domain([0, 100]).range([0, 100]),
  y: d3.scaleLinear().domain([0, 100]).range([0, 100]),
};
const EVERYWHERE = [-1e9, -1e9, 1e9, 1e9] as const;

/** `n` points on the diagonal, `step` apart. */
function makePlotData(n: number, step = 10): PlotData {
  const coords = Float32Array.from({ length: n }, (_, i) => i * step);
  return {
    length: n,
    xs: coords,
    ys: coords,
    zs: null,
    originalIndices: null,
    proteinIds: Array.from({ length: n }, (_, i) => `p${i}`),
  };
}

/** Which of `n` slots are visible. */
function marks(n: number, ...visible: number[]): Uint8Array {
  const m = new Uint8Array(n);
  for (const s of visible) m[s] = 1;
  return m;
}

function makeHost() {
  const host = {
    pd: makePlotData(8),
    visible: marks(8, 0, 1, 2, 3, 4, 5, 6, 7),
    key: '800|600',
    calls: [] as string[],
    plotData: () => host.pd,
    scales: () => SCALES,
    scalesKey: () => host.key,
    interactable: () => ({
      visible: host.visible,
      count: host.visible.reduce((sum, v) => sum + v, 0),
    }),
    onIndexInvalid: () => host.calls.push('invalid'),
    onIndexEmpty: () => host.calls.push('empty'),
    onIndexMarked: () => host.calls.push('marked'),
  };
  return host;
}

let frames: Map<number, FrameRequestCallback>;
const runFrame = () => {
  const queued = [...frames.values()];
  frames.clear();
  for (const cb of queued) cb(0);
};

/** A controller over `makeHost()`, built once, with the counters and calls reset. */
function setup() {
  const host = makeHost();
  const grid = new PointGridController(host);
  grid.rebuildNow();
  Object.assign(counters, createPerfCounters());
  host.calls.length = 0;
  return { host, grid };
}

beforeEach(() => {
  frames = new Map();
  let lastId = 0;
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
    frames.set(++lastId, cb);
    return lastId;
  });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id));
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('PointGridController', () => {
  it('rebuilds once for a rebuild and a re-mark asked in one frame, then only re-marks', () => {
    const { host, grid } = setup();
    const rebuild = vi.spyOn(grid.grid, 'rebuild');
    grid.scheduleRebuild();
    grid.scheduleRemark();
    runFrame();
    expect(rebuild).toHaveBeenCalledTimes(1);
    expect(counters.gridRebuild).toBe(1);

    host.visible = marks(8, 0, 1, 2, 3, 4, 5);
    grid.scheduleRemark();
    runFrame();
    expect(rebuild).toHaveBeenCalledTimes(1);
    expect(counters.gridRebuild).toBe(1);
    expect(grid.visibleSlots()).toEqual([0, 1, 2, 3, 4, 5]);
    expect(
      grid
        .index()
        .queryByPixels(...EVERYWHERE)
        .sort(),
    ).toEqual([0, 1, 2, 3, 4, 5]);
    expect(host.calls).toEqual(['invalid', 'marked', 'invalid', 'marked']);
  });

  it('rebuilds on a re-mark when the grid does not index the plot data', () => {
    const { host, grid } = setup();
    host.pd = makePlotData(8, 5);
    grid.scheduleRemark();
    runFrame();
    expect(counters.gridRebuild).toBe(1);
  });

  it('queries a grid of the visible slots alone while they are under a quarter of all', () => {
    const { host, grid } = setup();
    host.visible = marks(8, 3);
    grid.scheduleRemark();
    runFrame();
    expect(grid.index()).not.toBe(grid.grid);
    expect(grid.index().queryByPixels(...EVERYWHERE)).toEqual([3]);
    expect(grid.grid.queryByPixels(...EVERYWHERE)).toEqual([3]);

    host.visible = marks(8, 3, 4);
    grid.scheduleRemark();
    runFrame();
    expect(grid.index()).toBe(grid.grid);
    expect(counters.gridRebuild).toBe(0);
  });

  it('only re-marks a grid it handed over and got back, while the scales match', () => {
    const { host, grid } = setup();
    const full = host.pd;
    const stash = grid.detach()!;
    expect(stash.plotData).toBe(full);
    expect(grid.grid).not.toBe(stash.grid);

    grid.clear();
    host.pd = makePlotData(2);
    grid.rebuildNow();
    expect(counters.gridRebuild).toBe(1);

    host.pd = full;
    host.visible = marks(8, 1, 2);
    grid.clear();
    grid.adopt(stash);
    const rebuild = vi.spyOn(stash.grid, 'rebuild');
    grid.rebuildNow();
    expect(grid.grid).toBe(stash.grid);
    expect(rebuild).not.toHaveBeenCalled();
    expect(grid.visibleSlots()).toEqual([1, 2]);
    expect(counters.gridRebuild).toBe(1);

    // Once only: the next build rebuilds.
    grid.rebuildNow();
    expect(counters.gridRebuild).toBe(2);
  });

  it('rebuilds a grid it got back at other scales', () => {
    const { host, grid } = setup();
    const stash = grid.detach()!;
    grid.clear();
    grid.adopt(stash);
    host.key = '1024|768';
    grid.rebuildNow();
    expect(counters.gridRebuild).toBe(1);
  });

  it('hands over nothing while a rebuild is pending or for other plot data', () => {
    const { host, grid } = setup();
    const before = grid.grid;
    grid.scheduleRebuild();
    expect(grid.detach()).toBeNull();
    runFrame();
    host.pd = makePlotData(8, 5);
    expect(grid.detach()).toBeNull();
    expect(grid.grid).toBe(before);
  });

  it('keeps a cancelled rebuild pending for the next schedule', () => {
    const { grid } = setup();
    grid.scheduleRebuild();
    grid.cancel();
    runFrame();
    expect(counters.gridRebuild).toBe(0);
    grid.scheduleRemark();
    runFrame();
    expect(counters.gridRebuild).toBe(1);
  });

  it('drops the marks when there is nothing to index', () => {
    const { host, grid } = setup();
    expect(grid.marks).not.toBeNull();
    host.pd = makePlotData(0);
    grid.rebuildNow();
    expect(grid.marks).toBeNull();
    expect(grid.visibleSlots()).toBeNull();
    expect(host.calls).toEqual(['invalid', 'empty']);
    expect(counters.gridRebuild).toBe(0);
  });
});
