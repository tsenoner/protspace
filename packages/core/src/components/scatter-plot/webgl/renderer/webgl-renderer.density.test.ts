// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import * as d3 from 'd3';
import type { DensityLayerMode } from '@protspace/utils';
import type { WebGLStyleGetters } from '../types';
import type { RendererDegradedDetail } from '../../scatter-plot.events';
import type { GLResources } from './gl-resources';
import { makeRenderer, plotData, styleGetters } from './test-support/renderer-fixture';
import type { MockGLOptions } from './test-support/mock-webgl2';

type Config = {
  width: number;
  height: number;
  densityLayer?: DensityLayerMode;
};

function setup(
  config: Config,
  opts: MockGLOptions = {},
  getTransform: () => d3.ZoomTransform = () => d3.zoomIdentity,
  style: WebGLStyleGetters = styleGetters(),
) {
  const { renderer, gl, degraded, setContextLost } = makeRenderer({
    ...opts,
    style,
    getConfig: () => config as never,
    getTransform,
  });
  return {
    renderer,
    gl,
    glRecord: gl as unknown as Record<string, (...a: unknown[]) => unknown>,
    degraded,
    setContextLost,
    resources: (renderer as unknown as { resources: GLResources }).resources,
  };
}

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
const reasons = (degraded: RendererDegradedDetail[]) => degraded.map((d) => d.context.reason);

vi.mock('../color-utils', () => ({
  resolveColor: (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255),
}));

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
    expect(countOf(offCalls, 'blendFunc(1,1)')).toBe(0);
    off.renderer.destroy();
    absent.renderer.destroy();
  });
});

const accumAllocations = (gl: Record<string, ReturnType<typeof vi.fn>>) =>
  gl.texImage2D.mock.calls.filter((c) => c[2] === 0x8814).length;

