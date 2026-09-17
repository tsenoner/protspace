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
  /** Value reported for getParameter(MAX_TEXTURE_SIZE). Defaults to 8192 — the tier ~97% of
   *  WebGL2 devices report, so existing suites keep the geometry they always had. */
  maxTextureSize?: number;
  /** Texture size the simulated DRIVER actually accepts, independent of the limit
   *  getParameter advertises. A real driver can refuse what it said would fit — a lying
   *  limit, or plain OOM — and it does so by raising into the sticky error flag rather
   *  than throwing. Exceeding this raises {@link MockGLOptions.driverError} from
   *  texImage2D, which is the failure the atlas work exists to survive.
   *
   *  Deliberately expressed as a driver capability rather than as "the Nth getError()
   *  call returns X": the renderer drains the flag before an allocation it is about to
   *  check, so any fixture keyed on call position describes the mock, not the driver. */
  driverTextureLimit?: number;
  /** Byte size above which the simulated driver refuses a bufferData allocation. */
  driverBufferByteLimit?: number;
  /** Error code the two driver limits raise. Defaults to INVALID_VALUE. */
  driverError?: number;
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
    MAX_TEXTURE_SIZE: 0x0d33,
    NO_ERROR: 0,
    INVALID_VALUE: 0x0501,
    INVALID_OPERATION: 0x0502,
    OUT_OF_MEMORY: 0x0505,
  };
  const noop = () => {};
  const maxTextureSize = opts.maxTextureSize ?? 8192;

  // The GL error flag: sticky, holds the FIRST error raised, cleared by getError().
  // Modelling it faithfully is the point — code that checks it without draining first
  // reads someone else's failure.
  let errorFlag: number = C.NO_ERROR;
  const driverError = opts.driverError ?? C.INVALID_VALUE;
  const raise = () => {
    if (errorFlag === C.NO_ERROR) errorFlag = driverError;
  };
  const obj: Record<string, unknown> = {
    ...C,
    isContextLost: () => isLost(),
    // Recording: "how often do we ask the driver for its limits" is itself part
    // of the contract — the probe belongs at context creation, not per frame.
    getParameter: vi.fn((pname: number) => (pname === C.MAX_TEXTURE_SIZE ? maxTextureSize : 0)),
    // Returns and clears, like the real API.
    getError: () => {
      const raised = errorFlag;
      errorFlag = C.NO_ERROR;
      return raised;
    },
    getExtension: (name: string) => {
      if (
        opts.missingFloatExtensions &&
        (name === 'EXT_color_buffer_float' || name === 'EXT_float_blend')
      ) {
        return null;
      }
      // Shaped, not `{}`: the export path's `finally` calls `loseContext()` on it,
      // and a bare object makes that throw a TypeError that replaces whatever the
      // test was actually asserting about.
      if (name === 'WEBGL_lose_context') return { loseContext: noop, restoreContext: noop };
      return {};
    },
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
    // Recording, and bufferSubData was absent entirely — nothing ever exercised
    // the already-initialised upload path, which is where a capacity change is
    // distinguished from a refresh.
    bufferData: vi.fn((_target: number, data: ArrayBufferView | number) => {
      const bytes = typeof data === 'number' ? data : (data?.byteLength ?? 0);
      if (opts.driverBufferByteLimit !== undefined && bytes > opts.driverBufferByteLimit) raise();
    }),
    bufferSubData: vi.fn(),
    deleteBuffer: noop,
    createVertexArray: () => ({}),
    bindVertexArray: noop,
    deleteVertexArray: noop,
    enableVertexAttribArray: noop,
    vertexAttribPointer: noop,
    createTexture: () => ({}),
    bindTexture: noop,
    // Recording, not noop: the atlas contract is "what geometry did we hand the driver",
    // which is only observable through the arguments of these two calls.
    texImage2D: vi.fn(
      (_target: number, _level: number, _internal: number, width: number, height: number) => {
        const limit = opts.driverTextureLimit;
        if (limit !== undefined && (width > limit || height > limit)) raise();
      },
    ),
    texParameteri: noop,
    texSubImage2D: vi.fn(),
    // Left a plain noop: webgl-renderer.lifecycle.test.ts wraps it with vi.spyOn.
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
    isFramebuffer: () => true,
    isRenderbuffer: () => true,
    viewport: noop,
    clearColor: noop,
    clear: noop,
    enable: noop,
    disable: noop,
    blendFunc: noop,
    depthMask: noop,
    drawArrays: noop,
    uniform1f: noop,
    // Recording: the atlas-capacity and stride uniforms are how the shader learns
    // what was actually allocated, so tests assert on their values.
    uniform1i: vi.fn(),
    uniform2f: noop,
    uniform3f: noop,
    uniformMatrix3fv: noop,
    uniform4fv: noop,
    pixelStorei: noop,
    disableVertexAttribArray: noop,
  };
  return obj;
}
