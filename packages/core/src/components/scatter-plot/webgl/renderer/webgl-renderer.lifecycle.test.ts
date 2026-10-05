// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { PlotData } from '@protspace/utils';
import { makeRenderer } from './test-support/renderer-fixture';

// B1 renderer lifecycle behavior-change tests (TDD): F-43, F-39, F-01.
// These assert POST-change behavior, so on the unmodified tree:
//   - F-43 (destroy disposes GPU resources)            -> RED
//   - F-39 (no webglcontextrestored listener)          -> RED
//   - F-01 programmatic loss routes to onContextLost    -> RED
//   - F-01 DOM no-double-fire (invariant lock)          -> GREEN
//
// The shared mock-webgl2 harness provides the full gl.* surface the render path
// needs (incl. uniform3f / disableVertexAttribArray), so render()-driven tests
// exercise the real path through makeRenderer.

function makePlotData(n: number): PlotData {
  const xs = new Float32Array(n);
  const ys = new Float32Array(n);
  const proteinIds: string[] = [];
  for (let i = 0; i < n; i++) {
    xs[i] = i / Math.max(1, n - 1);
    ys[i] = i / Math.max(1, n - 1);
    proteinIds.push(`p${i}`);
  }
  return { length: n, xs, ys, zs: null, originalIndices: null, proteinIds };
}

describe('WebGLRenderer lifecycle (B1: F-43 / F-39 / F-01)', () => {
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
    renderer.render(makePlotData(3)); // ensureGL() -> createBuffer/VAO/texture/program

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

  // F-39 — delete the unreachable internal handleContextRestored recovery.
  it('F-39: constructor registers no webglcontextrestored listener', () => {
    const add = vi.spyOn(HTMLCanvasElement.prototype, 'addEventListener');
    const { renderer: r } = makeRenderer({ onContextLost: vi.fn() });
    const types = add.mock.calls.map((c) => c[0]);
    expect(types).toContain('webglcontextlost');
    expect(types).not.toContain('webglcontextrestored');
    r.destroy();
  });

  // F-01 — route programmatic context loss to recovery (sanctioned visible change).
  it('F-01: programmatic loss (gl.isContextLost) routes to onContextLost once', () => {
    const onContextLost = vi.fn();
    const { renderer: r, gl } = makeRenderer({ onContextLost });
    r.render(makePlotData(3)); // acquire context
    // Simulate a driver reset with NO webglcontextlost DOM event:
    vi.spyOn(gl, 'isContextLost').mockReturnValue(true);
    r.render(makePlotData(3)); // render -> ensureGL/isContextLost -> markContextLost
    expect(onContextLost).toHaveBeenCalledTimes(1);
    r.destroy();
  });

  it('F-01: DOM webglcontextlost still fires onContextLost exactly once (no double-fire)', () => {
    const onContextLost = vi.fn();
    const { renderer: r, canvas } = makeRenderer({ onContextLost });
    r.render(makePlotData(3));
    canvas.dispatchEvent(new Event('webglcontextlost', { cancelable: true }));
    expect(onContextLost).toHaveBeenCalledTimes(1);
    r.destroy();
  });

  it('syncGpu reads one pixel after a render and is a no-op before any context', () => {
    const { renderer: r, gl } = makeRenderer();
    const readPixels = vi.spyOn(gl, 'readPixels');

    r.syncGpu();
    expect(readPixels).not.toHaveBeenCalled();

    r.render(makePlotData(3));
    r.syncGpu();
    expect(readPixels).toHaveBeenCalledTimes(1);
    r.destroy();
  });

  it('syncGpu is a no-op once the context is lost', () => {
    const { renderer: r, gl, setContextLost } = makeRenderer();
    const readPixels = vi.spyOn(gl, 'readPixels');
    r.render(makePlotData(3));
    setContextLost(true);

    r.syncGpu();
    expect(readPixels).not.toHaveBeenCalled();
    r.destroy();
  });
});
