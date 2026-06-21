// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as d3 from 'd3';
import { WebGLRenderer } from './webgl-renderer';
import type { PlotData } from '@protspace/utils';
import type { ScalePair, WebGLStyleGetters } from '../types';
import { createMockCanvas } from './test-support/mock-webgl2';

// B1 renderer lifecycle behavior-change tests (TDD): F-43, F-39, F-01.
// These assert POST-change behavior, so on the unmodified tree:
//   - F-43 (destroy disposes GPU resources)            -> RED
//   - F-39 (no webglcontextrestored listener)          -> RED
//   - F-01 programmatic loss routes to onContextLost    -> RED
//   - F-01 DOM no-double-fire (invariant lock)          -> GREEN
//
// The shared mock-webgl2 harness provides the full gl.* surface the render path
// needs (incl. uniform3f / disableVertexAttribArray), so render()-driven tests
// exercise the real path via createMockCanvas directly.

const scales = (): ScalePair => ({
  x: d3.scaleLinear().domain([0, 1]).range([0, 800]),
  y: d3.scaleLinear().domain([0, 1]).range([0, 600]),
});

const styleGetters = (): WebGLStyleGetters => ({
  getColors: () => ['#f00'],
  getPointSize: () => 9,
  getOpacity: () => 1,
  getDepth: () => 0,
  getShape: () => 'circle',
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

    expect(del.vao).toHaveBeenCalledTimes(1); // pointVao
    expect(del.buffer.mock.calls.length).toBeGreaterThanOrEqual(7); // 6 data buffers + quad
    expect(del.texture.mock.calls.length).toBeGreaterThanOrEqual(1); // labelColorTexture (+linearFramebuffer.texture when the gamma pipeline is available)
    expect(del.program.mock.calls.length).toBeGreaterThanOrEqual(1); // pointProgram (+gamma if available)
  });

  // F-39 — delete the unreachable internal handleContextRestored recovery.
  it('F-39: constructor registers no webglcontextrestored listener', () => {
    const { canvas } = createMockCanvas();
    const add = vi.spyOn(canvas, 'addEventListener');
    const r = new WebGLRenderer(canvas, scales, getTransform, getConfig, styleGetters(), vi.fn());
    const types = add.mock.calls.map((c) => c[0]);
    expect(types).toContain('webglcontextlost');
    expect(types).not.toContain('webglcontextrestored');
    r.destroy();
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

  it('F-01: DOM webglcontextlost still fires onContextLost exactly once (no double-fire)', () => {
    const { canvas } = createMockCanvas();
    const onContextLost = vi.fn();
    const r = new WebGLRenderer(
      canvas,
      scales,
      getTransform,
      getConfig,
      styleGetters(),
      onContextLost,
    );
    r.render(makePlotData(3));
    canvas.dispatchEvent(new Event('webglcontextlost', { cancelable: true }));
    expect(onContextLost).toHaveBeenCalledTimes(1);
    r.destroy();
  });
});
