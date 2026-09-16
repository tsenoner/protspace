/**
 * Parity of the uniform-grid {@link QuadtreeIndex} with the d3-quadtree implementation it
 * replaced. `LegacyQuadtreeIndex` below is the previous implementation copied verbatim; every
 * assertion here compares the two over the same PlotData, slots and scales.
 *
 * Coordinates are generated on a 2^-22 lattice inside a domain/range pair whose scale is an
 * exact power-of-two multiply, so `Float32Array` storage in the new index is lossless and the
 * two implementations see bit-identical screen coordinates.
 */
import { describe, it, expect } from 'vitest';
import * as d3 from 'd3';
import { QuadtreeIndex, pointInPolygon } from './quadtree-index';
import type { PlotData } from '@protspace/utils';

// ── legacy implementation (verbatim), used as the reference ────

type IndexedSlot = { slot: number; px: number; py: number };

class LegacyQuadtreeIndex {
  private qt: d3.Quadtree<IndexedSlot> | null = null;
  private scales: { x: d3.ScaleLinear<number, number>; y: d3.ScaleLinear<number, number> } | null =
    null;

  setScales(
    scales: { x: d3.ScaleLinear<number, number>; y: d3.ScaleLinear<number, number> } | null,
  ) {
    this.scales = scales;
  }

  rebuild(pd: PlotData, slots: ArrayLike<number>) {
    if (!this.scales || slots.length === 0) {
      this.qt = null;
      return;
    }
    const sx = this.scales.x;
    const sy = this.scales.y;
    const n = slots.length;
    const indexed: IndexedSlot[] = new Array(n);
    for (let i = 0; i < n; i++) {
      const slot = slots[i];
      indexed[i] = { slot, px: sx(pd.xs[slot]), py: sy(pd.ys[slot]) };
    }
    this.qt = d3
      .quadtree<IndexedSlot>()
      .x((d) => d.px)
      .y((d) => d.py)
      .addAll(indexed);
  }

  findNearest(screenX: number, screenY: number, radius: number): number {
    if (!this.qt) return -1;
    const found = this.qt.find(screenX, screenY, radius);
    return found ? found.slot : -1;
  }

  hasTree(): boolean {
    return !!this.qt;
  }

  queryByPixels(minX: number, minY: number, maxX: number, maxY: number): number[] {
    if (!this.qt) return [];
    const results: number[] = [];
    this.qt.visit((node, x0, y0, x1, y1) => {
      if (!node.length) {
        let leaf: d3.QuadtreeLeaf<IndexedSlot> | undefined = node as d3.QuadtreeLeaf<IndexedSlot>;
        while (leaf) {
          const ip = leaf.data;
          if (ip.px >= minX && ip.px <= maxX && ip.py >= minY && ip.py <= maxY) {
            results.push(ip.slot);
          }
          leaf = leaf.next as d3.QuadtreeLeaf<IndexedSlot> | undefined;
        }
      }
      return x0 > maxX || x1 < minX || y0 > maxY || y1 < minY;
    });
    return results;
  }

