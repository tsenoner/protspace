import { describe, it, expect, vi } from 'vitest';
import { DENSITY_CONTOUR_FLOOR } from './density-shaders';
import {
  buildSlotPalette,
  computeDensityGrid,
  createColorTarget,
  resizeDensityTargets,
  accumulateAndBlurDensity,
  compositeDensity,
  type ColorTarget,
  type DensityFrame,
  type DensityResources,
  type SlotPalette,
} from './density-pass';

function mockGL(opts: { framebufferComplete?: boolean } = {}) {
  const calls: string[] = [];
  const uploads3fv: unknown[] = [];
  let boundFramebuffer: { k?: string } | null = null;
  const gl = {
    FRAMEBUFFER: 0x8d40,
    FRAMEBUFFER_COMPLETE: 0x8cd5,
    COLOR_ATTACHMENT0: 0x8ce0,
    COLOR_BUFFER_BIT: 0x4000,
    TEXTURE_2D: 0x0de1,
    TEXTURE0: 0x84c0,
    TEXTURE1: 0x84c1,
    RGBA: 0x1908,
    RGBA32F: 0x8814,
    RGBA16F: 0x881a,
    FLOAT: 0x1406,
    HALF_FLOAT: 0x140b,
    NEAREST: 0x2600,
    LINEAR: 0x2601,
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
    FRAMEBUFFER_BINDING: 0x8ca6,
    getParameter: (pname: number) => (pname === 0x8ca6 ? boundFramebuffer : 0),
    bindFramebuffer: (_t: number, fb: { k?: string } | null) => {
      boundFramebuffer = fb;
      calls.push(`bindFB:${fb ? (fb.k ?? 'fb') : 'null'}`);
    },
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
    uniform4f: (loc: { n: string }, a: number, b: number, c: number, d: number) =>
      calls.push(`u4f:${loc?.n}:${a},${b},${c},${d}`),
    uniform3fv: (loc: { n: string }, v: unknown) => {
      calls.push(`u3fv:${loc?.n}`);
      uploads3fv.push(v);
    },
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
  return {
    gl,
    calls,
    uploads3fv,
    spies: gl as unknown as Record<string, ReturnType<typeof vi.fn>>,
  };
}

function target(k: string, width: number, height: number): ColorTarget {
  return {
    framebuffer: { k: `${k}Fb` } as unknown as WebGLFramebuffer,
    texture: { k: `${k}Tex` } as unknown as WebGLTexture,
    width,
    height,
  };
}

const named = (n: string) => ({ n }) as unknown as WebGLUniformLocation;

function resources(fieldCount = 4): DensityResources {
  return {
    contourBlurProgram: { k: 'contourBlur' } as unknown as WebGLProgram,
    categoryAccumProgram: { k: 'categoryAccum' } as unknown as WebGLProgram,
    categoryCompositeProgram: { k: 'categoryComposite' } as unknown as WebGLProgram,
    contourBlurLoc: { source: named('source'), direction: named('direction') },
    categoryAccumLoc: {
      resolution: named('resolution'),
      transform: named('transform'),
      dpr: named('dpr'),
      morph: named('morph'),
      slotKeys: named('slotKeys'),
      slotCount: named('slotCount'),
      tailSlot: named('tailSlot'),
      group: named('group'),
    },
    categoryCompositeLoc: {
      fields: [0, 1, 2, 3].map((g) => named(`field${g}`)),
      slotColors: named('slotColors'),
      slotCount: named('slotCount'),
      alpha: named('alpha'),
      contourFloor: named('contourFloor'),
      lineRamp: named('lineRamp'),
    },
    quadVao: { k: 'quadVao' } as unknown as WebGLVertexArrayObject,
    accum: target('accum', 400, 300),
    ping: target('ping', 400, 300),
    fields: Array.from({ length: fieldCount }, (_, g) => target(`field${g}`, 400, 300)),
    fieldsKey: null,
  };
}

const camera = {
  width: 800,
  height: 600,
  transform: { x: 1, y: 2, k: 3 },
  dpr: 2,
};

function paletteOf(count: number): SlotPalette {
  const colors = new Float32Array(count * 4);
  for (let i = 0; i < count; i++) colors.set([(i + 1) / 255, 0, 0, 1], i * 4);
  return buildSlotPalette(colors, count, 2.2);
}

function contourFrame(palette: SlotPalette, alpha = 1): DensityFrame {
  return { res: resources(), camera, alpha, palette };
}

function stagedReds(runs: Array<[number, number]>): Float32Array {
  const out: number[] = [];
  for (const [red, n] of runs) for (let j = 0; j < n; j++) out.push(red / 255, 0, 0, 1);
  return new Float32Array(out);
}

const redBytes = (p: SlotPalette) =>
  Array.from({ length: p.count }, (_, s) => Math.round(p.keys[s * 3] * 255));

describe('computeDensityGrid', () => {
  it('puts 512 cells on the long side, never more than the canvas has pixels', () => {
    expect(computeDensityGrid(1920, 1080)).toEqual({ width: 512, height: 288 });
    expect(computeDensityGrid(4096, 2160)).toEqual({ width: 512, height: 270 });
    expect(computeDensityGrid(300, 200)).toEqual({ width: 300, height: 200 });
    expect(computeDensityGrid(100000, 1)).toEqual({ width: 512, height: 1 });
    expect(computeDensityGrid(1, 1)).toEqual({ width: 1, height: 1 });
  });

  it('gives the same plot the same grid at every pixel density', () => {
    for (const dpr of [1, 1.25, 1.5, 2, 3]) {
      const grid = computeDensityGrid(Math.floor(1100 * dpr), Math.floor(712 * dpr));
      expect(grid).toEqual({ width: 512, height: 331 });
    }
  });
});

describe('buildSlotPalette', () => {
  it('gives each visible staged colour a slot, in order of first appearance', () => {
    const staged = new Float32Array([1, 0, 0, 1, 1, 0, 0, 1, 0, 0, 1, 1, 0, 1, 0, 0, 0, 0, 1, 0.2]);
    const p = buildSlotPalette(staged, 5, 2.2);
    expect(p.count).toBe(2);
    expect(p.tailSlot).toBe(-1);
    expect(Array.from(p.keys.slice(0, 6))).toEqual([1, 0, 0, 0, 0, 1]);
    expect(p.keys.slice(6).every((v) => v === 0)).toBe(true);
    expect(Array.from(p.colors.slice(0, 6))).toEqual([
      1, 0.15000000596046448, 0.15000000596046448, 0.15000000596046448, 0.15000000596046448, 1,
    ]);
  });

  it('orders marked points after every other point', () => {
    const staged = stagedReds([
      [1, 2],
      [2, 1],
      [3, 2],
    ]);
    const marked = Uint8Array.of(1, 0, 1, 1, 0);
    expect(redBytes(buildSlotPalette(staged, 5, 2.2, marked))).toEqual([1, 3, 2]);
    expect(redBytes(buildSlotPalette(staged, 5, 2.2))).toEqual([1, 2, 3]);
  });

  it('has no slot when nothing is visible', () => {
    expect(buildSlotPalette(new Float32Array([1, 0, 0, 0, 0, 1, 0, 0]), 2, 2.2).count).toBe(0);
    expect(buildSlotPalette(new Float32Array([1, 0, 0, 1]), 0, 2.2).count).toBe(0);
  });

  it('pools the least populous colours past the cap into a grey slot 0', () => {
    const runs = Array.from({ length: 17 }, (_, i) => [i + 1, 17 - i] as [number, number]);
    const p = buildSlotPalette(stagedReds(runs), 153, 2.2);
    expect(p.count).toBe(16);
    expect(p.tailSlot).toBe(0);
    expect(Array.from(p.keys.slice(0, 3))).toEqual([
      0.5333333611488342, 0.5333333611488342, 0.5333333611488342,
    ]);
    expect(redBytes(p)).toEqual([136, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]);
  });

  it('merges an existing grey Other into the tail slot', () => {
    const colors = stagedReds(
      Array.from({ length: 16 }, (_, i) => [i + 1, 17 - i] as [number, number]),
    );
    const grey = new Float32Array(50 * 4);
    for (let i = 0; i < 50; i++) grey.set([136 / 255, 136 / 255, 136 / 255, 1], i * 4);
    const staged = new Float32Array([...colors, ...grey]);
    const p = buildSlotPalette(staged, staged.length / 4, 2.2);
    expect(p.count).toBe(16);
    expect(p.tailSlot).toBe(0);
    expect(redBytes(p)).toEqual([136, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]);
  });

  it('needs no tail at exactly the cap, grey included', () => {
    const colors = stagedReds(Array.from({ length: 15 }, (_, i) => [i + 1, 1] as [number, number]));
    const staged = new Float32Array([...colors, 136 / 255, 136 / 255, 136 / 255, 1]);
    const p = buildSlotPalette(staged, 16, 2.2);
    expect(p.count).toBe(16);
    expect(p.tailSlot).toBe(-1);
    expect(redBytes(p)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 136]);
  });

  it('breaks a population tie for the last own slot by first appearance', () => {
    const runs: Array<[number, number]> = Array.from({ length: 14 }, (_, i) => [i + 1, 10]);
    runs.push([20, 2], [21, 2], [22, 1]);
    const p = buildSlotPalette(stagedReds(runs), 145, 2.2);
    expect(redBytes(p)).toEqual([136, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 20]);
  });

  it('keys N/A grey exactly as staged and linearises its ring colour', () => {
    const v = 221 / 255;
    const p = buildSlotPalette(new Float32Array([v, v, v, 1]), 1, 2.2);
    expect(p.keys[0]).toBe(0.8666666746139526);
    expect(p.colors[0]).toBe(0.7704310417175293);
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

  it('restores the framebuffer that was bound before it', () => {
    const { gl, calls } = mockGL();
    const outer = { k: 'outer' } as WebGLFramebuffer;
    gl.bindFramebuffer(gl.FRAMEBUFFER, outer);
    createColorTarget(gl, 64, 32, gl.RGBA32F, gl.FLOAT, gl.NEAREST);
    expect(calls.filter((c) => c.startsWith('bindFB:')).at(-1)).toBe('bindFB:outer');
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
  const allocations = (calls: string[]) => calls.filter((c) => c.startsWith('texImage2D'));
  const empty = () => ({ ...resources(), accum: null, ping: null, fields: [] }) as DensityResources;

  it('allocates the accum, ping and four fields once, then reuses them at the same size', () => {
    const { gl, calls } = mockGL();
    const res = empty();

    expect(resizeDensityTargets(gl, res, 800, 600)).toBe(true);
    expect(allocations(calls)).toEqual([
      'texImage2D:34836:512x384',
      ...Array(5).fill('texImage2D:34842:512x384'),
    ]);
    expect(res.fields).toHaveLength(4);

    expect(resizeDensityTargets(gl, res, 800, 600)).toBe(true);
    expect(allocations(calls)).toHaveLength(6);

    expect(resizeDensityTargets(gl, res, 1024, 600)).toBe(true);
    expect(allocations(calls)).toHaveLength(12);
  });

  it('leaves no targets behind when one is incomplete', () => {
    const { gl, spies } = mockGL({ framebufferComplete: false });
    const res = empty();
    expect(resizeDensityTargets(gl, res, 800, 600)).toBe(false);
    expect(res.accum).toBeNull();
    expect(res.fields).toEqual([]);
    expect(spies.deleteFramebuffer).toHaveBeenCalledTimes(6);
  });
});

describe('accumulateAndBlurDensity', () => {
  const pointVao = { k: 'pointVao' } as unknown as WebGLVertexArrayObject;

  it('accumulates additively into the grid, then blurs twice', () => {
    const { gl, calls } = mockGL();
    accumulateAndBlurDensity(gl, contourFrame(paletteOf(1)), pointVao, 1000);

    const firstPointDraw = calls.indexOf('drawArrays:0,0,1000');
    expect(firstPointDraw).toBeGreaterThan(-1);
    expect(calls.indexOf('blendFunc:1,1')).toBeGreaterThan(-1);
    expect(calls.indexOf('blendFunc:1,1')).toBeLessThan(firstPointDraw);

    expect(calls).toContain('viewport:0,0,400,300');
    expect(calls).toContain('u2f:resolution:800,600');
    expect(calls.indexOf('u1f:morph:0')).toBeGreaterThan(-1);
    expect(calls.indexOf('u1f:morph:0')).toBeLessThan(firstPointDraw);

    expect(calls.filter((c) => c === 'drawArrays:4,0,6')).toHaveLength(2);
    expect(calls).toContain('u2f:direction:0.0025,0');
    expect(calls).toContain('u2f:direction:0,0.0033333333333333335');
    expect(calls).toContain('bindFB:field0Fb');

    expect(calls).not.toContain('getError');
    expect(calls).not.toContain('checkFramebufferStatus');
  });

  it('accumulates at the morph weight the camera carries', () => {
    const { gl, calls } = mockGL();
    const frame = contourFrame(paletteOf(1));
    accumulateAndBlurDensity(gl, { ...frame, camera: { ...camera, morph: 0.5 } }, pointVao, 1000);
    expect(calls.filter((c) => c.startsWith('u1f:morph'))).toEqual(['u1f:morph:0.5']);
  });

  it('runs one accumulate and blur per group of four slots', () => {
    const five = mockGL();
    accumulateAndBlurDensity(five.gl, contourFrame(paletteOf(5)), pointVao, 1000);
    expect(five.calls.filter((c) => c === 'drawArrays:0,0,1000')).toHaveLength(2);
    expect(five.calls.filter((c) => c.startsWith('u1i:group'))).toEqual([
      'u1i:group:0',
      'u1i:group:1',
    ]);
    expect(five.calls.filter((c) => c === 'drawArrays:4,0,6')).toHaveLength(4);
    expect(five.calls.filter((c) => /^bindFB:field\dFb$/.test(c))).toEqual([
      'bindFB:field0Fb',
      'bindFB:field1Fb',
    ]);

    const one = mockGL();
    accumulateAndBlurDensity(one.gl, contourFrame(paletteOf(1)), pointVao, 1000);
    expect(one.calls.filter((c) => c === 'drawArrays:0,0,1000')).toHaveLength(1);
    expect(one.calls.filter((c) => c === 'drawArrays:4,0,6')).toHaveLength(2);
  });
});

describe('compositeDensity', () => {
  it('draws every slot from the four fields, off the label atlas unit', () => {
    const { gl, calls, uploads3fv } = mockGL();
    const palette = paletteOf(5);
    compositeDensity(gl, contourFrame(palette, 0.5));

    expect(calls.filter((c) => c === 'drawArrays:4,0,6')).toHaveLength(1);
    expect(calls).toContain('u1i:slotCount:5');
    expect(calls).toContain('u1f:alpha:0.5');
    expect(calls.indexOf('blendFunc:1,771')).toBeGreaterThan(-1);
    expect(calls.indexOf('blendFunc:1,771')).toBeLessThan(calls.indexOf('drawArrays:4,0,6'));
    expect(uploads3fv).toEqual([palette.colors]);
    expect(uploads3fv[0]).toBe(palette.colors);
    expect(calls).toContain(`u1f:contourFloor:${DENSITY_CONTOUR_FLOOR}`);
    expect(calls).toContain('u1f:lineRamp:2');
    const draw = calls.indexOf('drawArrays:4,0,6');
    expect(
      calls.slice(0, draw).filter((c) => c.startsWith('activeTexture') || c.startsWith('bindT')),
    ).toEqual([
      'activeTexture:33984',
      'bindTexture:field0Tex',
      'activeTexture:33986',
      'bindTexture:field1Tex',
      'activeTexture:33987',
      'bindTexture:field2Tex',
      'activeTexture:33988',
      'bindTexture:field3Tex',
    ]);
    expect(calls).not.toContain('activeTexture:33985');
    expect(calls.filter((c) => c.startsWith('activeTexture')).at(-1)).toBe('activeTexture:33984');
  });

  it('sizes the line ramp in CSS px, so lines keep their thickness at every dpr', () => {
    for (const dpr of [1, 3]) {
      const { gl, calls } = mockGL();
      compositeDensity(gl, { ...contourFrame(paletteOf(1)), camera: { ...camera, dpr } });
      expect(calls).toContain(`u1f:lineRamp:${dpr}`);
    }
  });
});
