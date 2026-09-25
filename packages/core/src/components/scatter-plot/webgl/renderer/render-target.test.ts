import { describe, it, expect } from 'vitest';
import {
  bindAndClearTarget,
  setPointBlendState,
  drawPoints,
  bindPointDrawState,
} from './render-target';
import type { PointUniformLocations } from '../types';

function mockGL() {
  const calls: string[] = [];
  const gl = {
    FRAMEBUFFER: 13,
    COLOR_BUFFER_BIT: 0x4000,
    DEPTH_BUFFER_BIT: 0x100,
    BLEND: 1,
    ONE: 1,
    ONE_MINUS_SRC_ALPHA: 771,
    DEPTH_TEST: 2929,
    POINTS: 0,
    TEXTURE0: 0x84c0,
    TEXTURE_2D: 0x0de1,
    useProgram: (p: unknown) => calls.push(`useProgram:${p === null ? 'null' : 'prog'}`),
    bindVertexArray: (v: unknown) => calls.push(`bindVAO:${v === null ? 'null' : 'vao'}`),
    activeTexture: (u: number) => calls.push(`activeTexture:${u}`),
    bindTexture: (_t: number, tex: unknown) =>
      calls.push(`bindTex:${tex === null ? 'null' : 'tex'}`),
    bindFramebuffer: (_t: number, fb: unknown) =>
      calls.push(`bindFB:${fb === null ? 'null' : 'fb'}`),
    viewport: (...a: number[]) => calls.push(`viewport:${a.join(',')}`),
    clearColor: (...a: number[]) => calls.push(`clearColor:${a.join(',')}`),
    clear: (m: number) => calls.push(`clear:${m}`),
    enable: (c: number) => calls.push(`enable:${c}`),
    disable: (c: number) => calls.push(`disable:${c}`),
    blendFunc: (...a: number[]) => calls.push(`blendFunc:${a.join(',')}`),
    depthMask: (b: boolean) => calls.push(`depthMask:${b}`),
    drawArrays: (...a: number[]) => calls.push(`drawArrays:${a.join(',')}`),
  } as unknown as WebGL2RenderingContext;
  return { gl, calls };
}

describe('bindAndClearTarget', () => {
  it('binds the given framebuffer, sets viewport, clears transparent color+depth', () => {
    const { gl, calls } = mockGL();
    const fb = {} as WebGLFramebuffer;
    bindAndClearTarget(gl, fb, 400, 300);
    expect(calls).toEqual([
      'bindFB:fb',
      'viewport:0,0,400,300',
      'clearColor:0,0,0,0',
      `clear:${0x4000 | 0x100}`,
    ]);
  });

  it('binds the default framebuffer when passed null', () => {
    const { gl, calls } = mockGL();
    bindAndClearTarget(gl, null, 10, 20);
    expect(calls[0]).toBe('bindFB:null');
  });
});

describe('setPointBlendState', () => {
  it('enables premultiplied-over blend and disables depth test + mask', () => {
    const { gl, calls } = mockGL();
    setPointBlendState(gl);
    expect(calls).toEqual(['enable:1', 'blendFunc:1,771', 'disable:2929', 'depthMask:false']);
  });
});

describe('drawPoints', () => {
  it('two-pass: selection active draws unselected (blend off) then selected (blend on)', () => {
    const { gl, calls } = mockGL();
    drawPoints(gl, 100, true, 30);
    expect(calls).toEqual([
      'disable:1',
      'drawArrays:0,0,30',
      'enable:1',
      'blendFunc:1,771',
      'drawArrays:0,30,70',
    ]);
  });

  it('two-pass: skips the unselected draw when selectedStartIndex is 0', () => {
    const { gl, calls } = mockGL();
    drawPoints(gl, 100, true, 0);
    expect(calls).toEqual(['disable:1', 'enable:1', 'blendFunc:1,771', 'drawArrays:0,0,100']);
  });

  it('single-pass: no selection draws all points with blend on', () => {
    const { gl, calls } = mockGL();
    drawPoints(gl, 100, false, 0);
    expect(calls).toEqual(['enable:1', 'blendFunc:1,771', 'drawArrays:0,0,100']);
  });

  const hook = (calls: string[]) => ({
    run: () => calls.push('hook'),
    program: {} as WebGLProgram,
    vao: {} as WebGLVertexArrayObject,
    labelTexture: {} as WebGLTexture,
  });

  it('two-pass: runs afterBasePass, then re-binds the point state for the selected run', () => {
    const { gl, calls } = mockGL();
    drawPoints(gl, 10, true, 3, hook(calls));
    expect(calls).toEqual([
      'disable:1',
      'drawArrays:0,0,3',
      'hook',
      'useProgram:prog',
      'bindVAO:vao',
      `activeTexture:${0x84c1}`,
      'bindTex:tex',
      'enable:1',
      'blendFunc:1,771',
      'drawArrays:0,3,7',
    ]);
  });

  it('single-pass: runs afterBasePass after the one draw', () => {
    const { gl, calls } = mockGL();
    drawPoints(gl, 10, false, 0, hook(calls));
    expect(calls).toEqual(['enable:1', 'blendFunc:1,771', 'drawArrays:0,0,10', 'hook']);
  });

  it('single-pass: falls back when selectedStartIndex is at/after the point count', () => {
    const { gl, calls } = mockGL();
    drawPoints(gl, 100, true, 100);
    expect(calls).toEqual(['enable:1', 'blendFunc:1,771', 'drawArrays:0,0,100']);
  });
});