  queryByPolygon(vertices: ReadonlyArray<[number, number]>): number[] {
    if (!this.qt || vertices.length < 3) return [];
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    for (const [x, y] of vertices) {
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
    const results: number[] = [];
    this.qt.visit((node, x0, y0, x1, y1) => {
      if (x0 > maxX || x1 < minX || y0 > maxY || y1 < minY) return true;
      if (!node.length) {
        let leaf: d3.QuadtreeLeaf<IndexedSlot> | undefined = node as d3.QuadtreeLeaf<IndexedSlot>;
        while (leaf) {
          const ip = leaf.data;
          if (
            ip.px >= minX &&
            ip.px <= maxX &&
            ip.py >= minY &&
            ip.py <= maxY &&
            pointInPolygon(ip.px, ip.py, vertices)
          ) {
            results.push(ip.slot);
          }
          leaf = leaf.next as d3.QuadtreeLeaf<IndexedSlot> | undefined;
        }
      }
      return false;
    });
    return results;
  }
}

// ── fixtures ───────────────────────────────────────────────────

/** Deterministic PRNG so any failure is reproducible. */
function makeRng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

const LATTICE = 1 << 22;
/** A data value whose screen coordinate (x * 1024) is exact in both float64 and float32. */
function latticeValue(rng: () => number): number {
  return Math.floor(rng() * LATTICE) / LATTICE;
}

function scales() {
  return {
    x: d3.scaleLinear().domain([0, 1]).range([0, 1024]),
    y: d3.scaleLinear().domain([0, 1]).range([0, 1024]),
  };
}

function makePD(xs: number[], ys: number[]): PlotData {
  return {
    length: xs.length,
    xs: new Float32Array(xs),
    ys: new Float32Array(ys),
    zs: null,
    originalIndices: null,
    proteinIds: xs.map((_, i) => `p${i}`),
  };
}

function buildBoth(pd: PlotData, slots: number[]) {
  const grid = new QuadtreeIndex();
  grid.setScales(scales());
  grid.rebuild(pd, slots);
  const legacy = new LegacyQuadtreeIndex();
  legacy.setScales(scales());
  legacy.rebuild(pd, slots);
  return { grid, legacy };
}

const sorted = (a: number[]) => [...a].sort((x, y) => x - y);

/** A random cloud, optionally with `dupes` extra points coincident with earlier ones. */
function randomCloud(n: number, seed: number, dupes = 0) {
  const rng = makeRng(seed);
  const xs: number[] = [];
  const ys: number[] = [];
  for (let i = 0; i < n; i++) {
    xs.push(latticeValue(rng));
    ys.push(latticeValue(rng));
  }
  for (let i = 0; i < dupes; i++) {
    const src = Math.floor(rng() * n);
    xs.push(xs[src]);
    ys.push(ys[src]);
  }
  return makePD(xs, ys);
}

// ── findNearest parity ─────────────────────────────────────────

describe('QuadtreeIndex findNearest parity with d3', () => {
  it('matches d3 over 4000 probes on a 3000-point cloud', () => {
    const pd = randomCloud(3000, 20260906);
    const slots = Array.from({ length: pd.length }, (_, i) => i);
    const { grid, legacy } = buildBoth(pd, slots);
    const rng = makeRng(31337);
    const mismatches: string[] = [];
    for (let t = 0; t < 4000; t++) {
      const x = rng() * 1100 - 40;
      const y = rng() * 1100 - 40;
      const r = [1, 5, 12, 40, 200][t % 5];
      const a = grid.findNearest(x, y, r);
      const b = legacy.findNearest(x, y, r);
      if (a !== b) mismatches.push(`(${x},${y}) r=${r}: grid=${a} d3=${b}`);
    }
    expect(mismatches).toEqual([]);
  });

  it('matches d3 with heavily duplicated (coincident) points', () => {
    const pd = randomCloud(400, 5150, 600);
    const slots = Array.from({ length: pd.length }, (_, i) => i);
    const { grid, legacy } = buildBoth(pd, slots);
    const rng = makeRng(24680);
    const mismatches: string[] = [];
    // Probe exactly on top of every point, plus random offsets.
    for (let i = 0; i < pd.length; i++) {
      const x = pd.xs[i] * 1024;
      const y = pd.ys[i] * 1024;
      for (const r of [0.5, 8, 60]) {
        const a = grid.findNearest(x, y, r);
        const b = legacy.findNearest(x, y, r);
        if (a !== b) mismatches.push(`on-point ${i} r=${r}: grid=${a} d3=${b}`);
      }
    }
    for (let t = 0; t < 2000; t++) {
      const x = rng() * 1024;
      const y = rng() * 1024;
      const r = [3, 20, 90][t % 3];
      const a = grid.findNearest(x, y, r);
      const b = legacy.findNearest(x, y, r);
      if (a !== b) mismatches.push(`(${x},${y}) r=${r}: grid=${a} d3=${b}`);
    }
    expect(mismatches).toEqual([]);
  });

  it('matches d3 on a tightly clustered cloud (many points per cell)', () => {
    const rng = makeRng(8080);
    const xs: number[] = [];
    const ys: number[] = [];
    for (let i = 0; i < 2000; i++) {
      xs.push(0.5 + Math.floor(rng() * 4096) / LATTICE);
      ys.push(0.5 + Math.floor(rng() * 4096) / LATTICE);
    }
    const pd = makePD(xs, ys);
    const slots = Array.from({ length: pd.length }, (_, i) => i);
    const { grid, legacy } = buildBoth(pd, slots);
    const probe = makeRng(1212);
    const mismatches: string[] = [];
    for (let t = 0; t < 2000; t++) {
      const x = 512 + probe() * 4 - 2;
      const y = 512 + probe() * 4 - 2;
      const r = [0.2, 1, 10][t % 3];
      const a = grid.findNearest(x, y, r);
      const b = legacy.findNearest(x, y, r);
      if (a !== b) mismatches.push(`(${x},${y}) r=${r}: grid=${a} d3=${b}`);
    }
    expect(mismatches).toEqual([]);
  });

  it('matches d3 for a sparse cloud where most probes find nothing', () => {
    const pd = randomCloud(20, 909090);
    const slots = Array.from({ length: pd.length }, (_, i) => i);
    const { grid, legacy } = buildBoth(pd, slots);
    const rng = makeRng(474747);
    for (let t = 0; t < 2000; t++) {
      const x = rng() * 1024;
      const y = rng() * 1024;
      const r = 3;
      expect(grid.findNearest(x, y, r)).toBe(legacy.findNearest(x, y, r));
    }
  });
});

// ── rect / polygon parity ──────────────────────────────────────

describe('QuadtreeIndex queryByPixels parity with d3', () => {
  it('matches d3 for 600 random rectangles', () => {
    const pd = randomCloud(4000, 606060, 300);
    const slots = Array.from({ length: pd.length }, (_, i) => i);
    const { grid, legacy } = buildBoth(pd, slots);
    const rng = makeRng(112233);
    for (let t = 0; t < 600; t++) {
      const x0 = rng() * 1200 - 100;
      const y0 = rng() * 1200 - 100;
      const w = rng() * 400;
      const h = rng() * 400;
      const a = sorted(grid.queryByPixels(x0, y0, x0 + w, y0 + h));
      const b = sorted(legacy.queryByPixels(x0, y0, x0 + w, y0 + h));
      expect(a).toEqual(b);
    }
  });

  it('matches d3 for degenerate and out-of-range rectangles', () => {
    const pd = randomCloud(500, 777, 100);
    const slots = Array.from({ length: pd.length }, (_, i) => i);
    const { grid, legacy } = buildBoth(pd, slots);
    const boxes: [number, number, number, number][] = [
      [-1e6, -1e6, 1e6, 1e6],
      [-500, -500, -400, -400],
      [2000, 2000, 3000, 3000],
      [0, 0, 0, 0],
      [512, 512, 512, 512],
      [pd.xs[0] * 1024, pd.ys[0] * 1024, pd.xs[0] * 1024, pd.ys[0] * 1024],
    ];
    for (const [a0, b0, a1, b1] of boxes) {
      expect(sorted(grid.queryByPixels(a0, b0, a1, b1))).toEqual(
        sorted(legacy.queryByPixels(a0, b0, a1, b1)),
      );
    }
  });

  it('matches d3 on an indexed subset of slots', () => {
    const pd = randomCloud(1500, 4321);
    const slots: number[] = [];
    for (let i = 0; i < pd.length; i += 3) slots.push(i);
    const { grid, legacy } = buildBoth(pd, slots);
    const rng = makeRng(8642);
    for (let t = 0; t < 200; t++) {
      const x0 = rng() * 1024;
      const y0 = rng() * 1024;
      expect(sorted(grid.queryByPixels(x0, y0, x0 + 150, y0 + 150))).toEqual(
        sorted(legacy.queryByPixels(x0, y0, x0 + 150, y0 + 150)),
      );
      expect(grid.findNearest(x0, y0, 40)).toBe(legacy.findNearest(x0, y0, 40));
    }
  });
});

describe('QuadtreeIndex queryByPolygon parity with d3', () => {
  it('matches d3 for 200 random convex-ish polygons', () => {
    const pd = randomCloud(4000, 191919, 200);
    const slots = Array.from({ length: pd.length }, (_, i) => i);
    const { grid, legacy } = buildBoth(pd, slots);
    const rng = makeRng(565656);
    for (let t = 0; t < 200; t++) {
      const cx = rng() * 1024;
      const cy = rng() * 1024;
      const rad = 40 + rng() * 300;
      const k = 3 + Math.floor(rng() * 6);
      const verts: [number, number][] = [];
      for (let v = 0; v < k; v++) {
        const ang = (v / k) * Math.PI * 2;
        const rr = rad * (0.5 + rng());
        verts.push([cx + Math.cos(ang) * rr, cy + Math.sin(ang) * rr]);
      }
      expect(sorted(grid.queryByPolygon(verts))).toEqual(sorted(legacy.queryByPolygon(verts)));
    }
  });

  it('matches d3 for a concave (star) polygon', () => {
    const pd = randomCloud(3000, 313131);
    const slots = Array.from({ length: pd.length }, (_, i) => i);
    const { grid, legacy } = buildBoth(pd, slots);
    const verts: [number, number][] = [];
    for (let v = 0; v < 16; v++) {
      const ang = (v / 16) * Math.PI * 2;
      const rr = v % 2 === 0 ? 400 : 120;
      verts.push([512 + Math.cos(ang) * rr, 512 + Math.sin(ang) * rr]);
    }
    expect(sorted(grid.queryByPolygon(verts))).toEqual(sorted(legacy.queryByPolygon(verts)));
    expect(sorted(grid.queryByPolygon(verts)).length).toBeGreaterThan(0);
  });
});

// ── edge cases ─────────────────────────────────────────────────

describe('QuadtreeIndex edge-case parity', () => {
  it('ignores NaN coordinates but still reports a built index, like d3', () => {
    const pd = makePD([NaN, 0.25, 0.5, 0.75], [0.25, NaN, NaN, 0.75]);
    const slots = [0, 1, 2, 3];
    const { grid, legacy } = buildBoth(pd, slots);
    expect(grid.hasTree()).toBe(legacy.hasTree());
    expect(grid.hasTree()).toBe(true);
    // Only slot 3 (0.75, 0.75) has two finite coordinates.
    expect(sorted(grid.queryByPixels(-1e6, -1e6, 1e6, 1e6))).toEqual(
      sorted(legacy.queryByPixels(-1e6, -1e6, 1e6, 1e6)),
    );
    expect(sorted(grid.queryByPixels(-1e6, -1e6, 1e6, 1e6))).toEqual([3]);
    expect(grid.findNearest(768, 768, 5)).toBe(legacy.findNearest(768, 768, 5));
  });

  it('skips infinite coordinates (d3 hangs in cover() on those, so no reference here)', () => {
    const pd = makePD([Infinity, 0.75], [0.5, 0.75]);
    const grid = new QuadtreeIndex();
    grid.setScales(scales());
    grid.rebuild(pd, [0, 1]);
    expect(sorted(grid.queryByPixels(-1e6, -1e6, 1e6, 1e6))).toEqual([1]);
    expect(grid.findNearest(768, 768, 5)).toBe(1);
  });

  it('reports an empty index when every coordinate is non-finite', () => {
    const pd = makePD([NaN, NaN], [NaN, NaN]);
    const { grid, legacy } = buildBoth(pd, [0, 1]);
    expect(grid.hasTree()).toBe(true);
    expect(legacy.hasTree()).toBe(true);
    expect(grid.queryByPixels(-1e6, -1e6, 1e6, 1e6)).toEqual([]);
    expect(grid.findNearest(0, 0, 1e6)).toBe(-1);
  });

  it('matches d3 when every point is coincident', () => {
    const xs = new Array(50).fill(0.5);
    const ys = new Array(50).fill(0.5);
    const pd = makePD(xs, ys);
    const slots = Array.from({ length: 50 }, (_, i) => i);
    const { grid, legacy } = buildBoth(pd, slots);
    expect(grid.findNearest(512, 512, 5)).toBe(legacy.findNearest(512, 512, 5));
    expect(sorted(grid.queryByPixels(500, 500, 520, 520))).toEqual(
      sorted(legacy.queryByPixels(500, 500, 520, 520)),
    );
  });

  it('excludes points at exactly the search radius, like d3', () => {
    const pd = makePD([0.5 + 10 / 1024], [0.5]);
    const { grid, legacy } = buildBoth(pd, [0]);
    expect(grid.findNearest(512, 512, 10)).toBe(legacy.findNearest(512, 512, 10));
    expect(grid.findNearest(512, 512, 10)).toBe(-1);
    expect(grid.findNearest(512, 512, 10.0001)).toBe(0);
  });

  it('clear() resets the index', () => {
    const pd = randomCloud(100, 1);
    const { grid } = buildBoth(
      pd,
      Array.from({ length: pd.length }, (_, i) => i),
    );
    expect(grid.hasTree()).toBe(true);
    grid.clear();
    expect(grid.hasTree()).toBe(false);
    expect(grid.queryByPixels(0, 0, 1024, 1024)).toEqual([]);
    expect(
      grid.queryByPolygon([
        [0, 0],
        [1024, 0],
        [1024, 1024],
      ]),
    ).toEqual([]);
    expect(grid.findNearest(512, 512, 100)).toBe(-1);
  });
});
