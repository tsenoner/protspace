/** Two-triangle full-screen quad in clip space (matches the live setupQuad buffer). */
export const QUAD_VERTICES = new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]);

/**
 * Run the gamma-correction full-screen-quad pass: sample `sourceTexture` on
 * TEXTURE0, apply `gamma`, draw the quad from `quadBuffer` (must already hold
 * QUAD_VERTICES). Assumes BLEND is already disabled by the caller.
 *
 * `uniforms` are the program's uniform locations resolved once at init (see
 * WebGLRenderer.gammaCorrectionUniformLocations) — passing them in avoids a
 * blocking `getUniformLocation` round-trip on every (per-frame) gamma pass.
 */
export function drawGammaQuad(
  gl: WebGL2RenderingContext,
  program: WebGLProgram,
  sourceTexture: WebGLTexture,
  gamma: number,
  quadBuffer: WebGLBuffer,
  uniforms: {
    linearTexture: WebGLUniformLocation | null;
    gamma: WebGLUniformLocation | null;
  },
): void {
  gl.useProgram(program);
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, sourceTexture);
  gl.uniform1i(uniforms.linearTexture, 0);
  gl.uniform1f(uniforms.gamma, gamma);

  gl.bindBuffer(gl.ARRAY_BUFFER, quadBuffer);
  const posLoc = gl.getAttribLocation(program, 'a_position');
  gl.enableVertexAttribArray(posLoc);
  gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 0, 0);

  gl.drawArrays(gl.TRIANGLES, 0, 6);

  gl.disableVertexAttribArray(posLoc);
  gl.bindTexture(gl.TEXTURE_2D, null);
}
