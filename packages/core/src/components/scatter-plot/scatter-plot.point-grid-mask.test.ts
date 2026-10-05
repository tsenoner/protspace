// @vitest-environment jsdom
/**
 * The point grid indexes every slot, and a change of which points are visible
 * only re-marks them. Every query must answer as a grid of just the visible
 * slots did, which is what the point grid held before.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { VisualizationData } from '@protspace/utils';
import { PointGridIndex } from './interaction/point-grid-index';
import { seededRandom } from '../../test-support/seeded-random';
import { createPlot, fakeFrames, type PlotInternals } from './test-support/plot-fixture';

const FAMILIES = ['A', 'B', 'C'];

/**
 * `n` proteins, a fifth of them exactly on top of an earlier one. `family`
 * picks each one's family; uniform by default.
 */
function makeData(n: number, family?: (i: number) => number): VisualizationData {
  const next = seededRandom(7);
  const coords = new Float32Array(n * 2);
  for (let i = 0; i < n; i++) {
    const copy = i > 0 && next() < 0.2 ? Math.floor(next() * i) : -1;
    coords[i * 2] = copy >= 0 ? coords[copy * 2] : next() * 100;
    coords[i * 2 + 1] = copy >= 0 ? coords[copy * 2 + 1] : next() * 100;
  }
  return {
    protein_ids: Array.from({ length: n }, (_, i) => `p${i}`),
    projections: [{ name: 'p', data: coords, dimension: 2 }],
    annotations: {
      fam: {
        values: FAMILIES,
        colors: ['#f00', '#0f0', '#00f'],
        shapes: ['circle', 'circle', 'circle'],
      },
    },
    annotation_data: {
      fam: Int32Array.from({ length: n }, (_, i) => family?.(i) ?? Math.floor(next() * 3)),
    },
  } as unknown as VisualizationData;
}

let frames: ReturnType<typeof fakeFrames>;

function prime(n = 600, family?: (i: number) => number): PlotInternals {
  const sp = createPlot({ data: makeData(n, family), selectedAnnotation: 'fam' });
  sp._processData();
  sp._buildPointGridIndex();
  return sp;
}

/** The grid as it was built before: only the slots that are interactive now. */
function visibleOnlyGrid(sp: PlotInternals): PointGridIndex {
  const slots = sp._getVisibleSlots()!;
  const grid = new PointGridIndex();
  grid.setScales(sp._scales as never);
  grid.rebuild(sp._plotData, slots);
  return grid;
}

function familyOf(sp: PlotInternals, slot: number): string {
  const rows = sp.data!.annotation_data.fam as Int32Array;
  return FAMILIES[rows[slot]];
}

