// @vitest-environment jsdom
/**
 * What the renderer actually draws, and what it uploads.
 *
 * Every point it is handed. A clamp used to cut at 1,000,000 and later at
 * 2,000,000 — silently, by array position, while the UI went on reporting the
 * full count.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import * as d3 from 'd3';
import {
  plotData,
  styleGetters,
  makeRenderer as makeBaseRenderer,
  makeRendererWithStyle,
  markAllocations,
  realAtlasAllocations,
} from './test-support/renderer-fixture';

/**
 * Pass two colours for anything asserting on the label atlas: it is only
 * allocated when it would be sampled, so a single-label renderer plans none and
 * the assertion passes vacuously.
 */
const makeRenderer = (colors?: string[]) => makeBaseRenderer({ maxTextureSize: 8192 }, colors);

describe('WebGLRenderer draw count', () => {
  afterEach(() => vi.restoreAllMocks());

  it.each([2048, 8192])('draws 3,000,000 points on a %i device', (maxTextureSize) => {
    const { renderer, gl } = makeBaseRenderer({ maxTextureSize });
    renderer.render(plotData(3_000_000));
    expect(renderer.drawnPointCount).toBe(3_000_000);

    // A mark texel per point, in rows the device allows.
    const [width, rows] = markAllocations(gl).at(-1)!;
    expect(width).toBe(maxTextureSize);
    expect(rows).toBeLessThanOrEqual(maxTextureSize);
    expect(width * rows).toBeGreaterThanOrEqual(3_000_000);
    expect(renderer.canDrawMarks).toBe(true);
  });
});

describe('WebGLRenderer upload accounting', () => {
  afterEach(() => vi.restoreAllMocks());

  it('uploads nothing when neither the data nor the styling changed', () => {
    // This is the #456 fix stated as an invariant: a repeat render of the SAME
    // object — which is what a camera move now produces at every dataset size —
    // must not touch the GPU's buffers.
    const { renderer } = makeRenderer();
    const pd = plotData(50_000);

    renderer.render(pd);
    const afterFirst = renderer.uploadedBytesTotal;
    expect(afterFirst).toBeGreaterThan(0);

    renderer.render(pd);
    renderer.render(pd);
    expect(renderer.uploadedBytesTotal).toBe(afterFirst);
  });

  it('grows dots on zoom-in through a uniform, uploading nothing', () => {
    let transform = d3.zoomIdentity;
    const { renderer } = makeRendererWithStyle(
      styleGetters(),
      {},
      { getTransform: () => transform },
    );
    const pd = plotData(50_000);

    renderer.render(pd);
    const afterFirst = renderer.uploadedBytesTotal;
    expect(renderer.pointScale()).toBeCloseTo(0.90999, 5);

    transform = d3.zoomIdentity.scale(4);
    renderer.render(pd);
    expect(renderer.pointScale()).toBeCloseTo(1.28692, 5);
    expect(renderer.uploadedBytesTotal).toBe(afterFirst);
  });

  it('uploads again when the styling really does change', () => {
    const { renderer } = makeRenderer();
    const pd = plotData(50_000);
    renderer.render(pd);
    const afterFirst = renderer.uploadedBytesTotal;

    renderer.invalidateStyleCache();
    renderer.render(pd);
    expect(renderer.uploadedBytesTotal).toBeGreaterThan(afterFirst);
  });
});

describe('WebGLRenderer capacity shrink', () => {
  afterEach(() => vi.restoreAllMocks());

  it('releases an outsized footprint when a much smaller dataset replaces it', () => {
    // Grow-only, "load 2M then open the 5K demo" would hold the larger footprint
    // for the rest of the session. The bytes counter is the observable
    // proxy for the footprint — and the atlas is the bulk of it, so this needs
    // the multi-label renderer or those bytes never enter the count.
    const { renderer } = makeRenderer(['#f00', '#0f0']);
    renderer.render(plotData(400_000));
    const afterLarge = renderer.uploadedBytesTotal;

    renderer.render(plotData(5_000));
    const smallUpload = renderer.uploadedBytesTotal - afterLarge;

    // A reallocation happened (so bytes moved) and it was far smaller than the
    // large load, i.e. sized to the new data rather than to the old capacity.
    expect(smallUpload).toBeGreaterThan(0);
    expect(smallUpload).toBeLessThan(afterLarge / 4);
  });

  it('releases the label atlas too, not just the SoA arrays', () => {
    // The atlas is the largest capacity-sized resource there is — 64 MB of CPU
    // texels at a 2,000,000 plan, plus its GPU storage. `syncLabelAtlas` skips
    // re-planning whenever the existing plan is large enough, which is *always*
    // true after a shrink, so it followed the same hysteresis or the shrink
    // handed back only the arrays and kept the biggest allocation for the session.
    const { renderer, gl } = makeRenderer(['#f00', '#0f0']);
    renderer.render(plotData(400_000));
    // Atlas allocations specifically: the unfiltered texImage2D list also holds
    // the gamma pipeline's canvas-sized texture, so `.at(-1)` on it would be
    // "the last texture allocated", not "the atlas".
    const afterLarge = realAtlasAllocations(gl).at(-1)!;

    renderer.render(plotData(5_000));
    const afterSmall = realAtlasAllocations(gl).at(-1)!;
    expect(afterSmall[0] * afterSmall[1]).toBeLessThan(afterLarge[0] * afterLarge[1]);
  });

  it('does not thrash on an ordinary dataset switch', () => {
    // Within 4x, capacity is retained: the second load must reuse the buffers
    // rather than reallocate them — including the atlas, hence two colours.
    const { renderer, gl } = makeRenderer(['#f00', '#0f0']);
    renderer.render(plotData(400_000));
    const bufferDataCalls = gl.bufferData.mock.calls.length;
    const texImageCalls = gl.texImage2D.mock.calls.length;

    renderer.render(plotData(200_000));
    expect(gl.bufferData.mock.calls.length).toBe(bufferDataCalls);
    expect(gl.texImage2D.mock.calls.length).toBe(texImageCalls);
  });
});
