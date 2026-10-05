// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as d3 from 'd3';
import type { PlotData } from '@protspace/utils';
import type { RendererDegradedDetail } from '../../scatter-plot.events';
import { GAMMA_FRAGMENT_SHADER } from './export-shaders';
import type { WebGLRenderer } from './webgl-renderer';
import { makeRenderer, plotData } from './test-support/renderer-fixture';

// The shared mock-webgl2 harness provides the full gl.* surface the render path needs
// (incl. uniform3f / disableVertexAttribArray), so render()-driven tests below can
// exercise the real path through makeRenderer.
const pd: PlotData = {
  length: 2,
  xs: new Float32Array([0, 1]),
  ys: new Float32Array([0, 1]),
  zs: null,
  originalIndices: null,
  proteinIds: ['p0', 'p1'],
};
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
    const onLost = vi.fn();
    const { canvas } = makeRenderer({ onContextLost: onLost });
    const ev = new Event('webglcontextlost', { cancelable: true });
    const prevented = !canvas.dispatchEvent(ev);
    expect(onLost).toHaveBeenCalledTimes(1);
    expect(prevented).toBe(true); // preventDefault() was called
  });

  it('destroy() removes both listeners (post-destroy loss does not fire onContextLost)', () => {
    const onLost = vi.fn();
    const { renderer: r, canvas } = makeRenderer({ onContextLost: onLost });
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
    const { renderer: r, canvas } = makeRenderer();
    r.render(pd); // sets lastRenderedData
    const renderSpy = vi.spyOn(r, 'render');
    canvas.dispatchEvent(new Event('webglcontextlost', { cancelable: true }));
    canvas.dispatchEvent(new Event('webglcontextrestored'));
    drain(); // no RAF was ever queued by the (now-deleted) restore handler
    expect(renderSpy).not.toHaveBeenCalled();
  });

  it('F-39: constructor registers no webglcontextrestored listener', () => {
    const addSpy = vi.spyOn(HTMLCanvasElement.prototype, 'addEventListener');
    const { renderer: r } = makeRenderer();
    const types = addSpy.mock.calls.map((c) => c[0]);
    expect(types).toContain('webglcontextlost');
    expect(types).not.toContain('webglcontextrestored');
    r.destroy();
  });
});