describe('point grid over every slot, masked to the visible ones', () => {
  beforeEach(() => {
    frames = fakeFrames();
  });
  afterEach(() => vi.unstubAllGlobals());

  it('re-marks the visible slots on a legend toggle without rebuilding the grid', () => {
    const sp = prime();
    const rebuild = vi.spyOn(sp._pointGridIndex, 'rebuild');
    sp.hiddenAnnotationValues = ['B'];
    sp._scheduleVisibleSlotsRefresh();
    frames.flush();
    expect(rebuild).not.toHaveBeenCalled();
    const slots = sp._getVisibleSlots()!;
    expect(slots.length).toBeGreaterThan(0);
    expect(slots.every((s) => familyOf(sp, s) !== 'B')).toBe(true);
    expect(slots.length).toBe(
      Array.from({ length: sp._plotData.length }, (_, s) => s).filter(
        (s) => familyOf(sp, s) !== 'B',
      ).length,
    );
  });

  it('marks the slots and counts them in one pass, whichever runs first', () => {
    const sp = prime();
    const n = sp._plotData.length;
    const all = Array.from({ length: n }, (_, s) => s);
    for (const [hidden, countFirst] of [
      [['B'], true],
      [['A'], false],
    ] as const) {
      sp.hiddenAnnotationValues = [...hidden];
      const opacityAt = vi.spyOn(sp._getVisibilityModel(), 'opacityAt');
      const count = countFirst ? sp._getVisiblePointCount() : -1;
      sp._scheduleVisibleSlotsRefresh();
      frames.flush();
      const slots = sp._getVisibleSlots()!;
      expect(slots).toEqual(all.filter((s) => familyOf(sp, s) !== hidden[0]));
      expect(sp._getVisiblePointCount()).toBe(slots.length);
      if (countFirst) expect(count).toBe(slots.length);
      expect(opacityAt).toHaveBeenCalledTimes(n);
    }
  });

  it('rebuilds when a full rebuild is pending or the plot data changed', () => {
    const sp = prime();
    const rebuild = vi.spyOn(sp._pointGridIndex, 'rebuild');
    sp._schedulePointGridIndexRebuild();
    sp._scheduleVisibleSlotsRefresh();
    frames.flush();
    expect(rebuild).toHaveBeenCalledTimes(1);

    sp._plotData = { ...sp._plotData, xs: new Float32Array(sp._plotData.xs) };
    sp._scheduleVisibleSlotsRefresh();
    frames.flush();
    expect(rebuild).toHaveBeenCalledTimes(2);
  });

  it('finds the nearest visible point exactly as a grid of the visible points does', () => {
    const sp = prime();
    for (const hidden of [['B'], ['A', 'C'], ['A', 'B']]) {
      sp.hiddenAnnotationValues = hidden;
      sp._scheduleVisibleSlotsRefresh();
      frames.flush();
      const reference = visibleOnlyGrid(sp);
      const next = seededRandom(hidden.length * 31);
      let hits = 0;
      for (let q = 0; q < 3000; q++) {
        const x = sp._scales!.x(next() * 100);
        const y = sp._scales!.y(next() * 100);
        const r = 1 + next() * 40;
        const expected = reference.findNearest(x, y, r);
        expect(sp._visibleIndex().findNearest(x, y, r)).toBe(expected);
        if (expected >= 0) hits++;
      }
      expect(hits).toBeGreaterThan(100);
    }
  });

  it('keeps hidden points out of brushing, lasso and the duplicate stacks', () => {
    const sp = prime();
    sp.hiddenAnnotationValues = ['C'];
    sp._scheduleVisibleSlotsRefresh();
    frames.flush();
    const reference = visibleOnlyGrid(sp);
    const [x0, y0, x1, y1] = [
      sp._scales!.x(10),
      sp._scales!.y(90),
      sp._scales!.x(70),
      sp._scales!.y(20),
    ];
    const polygon: [number, number][] = [
      [x0, y0],
      [x1, y0],
      [x1, y1],
      [x0, y1],
    ];
    const host = sp._interactionHost();
    const dupIndex = sp._dupOverlay.deps.getPointGridIndex();
    const expected = new Set(reference.queryByPixels(x0, y0, x1, y1));
    expect(expected.size).toBeGreaterThan(0);
    for (const hits of [
      host.queryByPixels(x0, y0, x1, y1),
      host.queryByPolygon(polygon),
      dupIndex.queryByPixels(x0, y0, x1, y1),
    ]) {
      expect(new Set(hits)).toEqual(expected);
      expect(hits).toHaveLength(expected.size);
    }
  });

  it('re-marks the interactive slots when a selection fades the rest to 0', () => {
    const sp = prime();
    const select = (ids: string[]) => {
      sp.selectedProteinIds = ids;
      sp.updated(new Map([['selectedProteinIds', undefined]]));
      frames.flush();
    };
    // Faded points stay interactive by default: nothing to re-mark.
    const setVisible = vi.spyOn(sp._pointGridIndex, 'setVisible');
    select(['p3']);
    expect(setVisible).not.toHaveBeenCalled();
    select([]);

    sp.config = { fadedOpacity: 0 };
    sp.updated(new Map([['config', undefined]]));
    frames.flush();
    const all = Array.from({ length: sp._plotData.length }, (_, s) => s);
    select(['p3', 'p10']);
    expect(sp._getVisibleSlots()).toEqual([3, 10]);
    // A legend change while selected, then the selection cleared.
    sp.hiddenAnnotationValues = [familyOf(sp, 0) === 'A' ? 'B' : 'A'];
    sp.updated(new Map([['hiddenAnnotationValues', undefined]]));
    frames.flush();
    select([]);
    const hidden = sp.hiddenAnnotationValues[0];
    expect(sp._getVisibleSlots()).toEqual(all.filter((s) => familyOf(sp, s) !== hidden));
  });

  it('queries a grid of just the visible slots while they are few', () => {
    // A is a tenth of the proteins: with B and C hidden, a grid of A alone.
    const sp = prime(800, (i) => (i % 10 === 0 ? 0 : 1 + (i % 2)));
    const fullRebuild = vi.spyOn(sp._pointGridIndex, 'rebuild');
    sp.hiddenAnnotationValues = ['B', 'C'];
    sp._scheduleVisibleSlotsRefresh();
    frames.flush();
    expect(fullRebuild).not.toHaveBeenCalled();
    expect(sp._sparseIndex).not.toBeNull();
    const reference = visibleOnlyGrid(sp);
    const next = seededRandom(5);
    for (let q = 0; q < 2000; q++) {
      const x = sp._scales!.x(next() * 100);
      const y = sp._scales!.y(next() * 100);
      const r = 1 + next() * 40;
      expect(sp._visibleIndex().findNearest(x, y, r)).toBe(reference.findNearest(x, y, r));
    }
    const host = sp._interactionHost();
    const box = [sp._scales!.x(5), sp._scales!.y(95), sp._scales!.x(95), sp._scales!.y(5)] as const;
    expect(host.queryByPixels(...box)).toEqual(reference.queryByPixels(...box));

    // Showing them again drops it, without rebuilding the full grid.
    sp.hiddenAnnotationValues = [];
    sp._scheduleVisibleSlotsRefresh();
    frames.flush();
    expect(sp._sparseIndex).toBeNull();
    expect(fullRebuild).not.toHaveBeenCalled();
  });
});