describe('density layer, off', () => {
  it('compiles no density programs and allocates no targets', () => {
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
    expect(calls.filter((c) => /^drawArrays\(\d+,0,6\)$/.test(c))).toHaveLength(4);
    on.renderer.destroy();
  });

  it('re-binds the point program, VAO and atlas after compositing, before the selected run', () => {
    const { pd, style } = categories(FIVE);
    const index = (sp: { id: string }) => Number(sp.id.slice(1));
    const on = setup({ width: 800, height: 600, densityLayer: 'on' }, {}, undefined, {
      ...style,
      getOpacity: (sp) => (index(sp) >= 40 ? 1 : 0.5),
      getDepth: (sp) => (index(sp) >= 40 ? 0 : 1),
    });
    on.renderer.setSelectionActive(true);
    const calls = recordCalls(on.glRecord);
    on.renderer.render(pd);

    const base = calls.indexOf('drawArrays(0,0,40)');
    const composite = calls.findIndex((c, i) => i > base && /^drawArrays\(\d+,0,6\)$/.test(c));
    const top = calls.indexOf('drawArrays(0,40,10)');
    expect(base).toBeGreaterThan(-1);
    expect(composite).toBeGreaterThan(base);
    expect(calls.slice(composite + 1, top)).toEqual([
      'bindVertexArray(null)',
      'bindTexture(3553,null)',
      'activeTexture(33987)',
      'bindTexture(3553,null)',
      'activeTexture(33986)',
      'bindTexture(3553,null)',
      'activeTexture(33984)',
      'bindTexture(3553,null)',
      'useProgram(obj)',
      'bindVertexArray(obj)',
      'activeTexture(33985)',
      'bindTexture(3553,obj)',
      'enable(3042)',
      'blendFunc(1,771)',
    ]);
    on.renderer.destroy();
  });

  it('stays off without the float extensions, and says so once as density-unavailable, not gamma', () => {
    const on = setup(
      { width: 800, height: 600, densityLayer: 'on' },
      {
        missingFloatExtensions: true,
      },
    );
    const calls = recordCalls(on.glRecord);
    on.renderer.render(plotData(50));
    on.renderer.render(plotData(50));

    expect(countOf(calls, 'blendFunc(1,1)')).toBe(0);
    // Only 'density-unavailable'. A context that never had the float extensions
    // raises no gamma notice; the missing extension surfaces through the feature
    // the user asked for (renderer-capability-limits, "The missing extensions
    // surface through the feature that needs them").
    expect(reasons(on.degraded)).toEqual(['density-unavailable']);
    expect(on.degraded[0].context.detail).toBe('EXT_color_buffer_float missing');
    expect(on.degraded[0].message).toContain('Contours are unavailable on this device');
    on.renderer.destroy();
  });

  it('names EXT_float_blend when only float blending is missing', () => {
    const on = setup({ width: 800, height: 600, densityLayer: 'on' });
    const gl = on.gl as unknown as WebGL2RenderingContext;
    const getExtension = gl.getExtension.bind(gl);
    vi.spyOn(gl, 'getExtension').mockImplementation((name: string) =>
      name === 'EXT_float_blend' ? null : getExtension(name),
    );
    on.renderer.render(plotData(50));

    expect(reasons(on.degraded)).toEqual(['density-unavailable']);
    expect(on.degraded[0].context.detail).toBe('EXT_float_blend missing');
    on.renderer.destroy();
  });

  it('says nothing without the float extensions when contours are off', () => {
    for (const densityLayer of ['off', undefined] as const) {
      const off = setup(
        { width: 800, height: 600, densityLayer },
        { missingFloatExtensions: true },
      );
      off.renderer.render(plotData(50));
      expect(off.degraded).toEqual([]);
      off.renderer.destroy();
    }
  });

  it('waits for points before saying contours are unavailable', () => {
    const on = setup(
      { width: 800, height: 600, densityLayer: 'on' },
      { missingFloatExtensions: true },
    );
    on.renderer.render(plotData(0));
    expect(on.degraded).toEqual([]);

    on.renderer.render(plotData(50));
    expect(reasons(on.degraded)).toEqual(['density-unavailable']);
    on.renderer.destroy();
  });

  it('drops the density resources when the gamma pipeline falls back', () => {
    const config: Config = { width: 800, height: 600, densityLayer: 'on' };
    const on = setup(config);
    on.renderer.render(plotData(50));
    expect(on.resources.density).not.toBeNull();

    on.gl.checkFramebufferStatus = vi.fn(() => 0);
    const deleteProgram = vi.spyOn(on.gl, 'deleteProgram');
    const deleteVao = vi.spyOn(on.gl, 'deleteVertexArray');
    config.width = 1024;
    on.renderer.render(plotData(50));

    expect(on.resources.density).toBeNull();
    expect(deleteProgram).toHaveBeenCalledTimes(4);
    expect(deleteVao).toHaveBeenCalledTimes(1);
    expect(reasons(on.degraded)).toEqual(['gamma-pipeline-unavailable', 'density-unavailable']);
    expect(on.degraded[1].context.detail).toBe('linear-light pipeline unavailable');

    // The fallback sticks: a later resize renders direct and never tries to
    // rebuild the linear framebuffer.
    const createFb = vi.spyOn(on.gl, 'createFramebuffer');
    config.width = 1200;
    on.renderer.render(plotData(50));
    expect(createFb).not.toHaveBeenCalled();
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

function categories(palette: string[], hidden: (i: number) => boolean = () => false) {
  const pd = plotData(50);
  pd.proteinIds = Array.from({ length: 50 }, (_, i) => `p${i}`);
  const index = (sp: { id: string }) => Number(sp.id.slice(1));
  const style: WebGLStyleGetters = {
    ...styleGetters(),
    getColors: (sp) => [palette[index(sp) % palette.length]],
    getOpacity: (sp) => (hidden(index(sp)) ? 0 : 1),
  };
  return { pd, style };
}

const quadDraws = (calls: string[]) => calls.filter((c) => /^drawArrays\(\d+,0,6\)$/.test(c));
const FIVE = ['#e6194b', '#3cb44b', '#ffe119', '#4363d8', '#f58231'];

describe('density layer, contour', () => {
  const contour: Config = { width: 800, height: 600, densityLayer: 'on' };

  it('draws one colour in four full-screen quads', () => {
    const { pd, style } = categories(['#e6194b']);
    const on = setup(contour, {}, undefined, style);
    const calls = recordCalls(on.glRecord);
    on.renderer.render(pd);

    expect(quadDraws(calls)).toHaveLength(4);
    expect(countOf(calls, 'drawArrays(0,0,50)')).toBe(2);
    on.renderer.destroy();
  });

  it('accumulates and blurs once per group of four colours', () => {
    const { pd, style } = categories(FIVE);
    const on = setup(contour, {}, undefined, style);
    const calls = recordCalls(on.glRecord);
    on.renderer.render(pd);

    expect(quadDraws(calls)).toHaveLength(6);
    expect(countOf(calls, 'drawArrays(0,0,50)')).toBe(3);
    on.renderer.destroy();
  });

  it('neither rebuilds nor re-uploads the palette on a camera move', () => {
    const { pd, style } = categories(FIVE);
    let transform = d3.zoomIdentity;
    const on = setup(contour, {}, () => transform, style);
    on.renderer.render(pd);
    const bytes = on.renderer.uploadedBytesTotal;
    const firstFrame = on.gl.uniform3fv.mock.calls.map((c) => c[1]);
    on.gl.bufferData.mockClear();
    on.gl.bufferSubData.mockClear();
    on.gl.uniform3fv.mockClear();

    transform = d3.zoomIdentity.translate(40, 20).scale(2);
    on.renderer.render(pd);

    expect(on.gl.bufferData).toHaveBeenCalledTimes(0);
    expect(on.gl.bufferSubData).toHaveBeenCalledTimes(0);
    expect(on.renderer.uploadedBytesTotal).toBe(bytes);
    const secondFrame = on.gl.uniform3fv.mock.calls.map((c) => c[1]);
    expect(firstFrame).toHaveLength(2);
    expect(secondFrame).toHaveLength(2);
    expect(secondFrame[0]).toBe(firstFrame[0]);
    expect(secondFrame[1]).toBe(firstFrame[1]);
    on.renderer.destroy();
  });

  it('only composites on a re-render that changes none of the field inputs', () => {
    let transform = d3.zoomIdentity;
    const on = setup(contour, {}, () => transform);
    const pd = plotData(50);
    on.renderer.render(pd);
    const calls = recordCalls(on.glRecord);

    on.renderer.render(pd);
    expect(countOf(calls, 'blendFunc(1,1)')).toBe(0);
    // The composite and the gamma pass.
    expect(quadDraws(calls)).toHaveLength(2);

    transform = d3.zoomIdentity.translate(40, 20);
    on.renderer.render(pd);
    expect(countOf(calls, 'blendFunc(1,1)')).toBe(1);

    on.renderer.invalidateStyleCache();
    on.renderer.render(pd);
    expect(countOf(calls, 'blendFunc(1,1)')).toBe(2);
    on.renderer.destroy();
  });

  it('drops a hidden colour from the palette on the next restage', () => {
    let hideRed = false;
    const { pd, style } = categories(['#e6194b', '#3cb44b'], (i) => hideRed && i % 2 === 0);
    const on = setup(contour, {}, undefined, style);
    vi.spyOn(on.gl, 'getUniformLocation').mockImplementation(((_p: unknown, name: unknown) => ({
      name,
    })) as never);
    const slotCounts = () =>
      on.gl.uniform1i.mock.calls.filter((c) => c[0]?.name === 'u_slotCount').map((c) => c[1]);

    on.renderer.render(pd);
    expect(slotCounts().at(-1)).toBe(2);

    hideRed = true;
    on.renderer.invalidateStyleCache();
    on.renderer.render(pd);
    expect(slotCounts().at(-1)).toBe(1);
    on.renderer.destroy();
  });

  it('skips the whole chain when every point is hidden', () => {
    const { pd, style } = categories(FIVE, () => true);
    const on = setup(contour, {}, undefined, style);
    const calls = recordCalls(on.glRecord);
    on.renderer.render(pd);

    expect(countOf(calls, 'blendFunc(1,1)')).toBe(0);
    expect(quadDraws(calls)).toHaveLength(1);
    on.renderer.destroy();
  });

  it('composites between the runs off the atlas unit, then re-binds the atlas', () => {
    const { pd, style } = categories(FIVE);
    const index = (sp: { id: string }) => Number(sp.id.slice(1));
    const selected: WebGLStyleGetters = {
      ...style,
      getOpacity: (sp) => (index(sp) >= 40 ? 1 : 0.5),
      getDepth: (sp) => (index(sp) >= 40 ? 0 : 1),
    };
    const on = setup(contour, {}, undefined, selected);
    on.renderer.setSelectionActive(true);
    const calls = recordCalls(on.glRecord);
    on.renderer.render(pd);

    const base = calls.indexOf('drawArrays(0,0,40)');
    const top = calls.indexOf('drawArrays(0,40,10)');
    expect(base).toBeGreaterThan(-1);
    expect(top).toBeGreaterThan(base);
    const seam = calls.slice(base + 1, top);
    expect(quadDraws(seam)).toHaveLength(1);
    expect(seam.filter((c) => c.startsWith('activeTexture('))).toEqual([
      'activeTexture(33984)',
      'activeTexture(33986)',
      'activeTexture(33987)',
      'activeTexture(33988)',
      'activeTexture(33987)',
      'activeTexture(33986)',
      'activeTexture(33984)',
      'activeTexture(33985)',
    ]);
    on.renderer.destroy();
  });
});

describe('density layer, auto', () => {
  const swissprot = () => plotData(573649);

  it('skips the whole chain when the view is zoomed past the fade', () => {
    const on = setup({ width: 800, height: 600, densityLayer: 'auto' }, {}, () =>
      d3.zoomIdentity.scale(100),
    );
    const calls = recordCalls(on.glRecord);
    on.renderer.render(swissprot());

    expect(on.renderer.visiblePointCount).toBe(573649);
    expect(countOf(calls, 'blendFunc(1,1)')).toBe(0);
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

  it('treats a missing densityLayer as off, not auto, on the same view', () => {
    const configs: Config[] = [
      { width: 800, height: 600 },
      { width: 800, height: 600, densityLayer: undefined },
    ];
    for (const config of configs) {
      const off = setup(config);
      const calls = recordCalls(off.glRecord);
      off.renderer.render(swissprot());

      expect(countOf(calls, 'blendFunc(1,1)')).toBe(0);
      expect(off.resources.density).toBeNull();
      off.renderer.destroy();
    }
  });
});

describe('N_visible', () => {
  it('counts the points staged with opacity > 0, not the staged slots', () => {
    const pd = plotData(10);
    pd.proteinIds = Array.from({ length: 10 }, (_, i) => `p${i}`);
    let hideOdd = true;
    const { renderer } = makeRenderer({
      style: {
        ...styleGetters(),
        getOpacity: (sp) => (hideOdd && Number(sp.id.slice(1)) % 2 === 1 ? 0 : 1),
      },
    });

    renderer.render(pd);
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

    const pointDraw = calls.findIndex((c) => /^drawArrays\(\d+,0,50\)$/.test(c));
    expect(pointDraw).toBeGreaterThan(-1);
    const binds = calls.slice(0, pointDraw).filter((c) => c.startsWith('bindFramebuffer('));
    expect(binds.at(-1)).toBe('bindFramebuffer(36160,obj)');

    expect(countOf(calls, 'blendFunc(1,1)')).toBe(0);
    expect(calls.filter((c) => /^drawArrays\(\d+,0,6\)$/.test(c))).toHaveLength(1);
    expect(reasons(on.degraded)).toEqual(['density-unavailable']);
    expect(on.degraded[0].context.detail).toBe('density target incomplete');
    expect(warn.mock.calls.flat().join(' ')).toContain('density layer disabled');
    expect(on.resources.density).toBeNull();
    on.renderer.destroy();
  });
});

// The renderer no longer checks its handles every frame, so resetRendererState
// runs only on a context loss. A loss is permanent for the renderer (F-39): it
// draws nothing afterwards, so the reset is observable only on its private state.
describe('context-loss reset', () => {
  it('clears the density latch on a context loss', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const on = setup({ width: 800, height: 600, densityLayer: 'on' });
    // Fail only the float density target (as in the grid-allocation test above),
    // so density latches off while the gamma pipeline keeps working.
    let failDensityTarget = true;
    let sawFloatTarget = false;
    const texImage2D = on.gl.texImage2D;
    on.gl.texImage2D = ((...args: unknown[]) => {
      if (args[2] === 0x8814) sawFloatTarget = true;
      return texImage2D(...(args as []));
    }) as typeof on.gl.texImage2D;
    on.gl.checkFramebufferStatus = (() =>
      failDensityTarget && sawFloatTarget ? 0 : 0x8cd5) as never;
    const calls = recordCalls(on.glRecord);

    on.renderer.render(plotData(50));
    expect(reasons(on.degraded)).toEqual(['density-unavailable']);

    // The device recovers, but the latch holds: a re-render that would
    // re-accumulate the field still draws no density.
    failDensityTarget = false;
    on.renderer.invalidateStyleCache();
    on.renderer.render(plotData(50));
    expect(countOf(calls, 'blendFunc(1,1)')).toBe(0);

    on.setContextLost(true);
    on.renderer.render(plotData(50));
    expect((on.renderer as unknown as { densityDisabled: boolean }).densityDisabled).toBe(false);
    on.renderer.destroy();
  });

  it('re-arms the density-unavailable report for the next context', () => {
    const { renderer, degraded, setContextLost } = makeRenderer({
      missingFloatExtensions: true,
      getConfig: () => ({ width: 800, height: 600, densityLayer: 'on' }) as never,
    });
    renderer.render(plotData(50));
    renderer.render(plotData(50));
    expect(reasons(degraded)).toEqual(['density-unavailable']);

    setContextLost(true);
    renderer.render(plotData(50));
    const priv = renderer as unknown as {
      degradeReported: Set<string>;
      missingFloatExtension: string | null;
    };
    expect(priv.degradeReported.size).toBe(0);
    expect(priv.missingFloatExtension).toBeNull();
    renderer.destroy();
  });
});