// renderer-capability-limits, "A capability reduction SHALL reach the user, not
// only the console": a gamma pipeline the context supports but loses at runtime
// is reported as 'gamma-pipeline-unavailable'. A context that never had the float
// extensions (iPhone/iPad WebKit has no EXT_float_blend) is not. Nothing changed
// in front of that user, and the only visible consequence, contours, is reported
// as 'density-unavailable' when they are requested (density.test.ts).
describe('WebGLRenderer gamma fallback reporting', () => {
  // Restores the createMockCanvas getContext spies and the console.warn spy so
  // none leak into later suites. vi.unstubAllGlobals does not restore vi.spyOn.
  afterEach(() => vi.restoreAllMocks());
  beforeEach(() => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  const gammaOf = (r: WebGLRenderer) =>
    (r as unknown as { getEffectiveGamma(): number }).getEffectiveGamma();
  const gammaNotices = (degraded: RendererDegradedDetail[]) =>
    degraded.filter((d) => d.context.reason === 'gamma-pipeline-unavailable');

  it('a context without the float extensions renders direct and raises no gamma notice', () => {
    const { renderer, degraded } = makeRenderer({ missingFloatExtensions: true });
    renderer.render(plotData(50));
    renderer.render(plotData(50));

    expect(gammaOf(renderer)).toBe(1.0);
    // Contours are off here, so nothing at all is reported.
    expect(degraded).toEqual([]);
    renderer.destroy();
  });

  it('an incomplete linear framebuffer at init is reported once as gamma-pipeline-unavailable', () => {
    const { renderer, degraded } = makeRenderer({ framebufferIncomplete: true });
    renderer.render(plotData(50));
    renderer.render(plotData(50));

    expect(gammaOf(renderer)).toBe(1.0);
    expect(gammaNotices(degraded)).toHaveLength(1);
    expect(gammaNotices(degraded)[0].context.detail).toBe('framebuffer incomplete');
    expect(gammaNotices(degraded)[0].message).toContain('sRGB rather than linear light');
    renderer.destroy();
  });

  it('a gamma shader that fails to link is reported once as gamma-pipeline-unavailable', () => {
    const { renderer, gl, degraded } = makeRenderer();
    // Fail only the program built from the gamma fragment shader, so the point
    // shaders still link and the renderer reaches the gamma init.
    const sources = new WeakMap<object, string>();
    const gammaPrograms = new WeakSet<object>();
    const shaderSource = gl.shaderSource;
    gl.shaderSource = vi.fn((shader: object, src: string) => {
      sources.set(shader, src);
      return shaderSource(shader, src);
    });
    const attachShader = gl.attachShader;
    gl.attachShader = vi.fn((program: object, shader: object) => {
      if (sources.get(shader) === GAMMA_FRAGMENT_SHADER) gammaPrograms.add(program);
      return attachShader(program, shader);
    });
    const getProgramParameter = gl.getProgramParameter;
    gl.getProgramParameter = vi.fn((program: object, pname: number) =>
      gammaPrograms.has(program) ? false : getProgramParameter(program, pname),
    );

    renderer.render(plotData(50));
    renderer.render(plotData(50));

    expect(gammaOf(renderer)).toBe(1.0);
    expect(gammaNotices(degraded)).toHaveLength(1);
    expect(gammaNotices(degraded)[0].context.detail).toBe('gamma shader init failed');
    renderer.destroy();
  });
});

// Every query below returns only once the GPU process has caught up, so a call per
// frame puts CPU and GPU in lockstep. The renderer asks them at (re)creation only.
const SYNC_QUERIES = [
  'isProgram',
  'isVertexArray',
  'isBuffer',
  'isTexture',
  'isFramebuffer',
  'isRenderbuffer',
  'getError',
  'getParameter',
  'checkFramebufferStatus',
  'getShaderParameter',
  'getProgramParameter',
  'getExtension',
] as const;

describe('WebGLRenderer per-frame GPU queries', () => {
  afterEach(() => vi.restoreAllMocks());

  it.each([
    ['contours off', undefined],
    ['contours on', 'on' as const],
  ])('a camera move with %s waits on no GPU query', (_label, densityLayer) => {
    let transform = d3.zoomIdentity;
    const { renderer, gl } = makeRenderer({
      getConfig: () => ({ width: 800, height: 600, densityLayer }),
      getTransform: () => transform,
    });
    renderer.render(plotData(50));

    const glRecord = gl as unknown as Record<string, () => unknown>;
    // Some mock methods are already recording; clear what creation put in them.
    const spies = SYNC_QUERIES.map((name) => [name, vi.spyOn(glRecord, name).mockClear()] as const);

    for (let i = 1; i <= 5; i++) {
      transform = d3.zoomIdentity.translate(i * 10, i * 5).scale(1 + i / 10);
      renderer.render(plotData(50));
    }

    const called = spies.filter(([, spy]) => spy.mock.calls.length > 0).map(([name]) => name);
    expect(called).toEqual([]);
    renderer.destroy();
  });
});

describe('WebGLRenderer context loss without a per-frame handle check', () => {
  afterEach(() => vi.restoreAllMocks());

  it('never draws on a restored context: its handles belong to the lost one', () => {
    const onLost = vi.fn();
    const { renderer: r, canvas, gl, setContextLost } = makeRenderer({ onContextLost: onLost });
    r.render(pd);
    const drawArrays = vi.spyOn(gl, 'drawArrays');
    r.render(pd);
    expect(drawArrays).toHaveBeenCalled();
    drawArrays.mockClear();

    // WEBGL_lose_context.loseContext(): the flag flips before the event is dispatched.
    setContextLost(true);
    r.render(pd);
    expect(onLost).toHaveBeenCalledTimes(1);

    // restoreContext(): isContextLost() reads false again, with no live handles.
    setContextLost(false);
    canvas.dispatchEvent(new Event('webglcontextlost', { cancelable: true }));
    canvas.dispatchEvent(new Event('webglcontextrestored'));
    r.render(pd);
    r.render(pd);

    expect(drawArrays).not.toHaveBeenCalled();
    expect(onLost).toHaveBeenCalledTimes(1);
    r.destroy();
  });
});
