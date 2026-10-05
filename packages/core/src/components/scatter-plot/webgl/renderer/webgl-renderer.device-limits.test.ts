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
    // 1.5x growth from 3M plans 4.5M, past the 2048² texels the smallest WebGL2
    // device gives the mark texture: the marks would leave the GPU for 3.5M
    // points that fit.
    const { renderer, gl } = makeRenderer({ maxTextureSize: 2048 });
    renderer.render(plotData(3_000_000));
    renderer.render(plotData(3_500_000));

    expect(markAllocations(gl).at(-1)).toEqual([2048, 2048]);
    expect(renderer.canDrawMarks).toBe(true);
    expect(renderer.drawnPointCount).toBe(3_500_000);
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
