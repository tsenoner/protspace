// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import * as d3 from 'd3';
import { WebGLRenderer } from './webgl-renderer';
import type { ScalePair } from '../types';
import type { GLResources } from './gl-resources';
import type { RendererDegradedDetail } from '../../scatter-plot.events';
import { makeRendererWithStyle, plotData, styleGetters } from './test-support/renderer-fixture';
import { createMockCanvas, type MockGLOptions } from './test-support/mock-webgl2';

const scales = (): ScalePair => ({
  x: d3.scaleLinear().domain([0, 1]).range([0, 800]),
  y: d3.scaleLinear().domain([0, 1]).range([0, 600]),
});

type Config = { width: number; height: number; densityLayer?: 'off' | 'auto' | 'on' };

function setup(
  config: Config,
  opts: MockGLOptions = {},
  getTransform: () => d3.ZoomTransform = () => d3.zoomIdentity,
) {
  const { canvas, gl } = createMockCanvas(opts);
  const degraded: RendererDegradedDetail[] = [];
  const renderer = new WebGLRenderer(
    canvas,
    scales,
    getTransform,
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

/** RGBA32F texImage2D calls: the accumulation target, and nothing else. */
const accumAllocations = (gl: Record<string, ReturnType<typeof vi.fn>>) =>
  gl.texImage2D.mock.calls.filter((c) => c[2] === 0x8814).length;

describe('density layer, off', () => {
  it('compiles no density programs and allocates no targets', () => {
    // ~17 MB of RGBA32F + RGBA16F and three shader compiles, on the default path
    // for every user, is the whole cost of a feature they have not switched on.
    const absent = setup({ width: 800, height: 600 });
    const absentPrograms = vi.spyOn(absent.gl, 'createProgram');
    absent.renderer.render(plotData(50));

    expect(accumAllocations(absent.gl)).toBe(0);
    expect(absent.resources.density).toBeNull();

    const on = setup({ width: 800, height: 600, densityLayer: 'on' });
    const onPrograms = vi.spyOn(on.gl, 'createProgram');
    on.renderer.render(plotData(50));

    expect(accumAllocations(on.gl)).toBe(1);
    expect(on.resources.density).not.toBeNull();
    // Accumulate, blur, composite.
    expect(onPrograms.mock.calls.length).toBe(absentPrograms.mock.calls.length + 3);

    absent.renderer.destroy();
    on.renderer.destroy();
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
    const deleteVao = vi.spyOn(on.gl, 'deleteVertexArray');
    config.width = 1024;
    on.renderer.render(plotData(50));

    expect(
      (on.renderer as unknown as { gammaPipelineAvailable: boolean }).gammaPipelineAvailable,
    ).toBe(false);
    expect(on.resources.density).toBeNull();
    // The gamma program plus the three density programs.
    expect(deleteProgram).toHaveBeenCalledTimes(4);
    // The density quad's VAO goes with them; the point VAO stays.
    expect(deleteVao).toHaveBeenCalledTimes(1);
    // Exactly one reason, and it is the gamma one: density adds no new reason.
    expect(on.degraded.map((d) => d.context.reason)).toEqual(['gamma-pipeline-unavailable']);
    on.renderer.destroy();
  });

  it('reallocates the grid once per size change, not per render', () => {
    const config: Config = { width: 800, height: 600, densityLayer: 'on' };
    const on = setup(config);

    on.renderer.render(plotData(50));
    expect(accumAllocations(on.gl)).toBe(1);
    on.renderer.render(plotData(50));
    expect(accumAllocations(on.gl)).toBe(1);

    config.width = 1024;
    on.renderer.render(plotData(50));
    expect(accumAllocations(on.gl)).toBe(2);
    on.renderer.destroy();
  });
});

describe('density layer, auto', () => {
  // 573,649 visible points in an 800 px view: the cross-fade's threshold sits at
  // k = 5.36, so identity is deep in the "overplotted" half and k = 100 is past
  // the far end of the fade.
  const swissprot = () => plotData(573649);

  it('skips the whole chain when the view is zoomed past the fade', () => {
    const on = setup({ width: 800, height: 600, densityLayer: 'auto' }, {}, () =>
      d3.zoomIdentity.scale(100),
    );
    const calls = recordCalls(on.glRecord);
    on.renderer.render(swissprot());

    expect(on.renderer.visiblePointCount).toBe(573649);
    expect(countOf(calls, 'blendFunc(1,1)')).toBe(0);
    // Not one texel of the grid is allocated for a frame that shows nothing.
    expect(on.resources.density).toBeNull();
    on.renderer.destroy();
  });

  it('runs the chain on an overplotted view', () => {
    const on = setup({ width: 800, height: 600, densityLayer: 'auto' });
    const calls = recordCalls(on.glRecord);
    on.renderer.render(swissprot());

    expect(countOf(calls, 'blendFunc(1,1)')).toBe(1);
    on.renderer.destroy();
  });
});

describe('N_visible', () => {
  it('counts the points staged with opacity > 0, not the staged slots', () => {
    const pd = plotData(10);
    // plotData fills every id with 'p'; the getter below keys off the index.
    pd.proteinIds = Array.from({ length: 10 }, (_, i) => `p${i}`);
    let hideOdd = true;
    const { renderer } = makeRendererWithStyle({
      ...styleGetters(),
      getOpacity: (sp) => (hideOdd && Number(sp.id.slice(1)) % 2 === 1 ? 0 : 1),
    });

    renderer.render(pd);
    // The staged count includes the opacity-0 slots, which is why the density
    // cross-fade cannot use it: half of these points contribute nothing.
    expect(renderer.drawnPointCount).toBe(10);
    expect(renderer.visiblePointCount).toBe(5);

    hideOdd = false;
    renderer.invalidateStyleCache();
    renderer.render(pd);
    expect(renderer.visiblePointCount).toBe(10);
    renderer.destroy();
  });
});

describe('density layer failure is not a gamma failure', () => {
  it('keeps rendering through the gamma pipeline when the grid cannot be allocated', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    // Drive the failure through the driver, not a module mock: once an RGBA32F
    // texture has been allocated (the density accum target, the linear gamma
    // target is RGBA16F), every framebuffer reads incomplete. That runs the real
    // createColorTarget, whose last act is `bindFramebuffer(FRAMEBUFFER, null)`,
    // which is exactly the side effect a mocked resizeDensityTargets hides.
    const on = setup({ width: 800, height: 600, densityLayer: 'on' });
    let sawFloatTarget = false;
    const texImage2D = on.gl.texImage2D;
    on.gl.texImage2D = ((...args: unknown[]) => {
      if (args[2] === 0x8814) sawFloatTarget = true;
      return texImage2D(...(args as []));
    }) as typeof on.gl.texImage2D;
    on.gl.checkFramebufferStatus = (() => (sawFloatTarget ? 0 : 0x8cd5)) as never;

    const calls = recordCalls(on.glRecord);
    on.renderer.render(plotData(50));

    // The points must land in the LINEAR framebuffer, not in the default one
    // createColorTarget left bound on its way out. Otherwise pass 2 clears the
    // canvas and gamma-samples an empty target: one wholly blank frame.
    const pointDraw = calls.findIndex((c) => /^drawArrays\(\d+,0,50\)$/.test(c));
    expect(pointDraw).toBeGreaterThan(-1);
    const binds = calls.slice(0, pointDraw).filter((c) => c.startsWith('bindFramebuffer('));
    expect(binds.at(-1)).toBe('bindFramebuffer(36160,obj)');

    expect(countOf(calls, 'blendFunc(1,1)')).toBe(0);
    // The gamma quad still runs: a density allocation failure must not switch the
    // whole app to sRGB blending.
    expect(calls.filter((c) => /^drawArrays\(\d+,0,6\)$/.test(c))).toHaveLength(1);
    expect(on.degraded).toEqual([]);
    expect(warn.mock.calls.flat().join(' ')).toContain('density layer disabled');
    expect(on.resources.density).toBeNull();
    on.renderer.destroy();
  });
});
