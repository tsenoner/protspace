// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import * as d3 from 'd3';
import { WebGLRenderer } from './webgl-renderer';
import type { ScalePair } from '../types';
import type { GLResources } from './gl-resources';
import type { RendererDegradedDetail } from '../../scatter-plot.events';
import { plotData, styleGetters } from './test-support/renderer-fixture';
import { createMockCanvas, type MockGLOptions } from './test-support/mock-webgl2';
import type * as DensityPass from './density-pass';

type DensityPassModule = typeof DensityPass;

const scales = (): ScalePair => ({
  x: d3.scaleLinear().domain([0, 1]).range([0, 800]),
  y: d3.scaleLinear().domain([0, 1]).range([0, 600]),
});

type Config = { width: number; height: number; densityLayer?: 'off' | 'auto' | 'on' };

function setup(config: Config, opts: MockGLOptions = {}) {
  const { canvas, gl } = createMockCanvas(opts);
  const degraded: RendererDegradedDetail[] = [];
  const renderer = new WebGLRenderer(
    canvas,
    scales,
    () => d3.zoomIdentity,
    () => config as never,
    styleGetters(),
    undefined,
    () => [1, 1, 1],
    (detail) => degraded.push(detail),
  );
  const glRecord = gl as unknown as Record<string, (...a: unknown[]) => unknown>;
  return {
    renderer,
    gl: gl as unknown as Record<string, ReturnType<typeof vi.fn>>,
    glRecord,
    degraded,
    resources: (renderer as unknown as { resources: GLResources }).resources,
  };
}

/** Every GL call this frame makes, in order, with its scalar arguments. */
function recordCalls(gl: Record<string, (...a: unknown[]) => unknown>): string[] {
  const calls: string[] = [];
  for (const name of Object.keys(gl)) {
    const original = gl[name];
    if (typeof original !== 'function') continue;
    gl[name] = (...args: unknown[]) => {
      calls.push(
        `${name}(${args.map((a) => (typeof a === 'object' && a !== null ? 'obj' : String(a))).join(',')})`,
      );
      return original(...args);
    };
  }
  return calls;
}

const countOf = (calls: string[], needle: string) => calls.filter((c) => c === needle).length;

afterEach(() => vi.restoreAllMocks());

describe('density layer, off', () => {
  it('makes byte-identical GL calls whether densityLayer is off or absent', () => {
    const off = setup({ width: 800, height: 600, densityLayer: 'off' });
    const offCalls = recordCalls(off.glRecord);
    off.renderer.render(plotData(50));

    const absent = setup({ width: 800, height: 600 });
    const absentCalls = recordCalls(absent.glRecord);
    absent.renderer.render(plotData(50));

    expect(offCalls).toEqual(absentCalls);
    // The accumulate pass is the one additive blend in the renderer.
    expect(countOf(offCalls, 'blendFunc(1,1)')).toBe(0);
    off.renderer.destroy();
    absent.renderer.destroy();
  });
});

