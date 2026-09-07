import { describe, it, expect, vi } from 'vitest';
import {
  computeDensityGrid,
  createColorTarget,
  resizeDensityTargets,
  accumulateAndBlurDensity,
  compositeDensity,
  type ColorTarget,
  type DensityResources,
} from './density-pass';

/** Recording mock in the style of render-target.test.ts. */
function mockGL(opts: { framebufferComplete?: boolean } = {}) {
  const calls: string[] = [];
  const gl = {
    FRAMEBUFFER: 0x8d40,
    FRAMEBUFFER_COMPLETE: 0x8cd5,
    COLOR_ATTACHMENT0: 0x8ce0,
    COLOR_BUFFER_BIT: 0x4000,
    TEXTURE_2D: 0x0de1,
    TEXTURE0: 0x84c0,
    RGBA: 0x1908,
    RGBA32F: 0x8814,
    FLOAT: 0x1406,
    NEAREST: 0x2600,
    TEXTURE_MIN_FILTER: 0x2801,
    TEXTURE_MAG_FILTER: 0x2800,
    TEXTURE_WRAP_S: 0x2802,
    TEXTURE_WRAP_T: 0x2803,
    CLAMP_TO_EDGE: 0x812f,
    BLEND: 0x0be2,
    DEPTH_TEST: 0x0b71,
    FUNC_ADD: 0x8006,
    ONE: 1,
    ONE_MINUS_SRC_ALPHA: 771,
    POINTS: 0,
    TRIANGLES: 4,
    createFramebuffer: vi.fn(() => ({ k: 'fb' })),
    createTexture: vi.fn(() => ({ k: 'tex' })),
    createRenderbuffer: vi.fn(() => ({ k: 'rb' })),
    deleteFramebuffer: vi.fn(),
    deleteTexture: vi.fn(),
    deleteRenderbuffer: vi.fn(),
    bindFramebuffer: (_t: number, fb: { k?: string } | null) =>
      calls.push(`bindFB:${fb ? (fb.k ?? 'fb') : 'null'}`),
    framebufferTexture2D: () => calls.push('fbTex2D'),
    checkFramebufferStatus: () => {
      calls.push('checkFramebufferStatus');
      return opts.framebufferComplete === false ? 0 : 0x8cd5;
    },
    getError: () => {
      calls.push('getError');
      return 0;
    },
    bindTexture: (_t: number, tex: { k?: string } | null) =>
      calls.push(`bindTexture:${tex ? (tex.k ?? 'tex') : 'null'}`),
    texImage2D: (...a: unknown[]) => calls.push(`texImage2D:${a[2]}:${a[3]}x${a[4]}`),
    texParameteri: () => {},
    activeTexture: (u: number) => calls.push(`activeTexture:${u}`),
    useProgram: (p: { k?: string } | null) => calls.push(`useProgram:${p?.k ?? 'null'}`),
    uniform1i: (loc: { n: string }, v: number) => calls.push(`u1i:${loc?.n}:${v}`),
    uniform1f: (loc: { n: string }, v: number) => calls.push(`u1f:${loc?.n}:${v}`),
    uniform2f: (loc: { n: string }, a: number, b: number) => calls.push(`u2f:${loc?.n}:${a},${b}`),
    uniform3f: (loc: { n: string }, a: number, b: number, c: number) =>
      calls.push(`u3f:${loc?.n}:${a},${b},${c}`),
    viewport: (...a: number[]) => calls.push(`viewport:${a.join(',')}`),
    clearColor: (...a: number[]) => calls.push(`clearColor:${a.join(',')}`),
    clear: (m: number) => calls.push(`clear:${m}`),
    enable: (c: number) => calls.push(`enable:${c}`),
    disable: (c: number) => calls.push(`disable:${c}`),
    blendEquation: (m: number) => calls.push(`blendEquation:${m}`),
    blendFunc: (...a: number[]) => calls.push(`blendFunc:${a.join(',')}`),
    bindVertexArray: (v: { k?: string } | null) =>
      calls.push(`bindVAO:${v ? (v.k ?? 'vao') : 'null'}`),
    drawArrays: (...a: number[]) => calls.push(`drawArrays:${a.join(',')}`),
  } as unknown as WebGL2RenderingContext;
  return { gl, calls, spies: gl as unknown as Record<string, ReturnType<typeof vi.fn>> };
}

function target(k: string, width: number, height: number): ColorTarget {
  return {
    framebuffer: { k: `${k}Fb` } as unknown as WebGLFramebuffer,
    texture: { k: `${k}Tex` } as unknown as WebGLTexture,
    width,
    height,
  };
}

function resources(): DensityResources {
  return {
    accumProgram: { k: 'accum' } as unknown as WebGLProgram,
    blurProgram: { k: 'blur' } as unknown as WebGLProgram,
    compositeProgram: { k: 'composite' } as unknown as WebGLProgram,
    accumLoc: {
      resolution: { n: 'resolution' },
      transform: { n: 'transform' },
      dpr: { n: 'dpr' },
      gamma: { n: 'gamma' },
    },
    blurLoc: { source: { n: 'source' }, direction: { n: 'direction' } },
    compositeLoc: { density: { n: 'density' }, alpha: { n: 'alpha' }, scaler: { n: 'scaler' } },
    quadVao: { k: 'quadVao' } as unknown as WebGLVertexArrayObject,
    accum: target('accum', 400, 300),
    ping: target('ping', 400, 300),
    pong: target('pong', 400, 300),
  } as unknown as DensityResources;
}

