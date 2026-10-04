/**
 * `queryByPolygon` classifies grid cells against the polygon and only runs `pointInPolygon` on
 * the points of cells an edge crosses. These tests pin its result to the plain per-point
 * reference (inclusive AABB, then `pointInPolygon`, then the visibility mask) on random,
 * concave, self-intersecting and degenerate polygons, with many points exactly on edges,
 * vertices and cell boundaries.
 */
import { describe, it, expect } from 'vitest';
import * as d3 from 'd3';
import { PointGridIndex, pointInPolygon } from './point-grid-index';
import type { PlotData } from '@protspace/utils';

type Poly = [number, number][];

function makeRng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
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

/** Per-point reference: what the query computed before cells were classified. */
function reference(pd: PlotData, polygon: Poly, visible: Uint8Array | null): number[] {
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const [x, y] of polygon) {
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  const out: number[] = [];
  for (let s = 0; s < pd.length; s++) {
    const x = pd.xs[s];
    const y = pd.ys[s];
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    if (x < minX || x > maxX || y < minY || y > maxY) continue;
    if (!pointInPolygon(x, y, polygon)) continue;
    if (visible && visible[s] !== 1) continue;
    out.push(s);
  }
  return out;
}

const sorted = (a: number[]) => [...a].sort((p, q) => p - q);

/** Random cloud plus lattice points and points on the polygon's vertices and edges. */
function cloudFor(polygon: Poly, rng: () => number, count: number, extent: number): PlotData {
  const xs: number[] = [];
  const ys: number[] = [];
  for (let i = 0; i < count; i++) {
    xs.push(rng() * extent);
    ys.push(rng() * extent);
  }
  for (let i = 0; i < count / 4; i++) {
    // Integers and halves: on rectilinear edges, on vertices and on cell boundaries.
    xs.push(Math.round(rng() * extent * 2) / 2);
    ys.push(Math.round(rng() * extent * 2) / 2);
  }
  for (let i = 0; i < polygon.length; i++) {
    const [ax, ay] = polygon[i];
    const [bx, by] = polygon[(i + 1) % polygon.length];
    xs.push(ax, (ax + bx) / 2, ax + (bx - ax) * rng());
    ys.push(ay, (ay + by) / 2, ay + (by - ay) * rng());
  }
  return makePD(xs, ys);
}

function check(pd: PlotData, polygon: Poly, rng: () => number, maskSome: boolean) {
  const idx = new PointGridIndex();
  // Identity scale, so the Float32Array values are the screen coordinates.
  idx.setScales({
    x: d3.scaleLinear().domain([0, 1]).range([0, 1]),
    y: d3.scaleLinear().domain([0, 1]).range([0, 1]),
  });
  idx.rebuild(
    pd,
    Array.from({ length: pd.length }, (_, i) => i),
  );
  let visible: Uint8Array | null = null;
  if (maskSome) {
    visible = new Uint8Array(pd.length);
    for (let i = 0; i < pd.length; i++) visible[i] = rng() < 0.7 ? 1 : 0;
    idx.setVisible(visible);
  }
  const got = idx.queryByPolygon(polygon);
  expect(sorted(got)).toEqual(reference(pd, polygon, visible));
  expect(new Set(got).size).toBe(got.length);
}

function starPolygon(rng: () => number, extent: number): Poly {
  const cx = rng() * extent;
  const cy = rng() * extent;
  const rad = 20 + rng() * extent * 0.6;
  const k = 3 + Math.floor(rng() * 30);
  const out: Poly = [];
  for (let v = 0; v < k; v++) {
    const ang = (v / k) * Math.PI * 2;
    const rr = rad * (v % 2 === 0 ? 1 : 0.2 + rng() * 0.8);
    out.push([cx + Math.cos(ang) * rr, cy + Math.sin(ang) * rr]);
  }
  return out;
}

/** Vertices in random order: almost always self-intersecting. */
function scrambledPolygon(rng: () => number, extent: number): Poly {
  const k = 4 + Math.floor(rng() * 12);
  const out: Poly = [];
  for (let v = 0; v < k; v++) out.push([rng() * extent, rng() * extent]);
  return out;
}

/** A mouse-drawn lasso: a long random walk that loops over itself, closed by a long edge. */
function lassoPath(rng: () => number, extent: number): Poly {
  const out: Poly = [];
  let x = rng() * extent;
  let y = rng() * extent;
  let ang = rng() * Math.PI * 2;
  const steps = 50 + Math.floor(rng() * 400);
  for (let s = 0; s < steps; s++) {
    out.push([x, y]);
    ang += (rng() - 0.45) * 0.6;
    const step = 1 + rng() * 6;
    x += Math.cos(ang) * step;
    y += Math.sin(ang) * step;
  }
  return out;
}

/** Integer rectilinear polygon (edges on lattice lines), with repeated and collinear vertices. */
function rectilinearPolygon(rng: () => number, extent: number): Poly {
  const out: Poly = [];
  let x = Math.floor(rng() * extent);
  let y = Math.floor(rng() * extent);
  const k = 2 + Math.floor(rng() * 8);
  for (let v = 0; v < k; v++) {
    out.push([x, y]);
    if (rng() < 0.2) out.push([x, y]);
    x = Math.floor(rng() * extent);
    out.push([x, y]);
    if (rng() < 0.2) out.push([(x + out[out.length - 2][0]) / 2, y]);
    y = Math.floor(rng() * extent);
  }
  out.push([x, out[0][1]]);
  return out;
}

describe('PointGridIndex.queryByPolygon matches the per-point test', () => {
  const kinds: [string, (rng: () => number, extent: number) => Poly][] = [
    ['star (concave)', starPolygon],
    ['scrambled (self-intersecting)', scrambledPolygon],
    ['lasso random walk', lassoPath],
    ['rectilinear on the lattice', rectilinearPolygon],
  ];

  for (const [name, make] of kinds) {
    it(`${name} polygons`, () => {
      const rng = makeRng(name.length * 7919);
      for (let t = 0; t < 60; t++) {
        // Vary density so cells span the MIN_CELL_PX..MAX_CELL_PX range.
        const extent = [64, 256, 512][t % 3];
        const count = [400, 3000, 9000][Math.floor(t / 3) % 3];
        const polygon = make(rng, extent);
        check(cloudFor(polygon, rng, count, extent), polygon, rng, t % 2 === 1);
      }
    });
  }

  it('figure-eight, a polygon tracing itself twice, and a degenerate sliver', () => {
    const rng = makeRng(42);
    const polygons: Poly[] = [
      [
        [10, 10],
        [200, 200],
        [200, 10],
        [10, 200],
      ],
      [
        [20, 20],
        [180, 20],
        [180, 180],
        [20, 180],
        [20, 20],
        [180, 20],
        [180, 180],
        [20, 180],
      ],
      [
        [0, 0],
        [256, 256],
        [0, 0.0001],
      ],
      [
        [32, 32],
        [32, 32],
        [32, 32],
      ],
    ];
    for (const polygon of polygons) {
      check(cloudFor(polygon, rng, 6000, 256), polygon, rng, false);
      check(cloudFor(polygon, rng, 6000, 256), polygon, rng, true);
    }
  });

  it('falls back to the per-point test when a vertex is not finite', () => {
    const rng = makeRng(7);
    const polygon: Poly = [
      [10, 10],
      [200, 10],
      [NaN, 100],
      [200, 200],
      [10, 200],
    ];
    const pd = cloudFor(
      polygon.filter(([x]) => Number.isFinite(x)),
      rng,
      3000,
      256,
    );
    check(pd, polygon, rng, false);
  });
});
