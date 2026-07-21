// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as d3 from 'd3';
import { WebGLRenderer } from './webgl-renderer';
import type { PlotData } from '@protspace/utils';
import type { ScalePair, WebGLStyleGetters } from '../types';
import { createMockCanvas } from './test-support/mock-webgl2';

// The shared mock-webgl2 harness provides the full gl.* surface the render path needs
// (incl. uniform3f / disableVertexAttribArray), so render()-driven tests below can
// exercise the real path via createMockCanvas directly.
const pd: PlotData = {
  length: 2,
  xs: new Float32Array([0, 1]),
  ys: new Float32Array([0, 1]),
  zs: null,
  originalIndices: null,
  proteinIds: ['p0', 'p1'],
};
const scales = (): ScalePair => ({
  x: d3.scaleLinear().domain([0, 1]).range([0, 800]),
  y: d3.scaleLinear().domain([0, 1]).range([0, 600]),
});
const style = (): WebGLStyleGetters => ({
  getColors: () => ['#f00'],
  getPointSize: () => 9,
  getOpacity: () => 1,
  getDepth: () => 0,
  getShape: () => 'circle',
  isPredicted: () => false,
});

describe('WebGLRenderer context loss + restore (F-09 characterization lock)', () => {
  let rafQueue: FrameRequestCallback[];
  beforeEach(() => {
    rafQueue = [];
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
      rafQueue.push(cb);
      return rafQueue.length;
    });
  });
  afterEach(() => {
    vi.unstubAllGlobals(); // restores the requestAnimationFrame stub
    vi.restoreAllMocks(); // restores vi.spyOn spies (render spies + createMockCanvas getContext)
  });
  const drain = () => {
    const q = rafQueue;
    rafQueue = [];
    q.forEach((cb) => cb(0));
  };

  it('webglcontextlost fires onContextLost and preventDefaults', () => {
    const { canvas } = createMockCanvas();
    const onLost = vi.fn();
    new WebGLRenderer(
      canvas,
      scales,
      () => d3.zoomIdentity,
      () => ({ width: 800, height: 600 }),
      style(),
      onLost,
    );
    const ev = new Event('webglcontextlost', { cancelable: true });
    const prevented = !canvas.dispatchEvent(ev);
    expect(onLost).toHaveBeenCalledTimes(1);
    expect(prevented).toBe(true); // preventDefault() was called
  });

  it('destroy() removes both listeners (post-destroy loss does not fire onContextLost)', () => {
    const { canvas } = createMockCanvas();
    const onLost = vi.fn();
    const r = new WebGLRenderer(
      canvas,
      scales,
      () => d3.zoomIdentity,
      () => ({ width: 800, height: 600 }),
      style(),
      onLost,
    );
    r.destroy();
    canvas.dispatchEvent(new Event('webglcontextlost', { cancelable: true }));
    expect(onLost).not.toHaveBeenCalled();
  });

  // F-39: the internal webglcontextrestored recovery handler was deleted. It was
  // unreachable in production (real loss → onContextLost → scatter-plot destroy()s
  // the renderer, which removes the webglcontextlost listener and disposes; the
  // restore listener never survived to fire). Recovery now flows solely through the
  // scatter-plot rebuild-on-loss path. These two cases used to characterize the dead
  // internal handler (they only "passed" because they synthesized the restore event
  // directly); they now pin its absence.
  it('F-39: no webglcontextrestored listener — dispatching restore does NOT re-render', () => {
    const { canvas } = createMockCanvas();
    const r = new WebGLRenderer(
      canvas,
      scales,
      () => d3.zoomIdentity,
      () => ({ width: 800, height: 600 }),
      style(),
    );
    r.render(pd); // sets lastRenderedData
    const renderSpy = vi.spyOn(r, 'render');
    canvas.dispatchEvent(new Event('webglcontextlost', { cancelable: true }));
    canvas.dispatchEvent(new Event('webglcontextrestored'));
    drain(); // no RAF was ever queued by the (now-deleted) restore handler
    expect(renderSpy).not.toHaveBeenCalled();
  });

  it('F-39: constructor registers no webglcontextrestored listener', () => {
    const addSpy = vi.spyOn(HTMLCanvasElement.prototype, 'addEventListener');
    const r = new WebGLRenderer(
      createMockCanvas().canvas,
      scales,
      () => d3.zoomIdentity,
      () => ({ width: 800, height: 600 }),
      style(),
    );
    const types = addSpy.mock.calls.map((c) => c[0]);
    expect(types).toContain('webglcontextlost');
    expect(types).not.toContain('webglcontextrestored');
    r.destroy();
  });
});

describe('WebGLRenderer gamma fallback (F-09 characterization lock)', () => {
  // Restores the createMockCanvas getContext spies and any console.warn spy so
  // none leak into later suites. vi.unstubAllGlobals does not restore vi.spyOn.
  afterEach(() => vi.restoreAllMocks());

  // CHARACTERIZATION LOCK (verified against the unmodified tree, webgl-renderer.ts):
  // On the missing-float-extensions path, ensureGL sets `gammaPipelineAvailable = false`
  // (L1492) BEFORE calling handleGammaFallback('required extensions missing') (L1494).
  // handleGammaFallback's first line `if (!this.gammaPipelineAvailable) return;` (L535)
  // short-circuits past console.warn, so production emits ZERO warnings on this path
  // (the warn-once message is effectively unreachable for the missing-extensions case)
  // while getEffectiveGamma() still drops to 1.0 (shouldUseGammaPipeline() === false).
  // This pins BOTH facts; any refactor that changes the warn count or the gamma value
  // fails the lock. (The plan sketch asserted "warns once"; the true count is 0.)
  it('missing float extensions → getEffectiveGamma() drops to 1.0 (silently, no warn)', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { canvas } = createMockCanvas({ missingFloatExtensions: true });
    const r = new WebGLRenderer(
      canvas,
      scales,
      () => d3.zoomIdentity,
      () => ({ width: 800, height: 600 }),
      style(),
    );
    r.render(pd); // ensureGL detects missing extensions → gammaPipelineAvailable = false
    const getGamma = (r as unknown as { getEffectiveGamma(): number }).getEffectiveGamma.bind(r);
    expect(getGamma()).toBe(1.0);
    expect(warnSpy).toHaveBeenCalledTimes(0); // L1492-before-L1494 ordering bypasses the warn
  });

  it('framebuffer incomplete during init → gamma pipeline drops to direct (gamma 1.0)', () => {
    const { canvas } = createMockCanvas({ framebufferIncomplete: true });
    const r = new WebGLRenderer(
      canvas,
      scales,
      () => d3.zoomIdentity,
      () => ({ width: 800, height: 600 }),
      style(),
    );
    r.render(pd);
    expect((r as unknown as { getEffectiveGamma(): number }).getEffectiveGamma()).toBe(1.0);
  });
});
