import { describe, it, expect } from 'vitest';
import { POINT_ATTRIBUTE_LAYOUT, setupAttributes } from './point-attributes';
import type { PointAttribLocations } from '../types';

describe('POINT_ATTRIBUTE_LAYOUT', () => {
  it('declares the six attributes with the live VAO sizes (2,1,4,1,1,1)', () => {
    expect(POINT_ATTRIBUTE_LAYOUT.map((a) => [a.key, a.size])).toEqual([
      ['dataPosition', 2],
      ['size', 1],
      ['color', 4],
      ['depth', 1],
      ['labelCount', 1],
      ['shape', 1],
    ]);
  });
});

describe('setupAttributes', () => {
  it('binds each buffer then enables + points its attribute with FLOAT, stride 0, offset 0', () => {
    const calls: string[] = [];
    const gl = {
      ARRAY_BUFFER: 34962,
      FLOAT: 5126,
      bindBuffer: (_t: number, b: { name: string }) => calls.push(`bind:${b.name}`),
      enableVertexAttribArray: (loc: number) => calls.push(`enable:${loc}`),
      vertexAttribPointer: (
        loc: number,
        size: number,
        type: number,
        _n: boolean,
        stride: number,
        off: number,
      ) => calls.push(`ptr:${loc}:${size}:${type}:${stride}:${off}`),
    } as unknown as WebGL2RenderingContext;
    const buffers = {
      dataPosition: { name: 'pos' },
      size: { name: 'sz' },
      color: { name: 'col' },
      depth: { name: 'dep' },
      labelCount: { name: 'lc' },
      shape: { name: 'sh' },
    } as unknown as Record<string, WebGLBuffer>;
    const locations: PointAttribLocations = {
      dataPosition: 0,
      size: 1,
      color: 2,
      depth: 3,
      labelCount: 4,
      shape: 5,
    };

    setupAttributes(gl, buffers as never, locations);

    expect(calls).toEqual([
      'bind:pos',
      'enable:0',
      'ptr:0:2:5126:0:0',
      'bind:sz',
      'enable:1',
      'ptr:1:1:5126:0:0',
      'bind:col',
      'enable:2',
      'ptr:2:4:5126:0:0',
      'bind:dep',
      'enable:3',
      'ptr:3:1:5126:0:0',
      'bind:lc',
      'enable:4',
      'ptr:4:1:5126:0:0',
      'bind:sh',
      'enable:5',
      'ptr:5:1:5126:0:0',
    ]);
  });
});
