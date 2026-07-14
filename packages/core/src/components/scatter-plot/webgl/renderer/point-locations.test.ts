import { describe, it, expect } from 'vitest';
import { resolvePointLocations } from './point-locations';

function mockGL() {
  const program = {} as WebGLProgram;
  const attribNames = [
    'a_dataPosition',
    'a_pointSize',
    'a_color',
    'a_depth',
    'a_labelCount',
    'a_shape',
    'a_predicted',
  ];
  return {
    program,
    gl: {
      getAttribLocation: (_p: WebGLProgram, name: string) => attribNames.indexOf(name),
      getUniformLocation: (_p: WebGLProgram, name: string) =>
        ({ name }) as unknown as WebGLUniformLocation,
    } as unknown as WebGL2RenderingContext,
  };
}

describe('resolvePointLocations', () => {
  it('resolves all point attributes by their shader names', () => {
    const { gl, program } = mockGL();
    const { attribs } = resolvePointLocations(gl, program);
    expect(attribs).toEqual({
      dataPosition: 0,
      size: 1,
      color: 2,
      depth: 3,
      labelCount: 4,
      shape: 5,
      predicted: 6,
    });
  });

  it('resolves all seven uniforms by their shader names', () => {
    const { gl, program } = mockGL();
    const { uniforms } = resolvePointLocations(gl, program);
    expect(Object.keys(uniforms).sort()).toEqual(
      [
        'dpr',
        'gamma',
        'labelColors',
        'labelTextureSize',
        'maxLabels',
        'resolution',
        'transform',
      ].sort(),
    );
    expect((uniforms.resolution as unknown as { name: string }).name).toBe('u_resolution');
    expect((uniforms.maxLabels as unknown as { name: string }).name).toBe('u_maxLabels');
  });
});
