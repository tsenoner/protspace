import { describe, it, expect, vi } from 'vitest';
import {
  readMaxTextureSize,
  sanitizeMaxTextureSize,
  drainGlErrors,
  allocateLabelAtlas,
  refreshLabelAtlas,
  uploadPlaceholderAtlas,
} from './label-atlas-texture';
import { MIN_MAX_TEXTURE_SIZE, type LabelAtlasPlan } from './label-atlas-plan';

const GL = {
  TEXTURE_2D: 0x0de1,
  RGBA: 0x1908,
  RGBA8: 0x8058,
  UNSIGNED_BYTE: 0x1401,
  MAX_TEXTURE_SIZE: 0x0d33,
  TEXTURE_MIN_FILTER: 0x2801,
  TEXTURE_MAG_FILTER: 0x2800,
  NEAREST: 0x2600,
  NO_ERROR: 0,
  INVALID_VALUE: 0x0501,
};

/**
 * A GL stub whose error flag behaves like the real one: sticky, holding the FIRST
 * error until `getError` returns and clears it. That is the only property these
 * helpers depend on, and the one the un-drained version got wrong.
 */
function mockGL(opts: { errors?: number[]; maxTextureSize?: unknown } = {}) {
  const queue = [...(opts.errors ?? [])];
  let flag: number = GL.NO_ERROR;
  const gl = {
    ...GL,
    getParameter: vi.fn(() => opts.maxTextureSize),
    getError: vi.fn(() => {
      const raised = flag;
      flag = GL.NO_ERROR;
      return raised;
    }),
    texImage2D: vi.fn(() => {
      const next = queue.shift();
      if (next && flag === GL.NO_ERROR) flag = next;
    }),
    texSubImage2D: vi.fn(),
    texParameteri: vi.fn(),
  };
  return {
    gl: gl as unknown as WebGL2RenderingContext,
    spies: gl,
    /** Simulate an error raised by some earlier, unrelated call. */
    raiseStale: (code: number) => {
      flag = code;
    },
  };
}

const plan = (over: Partial<LabelAtlasPlan> = {}): LabelAtlasPlan => ({
  width: 2048,
  height: 2241,
  stride: 8,
  pointCapacity: 573_696,
  byteLength: 2048 * 2241 * 4,
  ...over,
});

describe('sanitizeMaxTextureSize', () => {
  it('falls back to the spec floor for anything unusable', () => {
    for (const bad of [undefined, null, NaN, Infinity, 0, -1, '4096']) {
      expect(sanitizeMaxTextureSize(bad)).toBe(MIN_MAX_TEXTURE_SIZE);
    }
  });

  it('passes a usable limit through', () => {
    expect(sanitizeMaxTextureSize(4096)).toBe(4096);
  });
});

describe('readMaxTextureSize', () => {
  it('reads the device limit', () => {
    expect(readMaxTextureSize(mockGL({ maxTextureSize: 16384 }).gl)).toBe(16384);
  });

  it('substitutes the spec floor when the driver reports nonsense', () => {
    expect(readMaxTextureSize(mockGL({ maxTextureSize: null }).gl)).toBe(MIN_MAX_TEXTURE_SIZE);
  });
});

describe('drainGlErrors', () => {
  it('clears a stale flag and terminates when clean', () => {
    const { gl, spies, raiseStale } = mockGL();
    raiseStale(GL.INVALID_VALUE);
    drainGlErrors(gl);
    expect(spies.getError()).toBe(GL.NO_ERROR);
  });
});

describe('allocateLabelAtlas', () => {
  it('reports NO_ERROR and sets NEAREST filtering when the driver accepts it', () => {
    const { gl, spies } = mockGL();
    expect(allocateLabelAtlas(gl, plan(), new Uint8Array(4))).toBe(GL.NO_ERROR);
    expect(spies.texImage2D).toHaveBeenCalledWith(
      GL.TEXTURE_2D,
      0,
      GL.RGBA8,
      2048,
      2241,
      0,
      GL.RGBA,
      GL.UNSIGNED_BYTE,
      expect.any(Uint8Array),
    );
    expect(spies.texParameteri).toHaveBeenCalledTimes(2);
  });

  it('does not inherit an error raised before it ran', () => {
    // The regression this guards: the GL error flag is context-wide and sticky, so
    // without a drain the check after texImage2D reports the FIRST error raised
    // anywhere in the context's life — a failed vertex-buffer upload, say — and
    // permanently disables the atlas over someone else's failure.
    const { gl, raiseStale } = mockGL();
    raiseStale(GL.INVALID_VALUE);
    expect(allocateLabelAtlas(gl, plan(), new Uint8Array(4))).toBe(GL.NO_ERROR);
  });

  it("reports the driver's refusal, and leaves filtering unset", () => {
    const { gl, spies } = mockGL({ errors: [GL.INVALID_VALUE] });
    expect(allocateLabelAtlas(gl, plan(), new Uint8Array(4))).toBe(GL.INVALID_VALUE);
    expect(spies.texParameteri).not.toHaveBeenCalled();
  });
});

describe('uploadPlaceholderAtlas', () => {
  it('uploads one opaque texel and sets NEAREST filtering', () => {
    const { gl, spies } = mockGL();
    uploadPlaceholderAtlas(gl);
    const [, , , width, height] = spies.texImage2D.mock.calls[0] as unknown[];
    expect([width, height]).toEqual([1, 1]);
    expect(spies.texParameteri).toHaveBeenCalledTimes(2);
  });
});

describe('refreshLabelAtlas', () => {
  it('uploads only the rows the drawn points occupy, not the whole capacity', () => {
    // Storage is sized from capacity, which overshoots the drawn count after a
    // geometric grow — and this runs on every recolor.
    const { gl, spies } = mockGL();
    const p = plan({ height: 3362, pointCapacity: 860_544 });
    refreshLabelAtlas(gl, p, new Uint8Array(p.width * p.height * 4), 700_000);

    const [, , , , , height, , , texels] = spies.texSubImage2D.mock.calls[0] as unknown[];
    const expectedRows = Math.ceil((700_000 * 8) / 2048); // 2735
    expect(height).toBe(expectedRows);
    expect(height).toBeLessThan(p.height);
    expect((texels as Uint8Array).length).toBe(expectedRows * 2048 * 4);
  });

  it('covers every drawn point when the count fills the atlas exactly', () => {
    const { gl, spies } = mockGL();
    const p = plan();
    refreshLabelAtlas(gl, p, new Uint8Array(p.byteLength), p.pointCapacity);

    const [, , , , , height] = spies.texSubImage2D.mock.calls[0] as unknown[];
    expect((height as number) * p.width).toBeGreaterThanOrEqual(p.pointCapacity * p.stride);
    expect(height).toBeLessThanOrEqual(p.height);
  });

  it('uploads nothing when no points are drawn', () => {
    const { gl, spies } = mockGL();
    refreshLabelAtlas(gl, plan(), new Uint8Array(4), 0);
    expect(spies.texSubImage2D).not.toHaveBeenCalled();
  });
});
