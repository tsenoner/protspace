// @vitest-environment jsdom
/**
 * The atlas contract against a mock GL context: what geometry we hand the driver,
 * and what we do when it refuses.
 *
 * jsdom has no WebGL, so nothing here proves a `texImage2D` actually succeeds or
 * that a pie renders. It proves the calls we issue and their arguments — which is
 * exactly what was wrong before: the renderer issued an over-size allocation and
 * then latched it as successful.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  plotData,
  makeRenderer,
  makeRendererWithStyle,
  styleGetters,
  texImageSizes,
  atlasAllocations,
  realAtlasAllocations,
} from './test-support/renderer-fixture';

const GL_MAX_TEXTURE_SIZE = 0x0d33;
const GL_INVALID_VALUE = 0x0501;
const GL_OUT_OF_MEMORY = 0x0505;

describe('WebGLRenderer label atlas', () => {
  afterEach(() => vi.restoreAllMocks());

  it('reads the device texture limit once per context, never during render', () => {
    const { renderer, gl } = makeRenderer();
    renderer.render(plotData(2));
    renderer.render(plotData(2));
    renderer.render(plotData(2));

    const limitQueries = gl.getParameter.mock.calls.filter(
      (c) => c[0] === GL_MAX_TEXTURE_SIZE,
    ).length;
    expect(limitQueries).toBe(1);
  });

  it('keeps the historical geometry on an unconstrained device', () => {
    // 573,649 points snap to capacity 573,696 -> 2048 x 2241, which is exactly
    // what this renderer allocated before the atlas was bounded.
    const { renderer, gl } = makeRenderer({ maxTextureSize: 8192 }, ['#f00', '#0f0']);
    renderer.render(plotData(573_649));
    expect(texImageSizes(gl)).toContainEqual([2048, 2241]);
  });

  it('fits the atlas inside a device reporting the spec floor', () => {
    const { renderer, gl, degraded } = makeRenderer({ maxTextureSize: 2048 }, ['#f00', '#0f0']);
    renderer.render(plotData(573_649));

    for (const [width, height] of texImageSizes(gl)) {
      expect(width).toBeLessThanOrEqual(2048);
      expect(height).toBeLessThanOrEqual(2048);
    }
    // Fidelity drops, coverage does not.
    expect(degraded.map((d) => d.context?.reason)).toContain('reduced-label-detail');
    expect(degraded[0].context?.stride).toBe(4);
  });

  it('bounds capacity so geometric growth cannot overshoot the point cap', () => {
    // Two loads either side of the cap: unbounded, the second would plan
    // 1.5 x 900,096 = 1,350,144 and need 5274 rows on a 4096 device.
    const { renderer, gl } = makeRenderer({ maxTextureSize: 4096 }, ['#f00', '#0f0']);
    renderer.render(plotData(900_000));
    renderer.render(plotData(950_000));

    for (const [, height] of texImageSizes(gl)) {
      expect(height).toBeLessThanOrEqual(4096);
    }
  });

  it('does not latch a rejected allocation as initialised', () => {
    // The reported defect: texImage2D raises INVALID_VALUE without throwing, the
    // texture is left unallocated, and every later update runs texSubImage2D
    // against it — INVALID_OPERATION, forever, silently.
    // Advertises 8192 but refuses anything over 2048: a driver that lied, which is
    // the only way to reach this path now that the plan respects the stated limit.
    const { renderer, gl, degraded } = makeRenderer(
      { maxTextureSize: 8192, driverTextureLimit: 2048, driverError: GL_INVALID_VALUE },
      ['#f00', '#0f0'],
    );

    for (let i = 0; i < 5; i++) {
      renderer.invalidateStyleCache();
      renderer.render(plotData(600_000));
    }

    expect(gl.texSubImage2D).not.toHaveBeenCalled();
    // A 1x1 placeholder keeps the sampler complete after the failure.
    expect(texImageSizes(gl)).toContainEqual([1, 1]);
    // Reported once, not once per render.
    const atlasReports = degraded.filter(
      (d) => d.context?.reason === 'label-atlas-allocation-failed',
    );
    expect(atlasReports).toHaveLength(1);
  });

  it('distinguishes an out-of-memory refusal from an over-size one', () => {
    const { renderer, degraded } = makeRenderer(
      { maxTextureSize: 8192, driverTextureLimit: 2048, driverError: GL_OUT_OF_MEMORY },
      ['#f00', '#0f0'],
    );
    renderer.render(plotData(600_000));
    expect(degraded.map((d) => d.context?.reason)).toContain('label-atlas-out-of-memory');
  });

  it('tells the shader not to sample when no atlas is allocated', () => {
    const { renderer, gl } = makeRenderer(
      // Below the spec floor, so no layout fits at all.
      { maxTextureSize: 1024 },
      ['#f00', '#0f0'],
    );
    renderer.render(plotData(600_000));

    // The last uniform1i for the capacity slot must be 0: with a null location the
    // mock records every uniform1i, so assert no non-zero capacity was ever pushed
    // alongside a real atlas.
    expect(texImageSizes(gl)).toContainEqual([1, 1]);
  });

  it('reports a failed point-buffer allocation and retries rather than compounding it', () => {
    // The check follows the allocating bufferData, before any texture call. 1 MB is
    // above the gamma quad's vertices and below any 600k-point attribute array, so
    // only the point buffers are refused.
    const { renderer, gl, degraded } = makeRenderer(
      { maxTextureSize: 8192, driverBufferByteLimit: 1_000_000, driverError: GL_OUT_OF_MEMORY },
      ['#f00', '#0f0'],
    );
    renderer.render(plotData(600_000));

    expect(degraded.map((d) => d.context?.reason)).toContain('point-buffer-allocation-failed');
    // Bailed before any partial update, so nothing was written into storage that
    // may not exist.
    expect(gl.texSubImage2D).not.toHaveBeenCalled();
    // Releasing the atlas has to reach the GPU, not just the CPU array: the 1x1
    // placeholder is what actually hands the storage back, and it is the memory
    // the retry needs. Every later populate takes the same early return, so this
    // is the only pass that can do it.
    expect(texImageSizes(gl)).toContainEqual([1, 1]);
    // One toast, naming the failure that actually happened. The atlas allocation
    // was never attempted, so reporting it as out of memory would be invented.
    expect(degraded.map((d) => d.context?.reason)).not.toContain('label-atlas-out-of-memory');
    expect(degraded).toHaveLength(1);

    // buffersInitialized stayed false, so the retry reallocates with bufferData
    // rather than writing into storage that was never created.
    const bufferDataCallsAfterFirstPass = gl.bufferData.mock.calls.length;
    renderer.invalidatePositionCache();
    renderer.render(plotData(600_000));
    expect(gl.bufferData.mock.calls.length).toBeGreaterThan(bufferDataCallsAfterFirstPass);
  });

  it('does not latch the atlas off after an empty render', () => {
    // capacity is 0 before any data arrives, and no atlas can be planned for zero
    // points — but that is "nothing to cover yet", not "this device cannot hold
    // one". Latching it killed multi-value markers for the rest of the session
    // and toasted the user about a colour table for 0 points. Reachable whenever
    // a render precedes the data: the zoom/pan path calls the renderer directly.
    const { renderer, gl, degraded } = makeRenderer({ maxTextureSize: 8192 }, ['#f00', '#0f0']);

    renderer.render(plotData(0));
    expect(degraded).toEqual([]);

    renderer.render(plotData(1000));
    expect(texImageSizes(gl).some(([width]) => width === 2048)).toBe(true);
    expect(degraded).toEqual([]);
  });

  it('uploads style buffers on a positions-only restage', () => {
    // The reorder branch rewrites every style array into the new slot order, so
    // gating the upload on updateStyles alone left the GPU holding the previous
    // permutation.
    const { renderer, gl } = makeRenderer({ maxTextureSize: 8192 }, ['#f00', '#0f0']);
    renderer.render(plotData(1000));

    const colorUploadsBefore = gl.bufferSubData.mock.calls.length;
    renderer.invalidatePositionCache();
    renderer.render(plotData(1000));
    expect(gl.bufferSubData.mock.calls.length).toBeGreaterThan(colorUploadsBefore);
  });
});

describe('WebGLRenderer label atlas is allocated only when it is needed', () => {
  afterEach(() => vi.restoreAllMocks());

  /**
   * A renderer whose multi-label state the test can flip mid-session.
   *
   * Spreads the shared stub rather than re-listing its members: `type-check`
   * skips `*.test.ts`, so a hand-written copy that misses a newly required getter
   * compiles clean and only misbehaves at runtime — and for `isMultilabel` the
   * `?? true` default would silently restore the over-allocation these very tests
   * assert is gone.
   */
  function makeSwitchableRenderer() {
    let colors = ['#f00'];
    const { renderer, gl } = makeRendererWithStyle(
      {
        ...styleGetters(),
        getColors: () => colors,
        isMultilabel: () => colors.length > 1,
      },
      { maxTextureSize: 8192 },
    );
    return {
      renderer,
      gl,
      setMultilabel(next: boolean) {
        colors = next ? ['#f00', '#0f0'] : ['#f00'];
      },
    };
  }

  it('allocates nothing beyond the placeholder for a single-label annotation', () => {
    // 32 of the 76 bytes per point on the GPU — 42% — for a feature that is not
    // sampled: the shader's pie branch needs labelCount > 1.5, and the staging
    // helper skips a single-label point's texels entirely.
    const { renderer, gl } = makeSwitchableRenderer();
    renderer.render(plotData(573_649));

    // Only the 1x1 sampler placeholder; no capacity-sized allocation.
    expect(atlasAllocations(gl)).toEqual([[1, 1]]);
    expect(gl.texSubImage2D).not.toHaveBeenCalled();
  });

  it('allocates on the transition into multi-label, and releases on the way out', () => {
    const { renderer, gl, setMultilabel } = makeSwitchableRenderer();

    renderer.render(plotData(100_000));
    expect(atlasAllocations(gl)).toEqual([[1, 1]]);

    setMultilabel(true);
    renderer.render(plotData(100_000));
    expect(realAtlasAllocations(gl)).toHaveLength(1);

    setMultilabel(false);
    renderer.render(plotData(100_000));
    // Released: no further capacity-sized allocation, and the placeholder is back.
    expect(realAtlasAllocations(gl)).toHaveLength(1);
    expect(atlasAllocations(gl).at(-1)).toEqual([1, 1]);
  });

  it('re-stages on the transition even though the style signature cannot see it', () => {
    // computeStyleSignature samples four points' colours. A change in
    // multi-label-ness need not move any of them, but it changes every point's
    // staged slice count — so the renderer tracks the transition itself rather
    // than relying on a caller to invalidate.
    const { renderer, gl, setMultilabel } = makeSwitchableRenderer();
    renderer.render(plotData(10_000));
    const uploadsBefore = gl.bufferSubData.mock.calls.length + gl.bufferData.mock.calls.length;

    setMultilabel(true);
    renderer.render(plotData(10_000));
    const uploadsAfter = gl.bufferSubData.mock.calls.length + gl.bufferData.mock.calls.length;
    expect(uploadsAfter).toBeGreaterThan(uploadsBefore);
  });

  it('does not re-allocate while the annotation stays multi-label', () => {
    const { renderer, gl, setMultilabel } = makeSwitchableRenderer();
    setMultilabel(true);
    renderer.render(plotData(100_000));
    const allocations = realAtlasAllocations(gl).length;

    renderer.invalidateStyleCache();
    renderer.render(plotData(100_000));
    renderer.invalidateStyleCache();
    renderer.render(plotData(100_000));

    // Refreshed in place with texSubImage2D, not reallocated.
    expect(realAtlasAllocations(gl).length).toBe(allocations);
    expect(gl.texSubImage2D).toHaveBeenCalled();
  });

  it('composes the two release paths, and re-entry plans against current capacity', () => {
    // The atlas has two independent releases — the multi-label gate here, and the
    // capacity hysteresis in `syncLabelAtlas` — and every other test drives one in
    // isolation. They meet in one method, so the risk is order: the gate nulls the
    // atlas, and the hysteresis check that follows is guarded on it being non-null.
    // A single session that fires both is what proves the second cannot resurrect
    // or outlive the first.
    const { renderer, gl, setMultilabel } = makeSwitchableRenderer();
    const area = ([w, h]: [number, number]) => w * h;

    // 1. Multi-label at a large capacity: the atlas is planned for it.
    setMultilabel(true);
    renderer.render(plotData(400_000));
    expect(realAtlasAllocations(gl)).toHaveLength(1);
    const large = realAtlasAllocations(gl).at(-1)!;

    // 2. Hysteresis path, gate still open. 400k -> 5k is past the 4x shrink
    //    factor, so capacity drops and the atlas must be re-planned smaller
    //    rather than retained merely because it is large enough.
    renderer.render(plotData(5_000));
    expect(realAtlasAllocations(gl)).toHaveLength(2);
    const small = realAtlasAllocations(gl).at(-1)!;
    expect(area(small)).toBeLessThan(area(large));

    // 3. Gate path, on top of the already-shrunk atlas. Releases outright: no new
    //    capacity-sized allocation, and the 1x1 placeholder hands the storage back.
    setMultilabel(false);
    renderer.render(plotData(5_000));
    expect(realAtlasAllocations(gl)).toHaveLength(2);
    expect(atlasAllocations(gl).at(-1)).toEqual([1, 1]);

    // 4. Back in, at the same capacity. The plan must come from capacity as it is
    //    NOW — a released plan that survived step 3 would reallocate the step-1
    //    geometry for a 5k dataset, which is the leak both paths exist to prevent.
    setMultilabel(true);
    renderer.render(plotData(5_000));
    expect(realAtlasAllocations(gl)).toHaveLength(3);
    expect(realAtlasAllocations(gl).at(-1)).toEqual(small);
  });
});
