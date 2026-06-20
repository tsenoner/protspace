// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as d3 from 'd3';
import { WebGLRenderer } from './webgl-renderer';
import type { PlotData } from '@protspace/utils';
import type { ScalePair, WebGLStyleGetters } from '../types';
import { createMockCanvas } from './test-support/mock-webgl2';

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
const style = (): WebGLStyleGetters => ({
  getColors: () => ['#ff0000'],
  getPointSize: () => 9,
  getOpacity: () => 1,
  getDepth: () => 0,
  getStrokeColor: () => '#000',
  getStrokeWidth: () => 0,
  getShape: () => 'circle',
});

function makeRenderer() {
  const { canvas } = createMockCanvas();
  return new WebGLRenderer(
    canvas,
    scales,
    () => d3.zoomIdentity,
    () => ({ width: 800, height: 600 }),
    style(),
  );
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
