// @vitest-environment jsdom
/**
 * A resize moves every point, because positions are staged in CSS pixels. It
 * must not re-stage them (a full style pass and depth sort, ~500 ms at 573K):
 * the renderer folds a per-axis map from the staged layout to the current one
 * into u_transform, and the GPU puts each point where a re-stage would have.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import * as d3 from 'd3';
import type { DensityLayerMode, PlotData } from '@protspace/utils';
import { WebGLRenderer } from './webgl-renderer';
import { styleGetters } from './test-support/renderer-fixture';
import { createMockCanvas } from './test-support/mock-webgl2';

const XS = [0, 2.5, 7, 10];
const YS = [10, 1, 4.5, 0];

function pd(): PlotData {
  return {
    length: XS.length,
    xs: new Float32Array(XS),
    ys: new Float32Array(YS),
    zs: null,
    originalIndices: null,
    proteinIds: XS.map((_, i) => `p${i}`),
  };
}

function setup(densityLayer: DensityLayerMode = 'off') {
  const state = {
    width: 800,
    height: 600,
    domain: [0, 10] as [number, number],
    transform: d3.zoomIdentity.translate(10, -5).scale(2),
  };
  const scales = () => ({
    x: d3
      .scaleLinear()
      .domain(state.domain)
      .range([40, state.width - 40]),
    y: d3
      .scaleLinear()
      .domain(state.domain)
      .range([state.height - 40, 40]),
  });
  const { canvas, gl } = createMockCanvas();
  const renderer = new WebGLRenderer(
    canvas,
    scales,
    () => state.transform,
    () => ({ width: state.width, height: state.height, densityLayer }),
    styleGetters(),
  );
  const uniform4f = (gl as unknown as { uniform4f: ReturnType<typeof vi.fn> }).uniform4f;
  const populate = vi.spyOn(
    renderer as unknown as { populateBuffers: (...a: unknown[]) => void },
    'populateBuffers',
  );
  const data = pd();
  const render = () => {
    uniform4f.mockClear();
    populate.mockClear();
    renderer.render(data);
    return uniform4f.mock.calls.map((c) => c.slice(1) as number[]);
  };
  return { state, scales, renderer, render, populate };
}

/** Where the shader puts a point: staged CSS pixels through u_transform. */
function drawnAt(staged: { x: number; y: number }, [tx, ty, kx, ky]: number[]) {
  return { x: staged.x * kx + tx, y: staged.y * ky + ty };
}

afterEach(() => vi.restoreAllMocks());

describe('WebGLRenderer resize', () => {
  it('draws the staged points where the new scales put them, without re-staging', () => {
    const { state, scales, renderer, render, populate } = setup();
    render();
    const staged = scales();
    const bytes = renderer.uploadedBytesTotal;

    state.width = 1440;
    state.height = 900;
    const [transform] = render();

    expect(populate).not.toHaveBeenCalled();
    expect(renderer.uploadedBytesTotal).toBe(bytes);
    const now = scales();
    const t = state.transform;
    XS.forEach((x, i) => {
      const at = drawnAt({ x: staged.x(x), y: staged.y(YS[i]) }, transform);
      expect(at.x).toBeCloseTo(now.x(x) * t.k + t.x, 9);
      expect(at.y).toBeCloseTo(now.y(YS[i]) * t.k + t.y, 9);
    });
  });

  it('pushes exactly the zoom transform at the size it staged at, before and after a resize', () => {
    const { state, render, populate } = setup();
    expect(render()).toEqual([[10, -5, 2, 2]]);

    state.width = 1000;
    render();
    state.width = 800;
    expect(render()).toEqual([[10, -5, 2, 2]]);
    expect(populate).not.toHaveBeenCalled();
  });

  it('keeps the map through a style-only re-stage, which leaves the positions as staged', () => {
    const { state, renderer, render, populate } = setup();
    render();
    state.width = 1200;
    const [resized] = render();

    renderer.invalidateStyleCache();
    const [restyled] = render();
    expect(populate).toHaveBeenCalledTimes(1);
    expect(populate.mock.calls[0].slice(2)).toEqual([false, true, false]);
    expect(restyled).toEqual(resized);
  });

  it('re-stages the positions for a new domain, and draws them as staged', () => {
    const { state, render, populate } = setup();
    render();
    state.width = 1200;
    render();

    state.domain = [0, 20];
    expect(render()).toEqual([[10, -5, 2, 2]]);
    expect(populate).toHaveBeenCalledTimes(1);
    expect(populate.mock.calls[0][2]).toBe(true);
  });

  it('accumulates the density fields through the same map as the points', () => {
    const { state, render, populate } = setup('on');
    render();
    state.width = 1440;
    const calls = render();

    expect(populate).not.toHaveBeenCalled();
    // The density accumulate, then the point draw.
    expect(calls).toHaveLength(2);
    expect(calls[0]).toEqual(calls[1]);
    expect(calls[0]).not.toEqual([10, -5, 2, 2]);
  });
});
