import { describe, it, expect } from 'vitest';
import * as d3 from 'd3';
import { QuadtreeIndex, pointInPolygon } from './quadtree-index';
import type { PlotData } from '@protspace/utils';

/** Build a minimal PlotData with identity originalIndices mapping. */
function makePD(xs: number[], ys: number[], ids?: string[]): PlotData {
  return {
    length: xs.length,
    xs: new Float32Array(xs),
    ys: new Float32Array(ys),
    zs: null,
    originalIndices: null,
    proteinIds: ids ?? xs.map((_, i) => `p${i}`),
  };
}

function buildIndex(pd: PlotData): QuadtreeIndex {
  const idx = new QuadtreeIndex();
  idx.setScales({
    x: d3.scaleLinear().domain([0, 100]).range([0, 100]),
    y: d3.scaleLinear().domain([0, 100]).range([0, 100]),
  });
  // All slots are "visible"
  const slots = Array.from({ length: pd.length }, (_, i) => i);
  idx.rebuild(pd, slots);
  return idx;
}

// ── pointInPolygon ─────────────────────────────────────────────

describe('pointInPolygon', () => {
  const triangle: [number, number][] = [
    [0, 0],
    [10, 0],
    [5, 10],
  ];

  it('returns true for a point inside the triangle', () => {
    expect(pointInPolygon(5, 3, triangle)).toBe(true);
  });

  it('returns false for a point outside the triangle', () => {
    expect(pointInPolygon(0, 10, triangle)).toBe(false);
  });

  it('returns false for a point far outside', () => {
    expect(pointInPolygon(50, 50, triangle)).toBe(false);
  });

  it('works with a square polygon', () => {
    const square: [number, number][] = [
      [0, 0],
      [10, 0],
      [10, 10],
      [0, 10],
    ];
    expect(pointInPolygon(5, 5, square)).toBe(true);
    expect(pointInPolygon(11, 5, square)).toBe(false);
  });

  it('works with a concave polygon', () => {
    // L-shape: concave polygon
    const lShape: [number, number][] = [
      [0, 0],
      [10, 0],
      [10, 5],
      [5, 5],
      [5, 10],
      [0, 10],
    ];
    expect(pointInPolygon(2, 2, lShape)).toBe(true); // inside bottom-left
    expect(pointInPolygon(8, 2, lShape)).toBe(true); // inside bottom-right
    expect(pointInPolygon(8, 8, lShape)).toBe(false); // inside the concave cutout
    expect(pointInPolygon(2, 8, lShape)).toBe(true); // inside top-left
  });
});

// ── findNearest ────────────────────────────────────────────────

describe('QuadtreeIndex.findNearest', () => {
  it('returns the slot of the nearest point within radius', () => {
    const pd = makePD([10, 50, 90], [10, 50, 90]);
    const idx = buildIndex(pd);
    const slot = idx.findNearest(50, 50, 20);
    expect(slot).toBe(1); // slot 1 is at (50,50)
  });

  it('returns -1 when no point is within radius', () => {
    const pd = makePD([10], [10]);
    const idx = buildIndex(pd);
    expect(idx.findNearest(90, 90, 5)).toBe(-1);
  });

  it('returns -1 when tree is empty', () => {
    const idx = new QuadtreeIndex();
    expect(idx.findNearest(50, 50, 20)).toBe(-1);
  });
});

// ── QuadtreeIndex.queryByPixels ────────────────────────────────

describe('QuadtreeIndex.queryByPixels', () => {
  it('returns slots of points inside the AABB', () => {
    const pd = makePD([10, 50, 90], [10, 50, 90]);
    const idx = buildIndex(pd);
    const result = idx.queryByPixels(40, 40, 60, 60);
    expect(result).toEqual([1]); // only slot 1 at (50,50)
  });

  it('returns empty array when no tree is built', () => {
    const idx = new QuadtreeIndex();
    expect(idx.queryByPixels(0, 0, 100, 100)).toEqual([]);
  });

  it('returns all slots with a large AABB', () => {
    const pd = makePD([10, 50, 90], [10, 50, 90]);
    const idx = buildIndex(pd);
    const result = idx.queryByPixels(0, 0, 100, 100);
    expect(result.sort((a, b) => a - b)).toEqual([0, 1, 2]);
  });
});

