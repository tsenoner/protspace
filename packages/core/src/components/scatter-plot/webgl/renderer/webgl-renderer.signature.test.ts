// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as d3 from 'd3';
import type { ScalePair } from '../types';
import {
  makeRenderer as makeFixtureRenderer,
  plotDataFrom as pd,
} from './test-support/renderer-fixture';

// This suite keeps its own [0, 10] data domain instead of the fixture's unit square.
const scales = (): ScalePair => ({
  x: d3.scaleLinear().domain([0, 10]).range([0, 800]),
  y: d3.scaleLinear().domain([0, 10]).range([0, 600]),
});
function makeRenderer() {
  return makeFixtureRenderer({}, ['#ff0000'], { getScales: scales }).renderer;
}

describe('WebGLRenderer sampled-slot signatures (F-02 characterization lock)', () => {
  let populateSpy: ReturnType<typeof vi.spyOn>;
  let renderer: ReturnType<typeof makeRenderer>;
  beforeEach(() => {
    renderer = makeRenderer();
    // populateBuffers is the buffer-rebuild gate render() runs iff a signature changed.
    populateSpy = vi
      .spyOn(
        renderer as unknown as { populateBuffers: (...a: unknown[]) => void },
        'populateBuffers',
      )
      .mockImplementation(() => {});
    // Stub the gamma draw pass: this lock characterizes the signature/populateBuffers gate
    // only, not pixel output, so neutralizing the draw pass keeps render() cheap and leaves
    // every assertion intact.
    vi.spyOn(
      renderer as unknown as { renderWithGammaCorrection: (...a: unknown[]) => void },
      'renderWithGammaCorrection',
    ).mockImplementation(() => {});
  });
  afterEach(() => vi.restoreAllMocks());

  it('a coordinate change at a SAMPLED slot (0, len/2, len-1) triggers a rebuild', () => {
    const a = pd([0, 1, 2], [0, 1, 2]);
    renderer.render(a);
    populateSpy.mockClear();
    renderer.render(pd([0, 1, 9], [0, 1, 2])); // slot 2 (= len-1) x changed
    expect(populateSpy).toHaveBeenCalled();
  });

  it('LOCK (documents the lossy gap, INV-12/INV-09): a change at an UNSAMPLED slot is MISSED by the signature', () => {
    // Length 5 → sampled slots for data sig are {0, 2, 4}; slot 1 and 3 are NOT sampled.
    const a = pd([0, 1, 2, 3, 4], [0, 1, 2, 3, 4]);
    renderer.render(a);
    populateSpy.mockClear();
    // Mutate only slot 1 (unsampled): same length, identical at 0/2/4 → signature collides.
    renderer.render(pd([0, 99, 2, 3, 4], [0, 1, 2, 3, 4]));
    // Current behavior is INTENTIONALLY lossy; explicit invalidate*() covers real mutation paths.
    // B6 MUST keep an explicit invalidate on same-shape in-place coordinate swaps (INV-12/INV-09).
    expect(populateSpy).not.toHaveBeenCalled();
  });

  it('positionsDirty (explicit invalidate) forces a rebuild even when signatures collide', () => {
    const a = pd([0, 1, 2, 3, 4], [0, 1, 2, 3, 4]);
    renderer.render(a);
    populateSpy.mockClear();
    renderer.invalidatePositionCache(); // the explicit path that backstops the lossy signature
    renderer.render(pd([0, 99, 2, 3, 4], [0, 1, 2, 3, 4]));
    expect(populateSpy).toHaveBeenCalled();
  });
});

describe('WebGLRenderer data signature — why re-materialisation was catastrophic (#456)', () => {
  it('a length change rebuilds even when every sampled coordinate is identical', () => {
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
    const populateSpy = vi
      .spyOn(
        renderer as unknown as { populateBuffers: (...a: unknown[]) => void },
        'populateBuffers',
      )
      .mockImplementation(() => {});
    vi.spyOn(
      renderer as unknown as { renderWithGammaCorrection: (...a: unknown[]) => void },
      'renderWithGammaCorrection',
    ).mockImplementation(() => {});

    // Same first, middle and last coordinates; one fewer point in between.
    const full = pd([0, 5, 5, 9], [0, 5, 5, 9]);
    const subset = pd([0, 5, 9], [0, 5, 9]);

    renderer.render(full);
    populateSpy.mockClear();
    renderer.render(subset);
    expect(populateSpy).toHaveBeenCalled();

    vi.restoreAllMocks();
  });
});
