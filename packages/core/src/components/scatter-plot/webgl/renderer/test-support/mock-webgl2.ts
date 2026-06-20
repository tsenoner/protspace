// Minimal WebGL2 stub: enough surface for WebGLRenderer.ensureGL()/render() to run in jsdom.
// Toggles let tests force the failure exits the audit cites (F-03) and gamma fallbacks (F-09).
import { vi } from 'vitest';

export interface MockGLOptions {
  /** getContext('webgl2') returns null (F-03 no-context exit). */
  contextUnavailable?: boolean;
  /** linkProgram succeeds but getProgramParameter(LINK_STATUS) reports false → createProgram null (F-03). */
  failProgramLink?: boolean;
  /** getExtension(EXT_color_buffer_float|EXT_float_blend) returns null → gamma unavailable (F-09). */
  missingFloatExtensions?: boolean;
  /** checkFramebufferStatus returns a non-COMPLETE value (F-09 framebuffer-incomplete fallback). */
  framebufferIncomplete?: boolean;
}

export function createMockCanvas(opts: MockGLOptions = {}): {
  canvas: HTMLCanvasElement;
  gl: WebGL2RenderingContext | null;
  setContextLost: (v: boolean) => void;
  /** Restores the getContext spy. Callers using afterEach(vi.restoreAllMocks)
   *  get this for free; this handle lets callers restore explicitly instead of
   *  relying on suite-level discipline. */
  restore: () => void;
} {
  const canvas = document.createElement('canvas');
  canvas.width = 800;
  canvas.height = 600;
  let lost = false;

  const gl = opts.contextUnavailable
    ? null
    : (makeGL(opts, () => lost) as unknown as WebGL2RenderingContext);

  // jsdom canvas.getContext returns null; intercept to return our stub.
  const getContextSpy = vi
    .spyOn(canvas, 'getContext')
    .mockImplementation(((id: string) =>
      id === 'webgl2' ? gl : null) as typeof canvas.getContext);

  return {
    canvas,
    gl,
    setContextLost: (v: boolean) => {
      lost = v;
    },
    restore: () => getContextSpy.mockRestore(),
  };
}

function makeGL(opts: MockGLOptions, isLost: () => boolean): Record<string, unknown> {
  const C = {
    LINK_STATUS: 0x8b82,
    COMPILE_STATUS: 0x8b81,
    FRAGMENT_SHADER: 0x8b30,
    VERTEX_SHADER: 0x8b31,
    FRAMEBUFFER: 0x8d40,
    FRAMEBUFFER_COMPLETE: 0x8cd5,
    COLOR_BUFFER_BIT: 0x4000,
    DEPTH_BUFFER_BIT: 0x100,
    BLEND: 0x0be2,
    DEPTH_TEST: 0x0b71,
    POINTS: 0x0000,
    ARRAY_BUFFER: 0x8892,
    TEXTURE_2D: 0x0de1,
    RENDERBUFFER: 0x8d41,
    ONE: 1,
    ONE_MINUS_SRC_ALPHA: 0x0303,
  };
  const noop = () => {};
  const obj: Record<string, unknown> = {
    ...C,
    isContextLost: () => isLost(),
    getExtension: (name: string) =>
      opts.missingFloatExtensions &&
      (name === 'EXT_color_buffer_float' || name === 'EXT_float_blend')
        ? null
        : {},
    createShader: () => ({}),
    shaderSource: noop,
    compileShader: noop,
    getShaderParameter: () => true,
    getShaderInfoLog: () => '',
    createProgram: () => ({}),
    attachShader: noop,
    linkProgram: noop,
    getProgramParameter: (_p: unknown, pname: number) =>
      pname === C.LINK_STATUS ? !opts.failProgramLink : true,
    getProgramInfoLog: () => '',
    useProgram: noop,
    deleteProgram: noop,
    deleteShader: noop,
    getAttribLocation: () => 0,
    getUniformLocation: () => ({}),
    createBuffer: () => ({}),
    bindBuffer: noop,
    bufferData: noop,
    deleteBuffer: noop,
    createVertexArray: () => ({}),
    bindVertexArray: noop,
    deleteVertexArray: noop,
    enableVertexAttribArray: noop,
    vertexAttribPointer: noop,
    createTexture: () => ({}),
    bindTexture: noop,
    texImage2D: noop,
    texParameteri: noop,
    texSubImage2D: noop,
    deleteTexture: noop,
    activeTexture: noop,
    createFramebuffer: () => ({}),
    bindFramebuffer: noop,
    framebufferTexture2D: noop,
    framebufferRenderbuffer: noop,
    deleteFramebuffer: noop,
    createRenderbuffer: () => ({}),
    bindRenderbuffer: noop,
    renderbufferStorage: noop,
    deleteRenderbuffer: noop,
    checkFramebufferStatus: () => (opts.framebufferIncomplete ? 0 : C.FRAMEBUFFER_COMPLETE),
    isProgram: () => true,
    isVertexArray: () => true,
    isBuffer: () => true,
    isTexture: () => true,
    viewport: noop,
    clearColor: noop,
    clear: noop,
    enable: noop,
    disable: noop,
    blendFunc: noop,
    depthMask: noop,
    drawArrays: noop,
    uniform1f: noop,
    uniform1i: noop,
    uniform2f: noop,
    uniform3f: noop,
    uniformMatrix3fv: noop,
    uniform4fv: noop,
    pixelStorei: noop,
    disableVertexAttribArray: noop,
  };
  return obj;
}
