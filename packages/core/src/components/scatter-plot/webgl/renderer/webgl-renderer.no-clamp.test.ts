// @vitest-environment jsdom
/**
 * What the renderer actually draws, and what it uploads.
 *
 * The clamp used to cut at 1,000,000 — silently, by array position, while the UI
 * went on reporting the full count. It is still there (an embedder can assign
 * `.data` directly, bypassing the loader) but it now sits at the loader's own
 * cap, so nothing a user can load reaches it.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { MAX_RENDERABLE_POINTS } from '../types';
import {
  plotData,
  makeRenderer as makeBaseRenderer,
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

  it('draws every point at exactly the cap', () => {
    // Also covers the whole range above the old 1,000,000 threshold, where the
    // renderer used to draw half: the clamp is `min(length, cap)`, so the cap
    // itself is the only interesting point below it.
    const { renderer } = makeRenderer();
    renderer.render(plotData(MAX_RENDERABLE_POINTS));
    expect(renderer.drawnPointCount).toBe(MAX_RENDERABLE_POINTS);
  });

  it('still clamps beyond the cap, and the shortfall is observable', () => {
    // Only reachable by an embedder assigning `.data` directly. The point of the
    // accessor is that this state can be seen at all.
    const { renderer } = makeRenderer();
    const overCap = MAX_RENDERABLE_POINTS + 500_000;
    renderer.render(plotData(overCap));
    expect(renderer.drawnPointCount).toBe(MAX_RENDERABLE_POINTS);
    expect(renderer.drawnPointCount).toBeLessThan(overCap);
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
    // Grow-only capacity was harmless while the clamp bounded it at 1,000,000.
    // At a 2,000,000 cap, "load 2M then open the 5K demo" would hold the larger
    // footprint for the rest of the session. The bytes counter is the observable
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
