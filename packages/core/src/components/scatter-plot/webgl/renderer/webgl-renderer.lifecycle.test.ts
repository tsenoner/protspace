// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { makeRenderer, plotDataFrom } from './test-support/renderer-fixture';

// B1 renderer lifecycle: destroy() disposes the GPU resources (F-43), a
// programmatic context loss reaches onContextLost (F-01), and syncGpu's guards.
// The DOM webglcontextlost path and the absent restore listener (F-39) are in
// webgl-renderer.context-loss.test.ts and context-loss-controller.test.ts.
//
// The shared mock-webgl2 harness provides the full gl.* surface the render path
// needs (incl. uniform3f / disableVertexAttribArray), so render()-driven tests
// exercise the real path.

/** Three points along the diagonal of the unit square. */
const pd = plotDataFrom([0, 0.5, 1], [0, 0.5, 1]);

describe('WebGLRenderer lifecycle (B1: F-43 / F-01)', () => {
  let rafQueue: FrameRequestCallback[];
  beforeEach(() => {
    rafQueue = [];
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
      rafQueue.push(cb);
      return rafQueue.length;
    });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  // F-43 — destroy() becomes the single GPU-teardown owner.
  it('F-43: destroy() deletes GPU resources via dispose()', () => {
    const { renderer, gl } = makeRenderer();
    // Force lazy resource creation so there are handles to delete.
    renderer.render(pd); // ensureGL() -> createBuffer/VAO/texture/program

    const del = {
      vao: vi.spyOn(gl, 'deleteVertexArray'),
      buffer: vi.spyOn(gl, 'deleteBuffer'),
      texture: vi.spyOn(gl, 'deleteTexture'),
      program: vi.spyOn(gl, 'deleteProgram'),
    };

    renderer.destroy();

    expect(del.vao).toHaveBeenCalledTimes(1);
    expect(del.buffer.mock.calls.length).toBeGreaterThanOrEqual(7); // 6 data buffers + quad
    expect(del.texture.mock.calls.length).toBeGreaterThanOrEqual(1); // labelColorTexture (+linearFramebuffer.texture when the gamma pipeline is available)
    expect(del.program.mock.calls.length).toBeGreaterThanOrEqual(1); // pointProgram (+gamma if available)
  });

  // F-01 — route programmatic context loss to recovery (sanctioned visible change).
  it('F-01: programmatic loss (gl.isContextLost) routes to onContextLost once', () => {
    const onContextLost = vi.fn();
    const { renderer: r, gl } = makeRenderer({}, undefined, { onContextLost });
    r.render(pd); // acquire context
    // Simulate a driver reset with NO webglcontextlost DOM event:
    vi.spyOn(gl, 'isContextLost').mockReturnValue(true);
    r.render(pd); // render -> ensureGL/isContextLost -> markContextLost
    expect(onContextLost).toHaveBeenCalledTimes(1);
    r.destroy();
  });

  it('syncGpu reads one pixel after a render and is a no-op before any context', () => {
    const { renderer: r, gl } = makeRenderer();
    const readPixels = gl.readPixels;

    r.syncGpu();
    expect(readPixels).not.toHaveBeenCalled();

    r.render(pd);
    r.syncGpu();
    expect(readPixels).toHaveBeenCalledTimes(1);
    r.destroy();
  });

  it('syncGpu is a no-op once the context is lost', () => {
    const { renderer: r, gl, setContextLost } = makeRenderer();
    const readPixels = gl.readPixels;
    r.render(pd);
    setContextLost(true);

    r.syncGpu();
    expect(readPixels).not.toHaveBeenCalled();
    r.destroy();
  });
});
