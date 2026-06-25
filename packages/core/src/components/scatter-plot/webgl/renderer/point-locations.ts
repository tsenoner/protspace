import type { PointAttribLocations, PointUniformLocations } from '../types';

/**
 * Resolve the attribute and uniform locations for the point shader program.
 *
 * Pure helper: it queries the supplied GL context/program by the exact shader
 * variable names and returns a structured descriptor. No WebGLRenderer import.
 */
export function resolvePointLocations(
  gl: WebGL2RenderingContext,
  program: WebGLProgram,
): { attribs: PointAttribLocations; uniforms: PointUniformLocations } {
  return {
    attribs: {
      dataPosition: gl.getAttribLocation(program, 'a_dataPosition'),
      size: gl.getAttribLocation(program, 'a_pointSize'),
      color: gl.getAttribLocation(program, 'a_color'),
      depth: gl.getAttribLocation(program, 'a_depth'),
      labelCount: gl.getAttribLocation(program, 'a_labelCount'),
      shape: gl.getAttribLocation(program, 'a_shape'),
    },
    uniforms: {
      resolution: gl.getUniformLocation(program, 'u_resolution'),
      transform: gl.getUniformLocation(program, 'u_transform'),
      dpr: gl.getUniformLocation(program, 'u_dpr'),
      gamma: gl.getUniformLocation(program, 'u_gamma'),
      labelColors: gl.getUniformLocation(program, 'u_labelColors'),
      labelTextureSize: gl.getUniformLocation(program, 'u_labelTextureSize'),
      maxLabels: gl.getUniformLocation(program, 'u_maxLabels'),
    },
  };
}
