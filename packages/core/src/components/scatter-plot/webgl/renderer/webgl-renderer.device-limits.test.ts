// @vitest-environment jsdom
/**
 * What bounds the renderer's capacity: the device, not a point cap.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import type { PlotData } from '@protspace/utils';
import { plotData, makeRenderer, markAllocations } from './test-support/renderer-fixture';

/** The renderer's drawable limit: a_color, at 16 bytes a point, fills 1 GiB. */
const DRAWABLE_LIMIT = 2 ** 26;

/** `length` points that all read as protein 'p' at (0, 0), with no arrays that long. */
function sparsePlotData(length: number): PlotData {
  const zeros = new Proxy({}, { get: () => 0 }) as unknown as Float32Array;
  const ids = new Proxy({}, { get: () => 'p' }) as unknown as string[];
  return { ...plotData(0), length, xs: zeros, ys: zeros, proteinIds: ids };
}

describe('WebGLRenderer device limits', () => {
  afterEach(() => vi.restoreAllMocks());

  it('grows no further than the mark texture the device allows', () => {
    // 1.5x growth from 800K plans 1.2M, past the 1024² texels a 1024 device gives
    // the mark texture: the marks would leave the GPU for 900K points that fit.
    const { renderer, gl } = makeRenderer({ maxTextureSize: 1024 });
    renderer.render(plotData(800_000));
    renderer.render(plotData(900_000));

    expect(markAllocations(gl).at(-1)).toEqual([1024, 1024]);
    expect(renderer.canDrawMarks).toBe(true);
    expect(renderer.drawnPointCount).toBe(900_000);
  });

  it('draws nothing past the drawable limit, says so once, and allocates nothing', () => {
    const { renderer, gl, degraded } = makeRenderer();
    const tooMany = sparsePlotData(DRAWABLE_LIMIT + 1);
    renderer.render(tooMany);
    const bufferData = gl.bufferData.mock.calls.length;
    renderer.invalidateStyleCache();
    renderer.render(tooMany);

    expect(renderer.drawnPointCount).toBe(0);
    // The point buffers are allocated with the mark texture, so none was; and
    // the second pass did not try again.
    expect(markAllocations(gl)).toEqual([]);
    expect(gl.bufferData.mock.calls.length).toBe(bufferData);
    expect(degraded.map((d) => d.context?.reason)).toEqual(['point-limit-exceeded']);
    expect(degraded[0].message).toContain(DRAWABLE_LIMIT.toLocaleString());

    // The next dataset that fits stages as usual.
    renderer.render(plotData(10_000));
    expect(renderer.drawnPointCount).toBe(10_000);
  });
});
