import { describe, it, expect } from 'vitest';
import { QUAD_VERTICES, drawGammaQuad } from './gamma-quad';

describe('QUAD_VERTICES', () => {
  it('is the two-triangle full-screen quad (6 verts, 12 floats)', () => {
    expect(Array.from(QUAD_VERTICES)).toEqual([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]);
  });
});

describe('drawGammaQuad', () => {
  it('binds the source texture + uniforms and draws 6 verts from the quad buffer', () => {
    const calls: string[] = [];
    const program = {} as WebGLProgram;
    const quadBuffer = { name: 'quad' } as unknown as WebGLBuffer;
    const sourceTexture = { name: 'src' } as unknown as WebGLTexture;
    const gl = {
      TEXTURE0: 33984,
      TEXTURE_2D: 4,
      ARRAY_BUFFER: 34962,
      FLOAT: 5126,
      TRIANGLES: 4,
      useProgram: () => calls.push('useProgram'),
      activeTexture: (u: number) => calls.push(`activeTexture:${u}`),
      bindTexture: (_t: number, tex: { name?: string } | null) =>
        calls.push(`bindTexture:${tex?.name ?? 'null'}`),
      getUniformLocation: (_p: WebGLProgram, n: string) => ({ n }),
      uniform1i: (loc: { n: string }, v: number) => calls.push(`u1i:${loc.n}:${v}`),
      uniform1f: (loc: { n: string }, v: number) => calls.push(`u1f:${loc.n}:${v}`),
      bindBuffer: (_t: number, b: { name: string }) => calls.push(`bindBuffer:${b.name}`),
      getAttribLocation: (_p: WebGLProgram, n: string) => (n === 'a_position' ? 7 : -1),
      enableVertexAttribArray: (l: number) => calls.push(`enable:${l}`),
      vertexAttribPointer: (l: number, s: number, t: number, _n: boolean, st: number, o: number) =>
        calls.push(`ptr:${l}:${s}:${t}:${st}:${o}`),
      drawArrays: (m: number, f: number, c: number) => calls.push(`draw:${m}:${f}:${c}`),
      disableVertexAttribArray: (l: number) => calls.push(`disable:${l}`),
    } as unknown as WebGL2RenderingContext;

    drawGammaQuad(gl, program, sourceTexture, 2.2, quadBuffer, {
      linearTexture: { n: 'u_linearTexture' } as unknown as WebGLUniformLocation,
      gamma: { n: 'u_gamma' } as unknown as WebGLUniformLocation,
    });

    expect(calls).toEqual([
      'useProgram',
      'activeTexture:33984',
      'bindTexture:src',
      'u1i:u_linearTexture:0',
      'u1f:u_gamma:2.2',
      'bindBuffer:quad',
      'enable:7',
      'ptr:7:2:5126:0:0',
      'draw:4:0:6',
      'disable:7',
      'bindTexture:null',
    ]);
  });
});