const camera = {
  width: 800,
  height: 600,
  transform: { x: 1, y: 2, k: 3 },
  dpr: 2,
  gamma: 2.2,
};

describe('computeDensityGrid', () => {
  it('halves the device canvas, clamps the long side, never goes below 1', () => {
    expect(computeDensityGrid(1920, 1080)).toEqual({ width: 960, height: 540 });
    expect(computeDensityGrid(3200, 2000)).toEqual({ width: 1024, height: 640 });
    expect(computeDensityGrid(1, 1)).toEqual({ width: 1, height: 1 });
  });
});

describe('createColorTarget', () => {
  it('allocates a depth-free colour target', () => {
    const { gl, spies } = mockGL();
    const t = createColorTarget(gl, 64, 32, gl.RGBA32F, gl.FLOAT, gl.NEAREST);
    expect(t).not.toBeNull();
    expect(t!.width).toBe(64);
    expect(spies.createRenderbuffer).not.toHaveBeenCalled();
  });

  it('returns null and frees both handles when the framebuffer is incomplete', () => {
    const { gl, spies } = mockGL({ framebufferComplete: false });
    expect(createColorTarget(gl, 64, 32, gl.RGBA32F, gl.FLOAT, gl.NEAREST)).toBeNull();
    expect(spies.deleteFramebuffer).toHaveBeenCalledTimes(1);
    expect(spies.deleteTexture).toHaveBeenCalledTimes(1);
    expect(spies.deleteRenderbuffer).not.toHaveBeenCalled();
    expect(spies.createRenderbuffer).not.toHaveBeenCalled();
  });
});

describe('resizeDensityTargets', () => {
  it('allocates three targets once, then reuses them at the same canvas size', () => {
    const { gl, calls } = mockGL();
    const res = { ...resources(), accum: null, ping: null, pong: null } as DensityResources;

    expect(resizeDensityTargets(gl, res, 800, 600)).toBe(true);
    expect(calls.filter((c) => c.startsWith('texImage2D'))).toHaveLength(3);
    expect(res.accum!.width).toBe(400);

    expect(resizeDensityTargets(gl, res, 800, 600)).toBe(true);
    expect(calls.filter((c) => c.startsWith('texImage2D'))).toHaveLength(3);

    expect(resizeDensityTargets(gl, res, 1024, 600)).toBe(true);
    expect(calls.filter((c) => c.startsWith('texImage2D'))).toHaveLength(6);
  });

  it('leaves no targets behind when one is incomplete', () => {
    const { gl, spies } = mockGL({ framebufferComplete: false });
    const res = { ...resources(), accum: null, ping: null, pong: null } as DensityResources;
    expect(resizeDensityTargets(gl, res, 800, 600)).toBe(false);
    expect(res.accum).toBeNull();
    expect(spies.deleteFramebuffer).toHaveBeenCalledTimes(3);
  });
});

describe('accumulateAndBlurDensity', () => {
  it('accumulates additively into the grid, then blurs twice', () => {
    const { gl, calls } = mockGL();
    const pointVao = { k: 'pointVao' } as unknown as WebGLVertexArrayObject;
    accumulateAndBlurDensity(gl, resources(), pointVao, 1000, camera);

    // Additive blend is established before any point is drawn.
    const firstPointDraw = calls.indexOf('drawArrays:0,0,1000');
    expect(firstPointDraw).toBeGreaterThan(-1);
    expect(calls.indexOf('blendFunc:1,1')).toBeGreaterThan(-1);
    expect(calls.indexOf('blendFunc:1,1')).toBeLessThan(firstPointDraw);

    // The grid is selected by the viewport alone: u_resolution stays the canvas,
    // or the accumulation shears against the point pass.
    expect(calls).toContain('viewport:0,0,400,300');
    expect(calls).toContain('u2f:resolution:800,600');

    // Two full-screen blur passes, one per axis.
    expect(calls.filter((c) => c === 'drawArrays:4,0,6')).toHaveLength(2);
    expect(calls).toContain('u2f:direction:0.0025,0');
    expect(calls).toContain('u2f:direction:0,0.0033333333333333335');

    // No blocking driver round-trip in a per-frame pass.
    expect(calls).not.toContain('getError');
    expect(calls).not.toContain('checkFramebufferStatus');
  });
});

describe('compositeDensity', () => {
  it('draws one premultiplied-over quad from the blurred target', () => {
    const { gl, calls } = mockGL();
    compositeDensity(gl, resources(), { alpha: 0.5, scaler: 4 });

    const draw = calls.indexOf('drawArrays:4,0,6');
    expect(draw).toBeGreaterThan(-1);
    expect(calls.filter((c) => c === 'drawArrays:4,0,6')).toHaveLength(1);
    expect(calls.indexOf('blendFunc:1,771')).toBeLessThan(draw);
    expect(calls.indexOf('blendFunc:1,771')).toBeGreaterThan(-1);
    expect(calls).toContain('bindTexture:pongTex');
    expect(calls).toContain('u1f:alpha:0.5');
    expect(calls).toContain('u1f:scaler:4');
  });
});
