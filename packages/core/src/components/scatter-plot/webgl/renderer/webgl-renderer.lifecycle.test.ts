// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as d3 from 'd3';
import { WebGLRenderer } from './webgl-renderer';
import type { PlotData } from '@protspace/utils';
import type { ScalePair } from '../types';
import { styleGetters } from './test-support/renderer-fixture';
import { createMockCanvas } from './test-support/mock-webgl2';

// B1 renderer lifecycle: destroy() disposes the GPU resources (F-43), a
// programmatic context loss reaches onContextLost (F-01), and syncGpu's guards.
// The DOM webglcontextlost path and the absent restore listener (F-39) are in
// webgl-renderer.context-loss.test.ts and context-loss-controller.test.ts.
//
// The shared mock-webgl2 harness provides the full gl.* surface the render path
// needs (incl. uniform3f / disableVertexAttribArray), so render()-driven tests
// exercise the real path via createMockCanvas directly.

const scales = (): ScalePair => ({
  x: d3.scaleLinear().domain([0, 1]).range([0, 800]),
  y: d3.scaleLinear().domain([0, 1]).range([0, 600]),
});

const getTransform = () => d3.zoomIdentity;
const getConfig = () => ({ width: 800, height: 600 });

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
    const { canvas, gl } = createMockCanvas();
    const renderer = new WebGLRenderer(canvas, scales, getTransform, getConfig, styleGetters());
    // Force lazy resource creation so there are handles to delete.
    renderer.render(makePlotData(3)); // ensureGL() -> createBuffer/VAO/texture/program

    const del = {
      vao: vi.spyOn(gl!, 'deleteVertexArray'),
      buffer: vi.spyOn(gl!, 'deleteBuffer'),
      texture: vi.spyOn(gl!, 'deleteTexture'),
      program: vi.spyOn(gl!, 'deleteProgram'),
    };

    renderer.destroy();

    expect(del.vao).toHaveBeenCalledTimes(1);
    expect(del.buffer.mock.calls.length).toBeGreaterThanOrEqual(7); // 6 data buffers + quad
    expect(del.texture.mock.calls.length).toBeGreaterThanOrEqual(1); // labelColorTexture (+linearFramebuffer.texture when the gamma pipeline is available)
    expect(del.program.mock.calls.length).toBeGreaterThanOrEqual(1); // pointProgram (+gamma if available)
  });

  // F-01 — route programmatic context loss to recovery (sanctioned visible change).
  it('F-01: programmatic loss (gl.isContextLost) routes to onContextLost once', () => {
    const { canvas, gl } = createMockCanvas();
    const onContextLost = vi.fn();
    const r = new WebGLRenderer(
      canvas,
      scales,
      getTransform,
      getConfig,
      styleGetters(),
      onContextLost,
    );
    r.render(makePlotData(3)); // acquire context
    // Simulate a driver reset with NO webglcontextlost DOM event:
    vi.spyOn(gl!, 'isContextLost').mockReturnValue(true);
    r.render(makePlotData(3)); // render -> ensureGL/isContextLost -> markContextLost
    expect(onContextLost).toHaveBeenCalledTimes(1);
    r.destroy();
  });

  it('syncGpu reads one pixel after a render and is a no-op before any context', () => {
    const { canvas, gl } = createMockCanvas();
    const readPixels = gl!.readPixels as unknown as ReturnType<typeof vi.fn>;
    const r = new WebGLRenderer(canvas, scales, getTransform, getConfig, styleGetters());

    r.syncGpu();
    expect(readPixels).not.toHaveBeenCalled();

    r.render(makePlotData(3));
    r.syncGpu();
    expect(readPixels).toHaveBeenCalledTimes(1);
    r.destroy();
  });

  it('syncGpu is a no-op once the context is lost', () => {
    const { canvas, gl, setContextLost } = createMockCanvas();
    const readPixels = gl!.readPixels as unknown as ReturnType<typeof vi.fn>;
    const r = new WebGLRenderer(canvas, scales, getTransform, getConfig, styleGetters());
    r.render(makePlotData(3));
    setContextLost(true);

    r.syncGpu();
    expect(readPixels).not.toHaveBeenCalled();
    r.destroy();
  });
});