describe('density layer, on', () => {
  it('accumulates additively and adds three full-screen quad draws', () => {
    const on = setup({ width: 800, height: 600, densityLayer: 'on' });
    const calls = recordCalls(on.glRecord);
    on.renderer.render(plotData(50));

    expect(countOf(calls, 'blendFunc(1,1)')).toBe(1);
    // Two blur passes, the composite, and the gamma quad. The mock's TRIANGLES
    // constant is not asserted; the 6-vertex count is what identifies a quad.
    expect(calls.filter((c) => /^drawArrays\(\d+,0,6\)$/.test(c))).toHaveLength(4);
    on.renderer.destroy();
  });

  it('restores the point program and VAO after compositing mid-draw', () => {
    const on = setup({ width: 800, height: 600, densityLayer: 'on' });
    const calls = recordCalls(on.glRecord);
    on.renderer.render(plotData(50));

    // The composite is the first quad draw AFTER the point draw (the two blur
    // passes run before it, the gamma quad after). A selection frame draws points
    // again straight after it, so it has to find its own program and VAO bound.
    // lastIndexOf: the accumulate pass draws the same POINTS call earlier.
    const pointDraw = calls.lastIndexOf('drawArrays(0,0,50)');
    expect(pointDraw).toBeGreaterThan(-1);
    const composite = calls.findIndex((c, i) => i > pointDraw && /^drawArrays\(\d+,0,6\)$/.test(c));
    expect(composite).toBeGreaterThan(pointDraw);
    expect(calls.slice(composite + 1, composite + 5)).toEqual([
      'bindVertexArray(null)',
      'bindTexture(3553,null)',
      'useProgram(obj)',
      'bindVertexArray(obj)',
    ]);
    on.renderer.destroy();
  });

  it('stays off without the float extensions, and adds no degraded reason', () => {
    const on = setup(
      { width: 800, height: 600, densityLayer: 'on' },
      {
        missingFloatExtensions: true,
      },
    );
    const calls = recordCalls(on.glRecord);
    on.renderer.render(plotData(50));

    expect(countOf(calls, 'blendFunc(1,1)')).toBe(0);
    // Nothing at all: ensureGL clears gammaPipelineAvailable BEFORE calling
    // handleGammaFallback, whose first line returns once the flag is false, so
    // this path has always been silent. Density must not change that.
    expect(on.degraded).toEqual([]);
    on.renderer.destroy();
  });

  it('drops the density resources when the gamma pipeline falls back', () => {
    // Fail the gamma framebuffer on a RESIZE, after a good first frame: that is
    // the one fallback path where the density grid is live and nothing else
    // would tear it down, so it isolates the destroy in handleGammaFallback.
    const config: Config = { width: 800, height: 600, densityLayer: 'on' };
    const on = setup(config);
    on.renderer.render(plotData(50));
    expect(on.resources.density).not.toBeNull();

    on.gl.checkFramebufferStatus = vi.fn(() => 0);
    const deleteProgram = vi.spyOn(on.gl, 'deleteProgram');
    config.width = 1024;
    on.renderer.render(plotData(50));

    expect(
      (on.renderer as unknown as { gammaPipelineAvailable: boolean }).gammaPipelineAvailable,
    ).toBe(false);
    expect(on.resources.density).toBeNull();
    // The gamma program plus the three density programs.
    expect(deleteProgram).toHaveBeenCalledTimes(4);
    // Exactly one reason, and it is the gamma one: density adds no new reason.
    expect(on.degraded.map((d) => d.context.reason)).toEqual(['gamma-pipeline-unavailable']);
    on.renderer.destroy();
  });

  it('reallocates the grid once per size change, not per render', () => {
    const config: Config = { width: 800, height: 600, densityLayer: 'on' };
    const on = setup(config);
    const accumAllocations = () =>
      on.gl.texImage2D.mock.calls.filter((c) => c[2] === 0x8814).length; // RGBA32F

    on.renderer.render(plotData(50));
    expect(accumAllocations()).toBe(1);
    on.renderer.render(plotData(50));
    expect(accumAllocations()).toBe(1);

    config.width = 1024;
    on.renderer.render(plotData(50));
    expect(accumAllocations()).toBe(2);
    on.renderer.destroy();
  });
});

describe('density layer failure is not a gamma failure', () => {
  it('keeps rendering through the gamma pipeline when the grid cannot be allocated', async () => {
    vi.doMock('./density-pass', async (importOriginal) => ({
      ...(await importOriginal<DensityPassModule>()),
      resizeDensityTargets: () => false,
    }));
    vi.resetModules();
    const { WebGLRenderer: Renderer } = await import('./webgl-renderer');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const { canvas, gl } = createMockCanvas();
    const degraded: RendererDegradedDetail[] = [];
    const renderer = new Renderer(
      canvas,
      scales,
      () => d3.zoomIdentity,
      () => ({ width: 800, height: 600, densityLayer: 'on' }) as never,
      styleGetters(),
      undefined,
      () => [1, 1, 1],
      (detail) => degraded.push(detail),
    );
    const calls = recordCalls(gl as unknown as Record<string, (...a: unknown[]) => unknown>);
    renderer.render(plotData(50));

    expect(countOf(calls, 'blendFunc(1,1)')).toBe(0);
    // The gamma quad still runs: a density allocation failure must not switch the
    // whole app to sRGB blending.
    expect(calls.filter((c) => /^drawArrays\(\d+,0,6\)$/.test(c))).toHaveLength(1);
    expect(degraded).toEqual([]);
    expect(warn.mock.calls.flat().join(' ')).toContain('density layer disabled');
    expect((renderer as unknown as { resources: GLResources }).resources.density).toBeNull();
    renderer.destroy();
    vi.doUnmock('./density-pass');
    vi.resetModules();
  });
});

describe('context loss', () => {
  it('clears the density latch so the next context can try again', () => {
    const { canvas, gl, setContextLost } = createMockCanvas();
    const renderer = new WebGLRenderer(
      canvas,
      scales,
      () => d3.zoomIdentity,
      () => ({ width: 800, height: 600, densityLayer: 'on' }) as never,
      styleGetters(),
    );
    renderer.render(plotData(50));
    const priv = renderer as unknown as { densityDisabled: boolean };
    priv.densityDisabled = true;

    setContextLost(true);
    vi.spyOn(gl!, 'isContextLost').mockReturnValue(true);
    renderer.render(plotData(50)); // ensureGL -> markContextLost -> resetRendererState

    expect(priv.densityDisabled).toBe(false);
    renderer.destroy();
  });
});
