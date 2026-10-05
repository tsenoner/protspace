import { describe, it, expect } from 'vitest';
import * as d3 from 'd3';
import { IDENTITY_RESCALE, linearAxis, mapLinear, rescaleBetween, snapshotScales } from './rescale';

const scales = (width: number, height: number, domain: [number, number] = [-3, 7]) => ({
  x: d3
    .scaleLinear()
    .domain(domain)
    .range([40, width - 40]),
  y: d3
    .scaleLinear()
    .domain(domain)
    .range([height - 40, 40]),
});

describe('rescaleBetween', () => {
  it('returns the identity itself for equal scales', () => {
    expect(rescaleBetween(snapshotScales(scales(800, 600)), scales(800, 600))).toBe(
      IDENTITY_RESCALE,
    );
  });

  it('carries pixels laid out at one size to where the other size puts them', () => {
    const from = scales(800, 600);
    const to = scales(1440, 900);
    const r = rescaleBetween(snapshotScales(from), to)!;
    for (const v of [-3, -1.25, 0, 2.5, 7]) {
      expect(from.x(v) * r.x.scale + r.x.offset).toBeCloseTo(to.x(v), 9);
      expect(from.y(v) * r.y.scale + r.y.offset).toBeCloseTo(to.y(v), 9);
    }
  });

  it('keeps a degenerate domain on the range midpoint', () => {
    const from = scales(800, 600, [2, 2]);
    const to = scales(1000, 500, [2, 2]);
    const r = rescaleBetween(snapshotScales(from), to)!;
    expect(from.x(2) * r.x.scale + r.x.offset).toBeCloseTo(to.x(2), 9);
    expect(from.y(2) * r.y.scale + r.y.offset).toBeCloseTo(to.y(2), 9);
  });

  it('has no answer for a new domain or a collapsed or flipped range', () => {
    const from = snapshotScales(scales(800, 600));
    expect(rescaleBetween(from, scales(800, 600, [-3, 8]))).toBeNull();
    // 80 px wide: the 40 px margins meet, and below that the range flips.
    expect(rescaleBetween(from, scales(80, 600))).toBeNull();
    expect(rescaleBetween(from, scales(60, 600))).toBeNull();
    expect(rescaleBetween(snapshotScales(scales(80, 600)), scales(800, 600))).toBeNull();
  });

  it('copies the scales, so changing them later cannot move the snapshot', () => {
    const s = scales(800, 600);
    const snap = snapshotScales(s);
    s.x.range([0, 10]);
    expect(rescaleBetween(snap, scales(800, 600))).toBe(IDENTITY_RESCALE);
  });
});

describe('mapLinear', () => {
  // Float32 inputs, as plot data holds them, spread over and past the domain.
  const inputs = Float32Array.from({ length: 20000 }, (_, i) => Math.sin(i * 12.9898) * 1e3);

  it.each([
    ['ascending', [-137.25, 412.5], [40, 1873.5]],
    ['flipped range', [-3, 7], [860, 40]],
    ['descending domain', [9.75, -0.125], [12, 990]],
    ['tiny span', [1e-7, 1.0000001e-7], [0, 1024]],
  ] as const)('returns exactly what the d3 scale returns (%s)', (_, domain, range) => {
    const scale = d3.scaleLinear().domain(domain).range(range);
    const axis = linearAxis(scale);
    for (const x of inputs) expect(mapLinear(axis, x)).toBe(scale(x));
    for (const x of [domain[0], domain[1], 0, Infinity, -Infinity]) {
      expect(mapLinear(axis, x)).toBe(scale(x));
    }
  });

  it('puts every point of a single-point domain mid-range, as d3 does', () => {
    const scale = d3.scaleLinear().domain([4, 4]).range([10, 30]);
    const axis = linearAxis(scale);
    for (const x of [4, -1, 1e6]) expect(mapLinear(axis, x)).toBe(scale(x));
  });

  it('maps NaN to NaN, which is what d3 returning undefined stages as', () => {
    const staged = new Float32Array(2);
    for (const domain of [
      [0, 1],
      [2, 2],
    ]) {
      const scale = d3.scaleLinear().domain(domain).range([0, 100]);
      staged[0] = mapLinear(linearAxis(scale), NaN);
      staged[1] = scale(NaN) as number;
      expect(staged[0]).toBeNaN();
      expect(staged[1]).toBeNaN();
    }
  });
});