describe('bindPointDrawState label-atlas uniforms', () => {
  function uniformMockGL() {
    const pushed: Record<string, unknown> = {};
    const gl = {
      TEXTURE1: 0x84c1,
      TEXTURE_2D: 0x0de1,
      useProgram: () => {},
      activeTexture: () => {},
      bindTexture: () => {},
      bindVertexArray: () => {},
      enable: () => {},
      disable: () => {},
      blendFunc: () => {},
      depthMask: () => {},
      uniform1f: (loc: { n: string }, v: number) => {
        pushed[loc.n] = v;
      },
      uniform1i: (loc: { n: string }, v: number) => {
        pushed[loc.n] = v;
      },
      uniform2f: (loc: { n: string }, a: number, b: number) => {
        pushed[loc.n] = [a, b];
      },
      uniform3f: (loc: { n: string }, a: number, b: number, c: number) => {
        pushed[loc.n] = [a, b, c];
      },
    } as unknown as WebGL2RenderingContext;
    const uniforms = {
      resolution: { n: 'resolution' },
      transform: { n: 'transform' },
      dpr: { n: 'dpr' },
      pointScale: { n: 'pointScale' },
      gamma: { n: 'gamma' },
      knockoutColor: { n: 'knockoutColor' },
      labelColors: { n: 'labelColors' },
      labelTextureSize: { n: 'labelTextureSize' },
      maxLabels: { n: 'maxLabels' },
      labelAtlasCapacity: { n: 'labelAtlasCapacity' },
    } as unknown as PointUniformLocations;
    return { gl, uniforms, pushed };
  }

  const baseParams = {
    width: 800,
    height: 600,
    transform: { x: 0, y: 0, k: 1 },
    dpr: 1,
    pointScale: 1,
    gamma: 2.2,
    knockoutColor: [1, 1, 1] as const,
  };

  it('pushes the planned geometry so the shader indexes the atlas it was given', () => {
    const { gl, uniforms, pushed } = uniformMockGL();
    bindPointDrawState(gl, {} as WebGLProgram, uniforms, null, null, {
      ...baseParams,
      labelAtlas: {
        width: 2048,
        height: 2241,
        stride: 8,
        pointCapacity: 573_696,
        byteLength: 2048 * 2241 * 4,
      },
    });
    expect(pushed.maxLabels).toBe(8);
    expect(pushed.labelTextureSize).toEqual([2048, 2241]);
    expect(pushed.labelAtlasCapacity).toBe(573_696);
  });

  it('pushes zero capacity when no atlas is allocated, disabling the pie branch', () => {
    const { gl, uniforms, pushed } = uniformMockGL();
    bindPointDrawState(gl, {} as WebGLProgram, uniforms, null, null, {
      ...baseParams,
      labelAtlas: null,
    });
    expect(pushed.labelAtlasCapacity).toBe(0);
    // The remaining three describe the 1x1 placeholder that stands in for the atlas.
    expect(pushed.labelTextureSize).toEqual([1, 1]);
  });
});

describe('bindPointDrawState point scale', () => {
  it('pushes the draw target size multiplier as u_pointScale', () => {
    const pushed: Record<string, number> = {};
    const gl = {
      useProgram: () => {},
      activeTexture: () => {},
      bindTexture: () => {},
      bindVertexArray: () => {},
      enable: () => {},
      disable: () => {},
      blendFunc: () => {},
      depthMask: () => {},
      uniform1f: (loc: { n: string }, v: number) => {
        pushed[loc.n] = v;
      },
      uniform1i: () => {},
      uniform2f: () => {},
      uniform3f: () => {},
    } as unknown as WebGL2RenderingContext;
    const uniforms = new Proxy({}, { get: (_t, key) => ({ n: String(key) }) }) as never;
    bindPointDrawState(gl, {} as WebGLProgram, uniforms, null, null, {
      width: 800,
      height: 600,
      transform: { x: 0, y: 0, k: 4 },
      dpr: 2,
      pointScale: 2.5,
      gamma: 2.2,
      knockoutColor: [1, 1, 1],
      labelAtlas: null,
    });
    expect(pushed).toMatchObject({ dpr: 2, pointScale: 2.5 });
  });
});
