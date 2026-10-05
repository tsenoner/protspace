// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as d3 from 'd3';
import type { PlotData } from '@protspace/utils';
import type { ScalePair } from '../types';
import { makeRenderer as makeBaseRenderer } from './test-support/renderer-fixture';
import { internalsOf } from './test-support/renderer-internals';
import { createPerfCounters, perfCounters } from '../../../../utils/perf-counters';
import type * as PerfCounters from '../../../../utils/perf-counters';

vi.mock('../../../../utils/perf-counters', async (importOriginal) => {
  const actual = await importOriginal<typeof PerfCounters>();
  return { ...actual, perfCounters: actual.createPerfCounters() };
});

// A re-stage is the buffer rebuild render() runs iff a signature changed.
const counters = perfCounters!;

function pd(xs: number[], ys: number[]): PlotData {
  return {
    length: xs.length,
    xs: new Float32Array(xs),
    ys: new Float32Array(ys),
    zs: null,
    originalIndices: null,
    proteinIds: xs.map((_, i) => `p${i}`),
  };
}
const scales = (): ScalePair => ({
  x: d3.scaleLinear().domain([0, 10]).range([0, 800]),
  y: d3.scaleLinear().domain([0, 10]).range([0, 600]),
});
const makeRenderer = () => makeBaseRenderer({ getScales: scales, colors: ['#ff0000'] }).renderer;

describe('WebGLRenderer sampled-slot signatures (characterization lock)', () => {
  let renderer: ReturnType<typeof makeRenderer>;
  beforeEach(() => {
    renderer = makeRenderer();
    // Stub the gamma draw pass: this lock characterizes the signature/re-stage gate
    // only, not pixel output, so neutralizing the draw pass keeps render() cheap and leaves
    // every assertion intact.
    vi.spyOn(internalsOf(renderer), 'renderWithGammaCorrection').mockImplementation(() => {});
  });
  afterEach(() => vi.restoreAllMocks());

  it('a coordinate change at a SAMPLED slot (0, len/2, len-1) triggers a rebuild', () => {
    const a = pd([0, 1, 2], [0, 1, 2]);
    renderer.render(a);
    Object.assign(counters, createPerfCounters());
    renderer.render(pd([0, 1, 9], [0, 1, 2])); // slot 2 (= len-1) x changed
    expect(counters.restage).toBe(1);
  });

  it('LOCK (documents the lossy gap): a change at an UNSAMPLED slot is MISSED by the signature', () => {
    // Length 5 → sampled slots for data sig are {0, 2, 4}; slot 1 and 3 are NOT sampled.
    const a = pd([0, 1, 2, 3, 4], [0, 1, 2, 3, 4]);
    renderer.render(a);
    Object.assign(counters, createPerfCounters());
    // Mutate only slot 1 (unsampled): same length, identical at 0/2/4 → signature collides.
    renderer.render(pd([0, 99, 2, 3, 4], [0, 1, 2, 3, 4]));
    // Current behavior is INTENTIONALLY lossy; explicit invalidate*() covers real mutation paths.
    // Callers MUST keep an explicit invalidate on same-shape in-place coordinate swaps.
    expect(counters.restage).toBe(0);
  });

  it('positionsDirty (explicit invalidate) forces a rebuild even when signatures collide', () => {
    const a = pd([0, 1, 2, 3, 4], [0, 1, 2, 3, 4]);
    renderer.render(a);
    Object.assign(counters, createPerfCounters());
    renderer.invalidatePositionCache(); // the explicit path that backstops the lossy signature
    renderer.render(pd([0, 99, 2, 3, 4], [0, 1, 2, 3, 4]));
    expect(counters.restage).toBe(1);
  });
});

// ── Removal guards on a live WebGLRenderer instance ─────────────
// - The unused public getGamma/setGamma accessors are removed; the gamma
//   field and its effective-gamma resolver (getEffectiveGamma) stay.
// - The @deprecated no-op setSelectedAnnotation is removed; the live
//   invalidation methods survive.
describe('WebGLRenderer dead-accessor removal guards', () => {
  let renderer: ReturnType<typeof makeRenderer>;
  beforeEach(() => {
    renderer = makeRenderer();
  });
  afterEach(() => vi.restoreAllMocks());

  it('getGamma / setGamma are gone; getEffectiveGamma survives', () => {
    const surface = renderer as unknown as Record<string, unknown>;
    expect(surface.getGamma).toBeUndefined();
    expect(surface.setGamma).toBeUndefined();
    // getEffectiveGamma is private, which the indexed view reaches all the same.
    expect(typeof surface.getEffectiveGamma).toBe('function');
  });

  it('setSelectedAnnotation is gone; invalidateStyleCache survives', () => {
    const surface = renderer as unknown as Record<string, unknown>;
    expect(surface.setSelectedAnnotation).toBeUndefined();
    expect(typeof surface.invalidateStyleCache).toBe('function');
  });
});

describe('WebGLRenderer data signature — why re-materialisation was catastrophic (#456)', () => {
  it('a length change rebuilds even when every sampled slot is identical', () => {
    // This is the mechanism behind the 1M cliff. The viewport cull returned a
    // freshly materialised PlotData per camera move; its CONTENT at the sampled
    // slots was often unchanged, but its LENGTH moved as points entered and left
    // the viewport — and length is the first term of the signature. So a pan that
    // changed nothing visible still forced a full re-stage: an O(N log N) depth
    // sort, ~8 style-getter calls per point, and ~44 MB of uploads.
    //
    // The fix is upstream of this check, not in it: the renderer is now always
    // handed the same object, so the signature cannot move. The check itself is
    // correct and stays.
    const renderer = makeRenderer();
    vi.spyOn(internalsOf(renderer), 'renderWithGammaCorrection').mockImplementation(() => {});

    // Slot 6 leaves the viewport. The data signature samples slots 0, len/2 and
    // len-1, the style signature 0, len/4, len/2 and len-1: points p0, p2, p4
    // and p8 in both arrays, so only the length term tells them apart.
    const xs = [0, 1, 2, 3, 4, 5, 6, 7, 8];
    const full = pd(xs, xs);
    const kept = (_: unknown, i: number) => i !== 6;
    const subset: PlotData = {
      ...full,
      length: xs.length - 1,
      xs: full.xs.filter(kept),
      ys: full.ys.filter(kept),
      proteinIds: full.proteinIds.filter(kept),
    };

    renderer.render(full);
    Object.assign(counters, createPerfCounters());
    renderer.render(subset);
    expect(counters.restage).toBe(1);

    vi.restoreAllMocks();
  });
});
