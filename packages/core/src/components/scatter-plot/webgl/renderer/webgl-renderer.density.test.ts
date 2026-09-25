// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import * as d3 from 'd3';
import { WebGLRenderer } from './webgl-renderer';
import type { DensityLayerMode, DensityLayerStyle } from '@protspace/utils';
import type { ScalePair, WebGLStyleGetters } from '../types';
import type { GLResources } from './gl-resources';
import type { RendererDegradedDetail } from '../../scatter-plot.events';
import { makeRendererWithStyle, plotData, styleGetters } from './test-support/renderer-fixture';
import { createMockCanvas, type MockGLOptions } from './test-support/mock-webgl2';

const scales = (): ScalePair => ({
  x: d3.scaleLinear().domain([0, 1]).range([0, 800]),
  y: d3.scaleLinear().domain([0, 1]).range([0, 600]),
});

type Config = {
  width: number;
  height: number;
  densityLayer?: DensityLayerMode;
  densityStyle?: DensityLayerStyle;
};

function setup(
  config: Config,
  opts: MockGLOptions = {},
  getTransform: () => d3.ZoomTransform = () => d3.zoomIdentity,
  style: WebGLStyleGetters = styleGetters(),
) {
  const { canvas, gl } = createMockCanvas(opts);
  const degraded: RendererDegradedDetail[] = [];
  const renderer = new WebGLRenderer(
    canvas,
    scales,
    getTransform,
    () => config as never,
    style,
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
    expect(onPrograms.mock.calls.length).toBe(absentPrograms.mock.calls.length + 6);

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

  it('restores the point program and VAO after compositing mid-draw', () => {
    const on = setup({ width: 800, height: 600, densityLayer: 'on' });
    const calls = recordCalls(on.glRecord);
    on.renderer.render(plotData(50));

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
    expect(on.degraded).toEqual([]);
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

    expect(
      (on.renderer as unknown as { gammaPipelineAvailable: boolean }).gammaPipelineAvailable,
    ).toBe(false);
    expect(on.resources.density).toBeNull();
    expect(deleteProgram).toHaveBeenCalledTimes(7);
    expect(deleteVao).toHaveBeenCalledTimes(1);
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
  const contour: Config = { width: 800, height: 600, densityLayer: 'on', densityStyle: 'contour' };

  it('draws one colour in the same four quads as the heatmap', () => {
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

  it('composites between the unselected and the selected run, off the atlas unit', () => {
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
});

describe('N_visible', () => {
  it('counts the points staged with opacity > 0, not the staged slots', () => {
    const pd = plotData(10);
    pd.proteinIds = Array.from({ length: 10 }, (_, i) => `p${i}`);
    let hideOdd = true;
    const { renderer } = makeRendererWithStyle({
      ...styleGetters(),
      getOpacity: (sp) => (hideOdd && Number(sp.id.slice(1)) % 2 === 1 ? 0 : 1),
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
    expect(on.degraded).toEqual([]);
    expect(warn.mock.calls.flat().join(' ')).toContain('density layer disabled');
    expect(on.resources.density).toBeNull();
    on.renderer.destroy();
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
    vi.spyOn(gl as WebGL2RenderingContext, 'isContextLost').mockReturnValue(true);
    renderer.render(plotData(50));

    expect(priv.densityDisabled).toBe(false);
    renderer.destroy();
  });
});
