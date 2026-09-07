// ============================================================================
// WebGL Shader Utilities
// ============================================================================

/**
 * Creates and compiles a WebGL shader.
 */
function createShader(
  gl: WebGL2RenderingContext | WebGLRenderingContext,
  type: number,
  source: string,
): WebGLShader | null {
  const shader = gl.createShader(type);
  if (!shader) return null;

  gl.shaderSource(shader, source);
  gl.compileShader(shader);

  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    console.error('Shader compile error:', gl.getShaderInfoLog(shader));
    gl.deleteShader(shader);
    return null;
  }

  return shader;
}

/**
 * Creates and links a WebGL program from vertex and fragment shaders.
 */
function createProgram(
  gl: WebGL2RenderingContext | WebGLRenderingContext,
  vertexShader: WebGLShader,
  fragmentShader: WebGLShader,
  attribLocations?: Record<string, number>,
): WebGLProgram | null {
  const program = gl.createProgram();
  if (!program) return null;

  gl.attachShader(program, vertexShader);
  gl.attachShader(program, fragmentShader);
  // Must precede linkProgram: this is how two programs come to agree on the
  // attribute indices a shared VAO was wired for.
  if (attribLocations) {
    for (const [name, index] of Object.entries(attribLocations)) {
      gl.bindAttribLocation(program, index, name);
    }
  }
  gl.linkProgram(program);

  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    console.error('Program link error:', gl.getProgramInfoLog(program));
    gl.deleteProgram(program);
    return null;
  }

  // Clean up shaders after linking
  gl.deleteShader(vertexShader);
  gl.deleteShader(fragmentShader);

  return program;
}

/**
 * Creates a WebGL program from shader source strings.
 *
 * `attribLocations` (name -> index) is bound before linking, for programs that
 * must share a VAO with another program: the density accumulation pass draws
 * the point VAO, so its attributes have to land on the point program's indices.
 */
export function createProgramFromSources(
  gl: WebGL2RenderingContext | WebGLRenderingContext,
  vertexSource: string,
  fragmentSource: string,
  attribLocations?: Record<string, number>,
): WebGLProgram | null {
  const vs = createShader(gl, gl.VERTEX_SHADER, vertexSource);
  const fs = createShader(gl, gl.FRAGMENT_SHADER, fragmentSource);

  if (!vs || !fs) {
    if (vs) gl.deleteShader(vs);
    if (fs) gl.deleteShader(fs);
    return null;
  }

  return createProgram(gl, vs, fs, attribLocations);
}
