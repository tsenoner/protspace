// ============================================================================
// WebGL Shader Utilities
// ============================================================================

type GL = WebGL2RenderingContext | WebGLRenderingContext;

/**
 * Creates a shader and starts compiling it. The result is not read here: with
 * KHR_parallel_shader_compile enabled the driver compiles in the background, and asking for
 * COMPILE_STATUS blocks until it is done.
 */
function startShader(gl: GL, type: number, source: string): WebGLShader | null {
  const shader = gl.createShader(type);
  if (!shader) return null;

  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  return shader;
}

/**
 * A program whose shaders have been handed to the driver but whose compile and link results
 * have not been read yet.
 */
export interface PendingProgram {
  program: WebGLProgram;
  vertexShader: WebGLShader;
  fragmentShader: WebGLShader;
}

/**
 * Starts compiling and linking a program without waiting for the result, so several programs
 * (and the caller's own work) overlap. Pair with {@link finishProgram}. Enable
 * `KHR_parallel_shader_compile` on the context first for the overlap to be real.
 */
export function beginProgramFromSources(
  gl: GL,
  vertexSource: string,
  fragmentSource: string,
  attribLocations?: Record<string, number>,
): PendingProgram | null {
  const vertexShader = startShader(gl, gl.VERTEX_SHADER, vertexSource);
  const fragmentShader = startShader(gl, gl.FRAGMENT_SHADER, fragmentSource);
  const program = vertexShader && fragmentShader ? gl.createProgram() : null;

  if (!vertexShader || !fragmentShader || !program) {
    if (vertexShader) gl.deleteShader(vertexShader);
    if (fragmentShader) gl.deleteShader(fragmentShader);
    return null;
  }

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

  return { program, vertexShader, fragmentShader };
}

/**
 * Reads the result of {@link beginProgramFromSources}, waiting for the driver if it is still
 * working. Returns null, with the same console errors as a synchronous build, when either
 * shader failed to compile or the link failed.
 */
export function finishProgram(gl: GL, pending: PendingProgram): WebGLProgram | null {
  const { program, vertexShader, fragmentShader } = pending;

  // A link is only worth reporting on shaders that compiled; both compile errors are reported.
  let compiled = true;
  for (const shader of [vertexShader, fragmentShader]) {
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      console.error('Shader compile error:', gl.getShaderInfoLog(shader));
      compiled = false;
    }
  }
  if (!compiled) {
    discardProgram(gl, pending);
    return null;
  }

  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    console.error('Program link error:', gl.getProgramInfoLog(program));
    discardProgram(gl, pending);
    return null;
  }

  // Clean up shaders after linking
  gl.deleteShader(vertexShader);
  gl.deleteShader(fragmentShader);

  return program;
}

/** Releases a pending program that will not be used. */
export function discardProgram(gl: GL, pending: PendingProgram): void {
  gl.deleteShader(pending.vertexShader);
  gl.deleteShader(pending.fragmentShader);
  gl.deleteProgram(pending.program);
}

/**
 * Creates a WebGL program from shader source strings.
 */
export function createProgramFromSources(
  gl: GL,
  vertexSource: string,
  fragmentSource: string,
  attribLocations?: Record<string, number>,
): WebGLProgram | null {
  const pending = beginProgramFromSources(gl, vertexSource, fragmentSource, attribLocations);
  return pending ? finishProgram(gl, pending) : null;
}