// ── QuadtreeIndex.queryByPolygon ───────────────────────────────

describe('QuadtreeIndex.queryByPolygon', () => {
  it('returns slots of points inside a triangle', () => {
    const pd = makePD([5, 0, 5], [3, 10, 1], ['inside', 'outside', 'also-inside']);
    const idx = buildIndex(pd);
    const triangle: [number, number][] = [
      [0, 0],
      [10, 0],
      [5, 10],
    ];
    const result = idx.queryByPolygon(triangle);
    const slots = result.sort((a, b) => a - b);
    // slot 0 = (5,3) inside, slot 1 = (0,10) outside, slot 2 = (5,1) inside
    expect(slots).toEqual([0, 2]);
  });

  it('returns empty for polygon with < 3 vertices', () => {
    const pd = makePD([5], [5]);
    const idx = buildIndex(pd);
    expect(idx.queryByPolygon([[0, 0]])).toEqual([]);
    expect(
      idx.queryByPolygon([
        [0, 0],
        [10, 10],
      ]),
    ).toEqual([]);
  });

  it('returns empty when no tree is built', () => {
    const idx = new QuadtreeIndex();
    const square: [number, number][] = [
      [0, 0],
      [10, 0],
      [10, 10],
      [0, 10],
    ];
    expect(idx.queryByPolygon(square)).toEqual([]);
  });

  it('returns all slots with a large enclosing polygon', () => {
    const xs = Array.from({ length: 50 }, () => Math.random() * 80 + 10);
    const ys = Array.from({ length: 50 }, () => Math.random() * 80 + 10);
    const pd = makePD(xs, ys);
    const idx = buildIndex(pd);
    const bigSquare: [number, number][] = [
      [0, 0],
      [100, 0],
      [100, 100],
      [0, 100],
    ];
    const result = idx.queryByPolygon(bigSquare);
    expect(result.length).toBe(50);
  });

  it('handles concave polygon correctly', () => {
    // L-shape: bottom-left + top-left, but NOT top-right
    const lShape: [number, number][] = [
      [0, 0],
      [60, 0],
      [60, 40],
      [40, 40],
      [40, 80],
      [0, 80],
    ];
    const pd = makePD(
      [20, 50, 20, 50],
      [20, 20, 60, 60],
      ['bottom-left', 'bottom-right', 'top-left', 'top-right'],
    );
    const idx = buildIndex(pd);
    const result = idx.queryByPolygon(lShape);
    const slots = result.sort((a, b) => a - b);
    // slot 0 = (20,20) inside, slot 1 = (50,20) inside, slot 2 = (20,60) inside, slot 3 = (50,60) outside
    expect(slots).toEqual([0, 1, 2]);
    // Verify IDs via proteinIds
    const ids = slots.map((s) => pd.proteinIds[s]).sort();
    expect(ids).toEqual(['bottom-left', 'bottom-right', 'top-left']);
  });
});

// ── rebuild with explicit slots ────────────────────────────────

describe('QuadtreeIndex.rebuild with slot subset', () => {
  it('only indexes the provided slots', () => {
    const pd = makePD([10, 50, 90], [10, 50, 90]);
    const idx = new QuadtreeIndex();
    idx.setScales({
      x: d3.scaleLinear().domain([0, 100]).range([0, 100]),
      y: d3.scaleLinear().domain([0, 100]).range([0, 100]),
    });
    // Only index slots 0 and 2 (exclude slot 1 at 50,50)
    idx.rebuild(pd, [0, 2]);
    const result = idx.queryByPixels(40, 40, 60, 60);
    expect(result).toEqual([]); // slot 1 was not indexed
    const all = idx.queryByPixels(0, 0, 100, 100);
    expect(all.sort((a, b) => a - b)).toEqual([0, 2]);
  });

  it('sets qt to null when slots array is empty', () => {
    const pd = makePD([10, 50], [10, 50]);
    const idx = new QuadtreeIndex();
    idx.setScales({
      x: d3.scaleLinear().domain([0, 100]).range([0, 100]),
      y: d3.scaleLinear().domain([0, 100]).range([0, 100]),
    });
    idx.rebuild(pd, []);
    expect(idx.hasTree()).toBe(false);
  });
});
