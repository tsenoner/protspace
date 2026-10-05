// @vitest-environment jsdom
/**
 * The projection glide's GPU inputs, against a mock context. Outside a glide
 * every draw reads the staged positions: u_morph is 0 in both mark passes and
 * in the density accumulation.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import type { PointAttribLocations, PointMarks } from '../types';
import type { GLResources } from './gl-resources';
import { CAMERA_TO_CLIP_GLSL, MORPH_GLSL } from './export-shaders';
import { makeRendererWithStyle, plotData, styleGetters } from './test-support/renderer-fixture';

vi.mock('../color-utils', () => ({
  resolveColor: (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255),
}));

afterEach(() => vi.restoreAllMocks());

const N = 50;

type UniformLocation = { program: unknown; name: string };

/** A renderer with the density layer on and one point marked, its GL calls traced. */
function setup() {
  const slots = new Uint8Array(N);
  slots[3] = 1;
  const marks: PointMarks = { slots, marked: 1, unmarked: 0.2 };
  const { renderer, gl } = makeRendererWithStyle(
    { ...styleGetters(), getPointMarks: () => marks },
    {},
    { getConfig: () => ({ width: 800, height: 600, densityLayer: 'on' }) as never },
  );

  const attribs: string[] = [];
  const sources: string[] = [];
  const bindings: Array<{ program: unknown; index: number; name: string }> = [];
  const draws: Array<{ program: unknown; morph: number | undefined }> = [];
  const pointers: Array<{ index: number; buffer: unknown; vao: unknown }> = [];
  const enabled: number[] = [];
  const stored: unknown[] = [];
  const morph = new Map<unknown, number>();
  let program: unknown = null;
  let arrayBuffer: unknown = null;
  let vao: unknown = null;
  const bufferData = gl.bufferData;
  Object.assign(gl, {
    shaderSource: (_shader: unknown, source: string) => sources.push(source),
    getAttribLocation: (_p: unknown, name: string) =>
      attribs.includes(name) ? attribs.indexOf(name) : attribs.push(name) - 1,
    bindAttribLocation: (p: unknown, index: number, name: string) =>
      bindings.push({ program: p, index, name }),
    getUniformLocation: (p: unknown, name: string): UniformLocation => ({ program: p, name }),
    useProgram: (p: unknown) => {
      program = p;
    },
    uniform1f: (loc: UniformLocation | null, v: number) => {
      if (loc?.name === 'u_morph') morph.set(loc.program, v);
    },
    drawArrays: () => draws.push({ program, morph: morph.get(program) }),
    bindBuffer: (target: number, buffer: unknown) => {
      if (target === gl.ARRAY_BUFFER) arrayBuffer = buffer;
    },
    bindVertexArray: (v: unknown) => {
      vao = v;
    },
    vertexAttribPointer: (index: number) => pointers.push({ index, buffer: arrayBuffer, vao }),
    enableVertexAttribArray: (index: number) => enabled.push(index),
    bufferData: (...args: Parameters<typeof bufferData>) => {
      if (args[0] === gl.ARRAY_BUFFER) stored.push(arrayBuffer);
      return bufferData(...args);
    },
  });

  const internals = renderer as unknown as {
    resources: GLResources;
    pointAttribLocations: PointAttribLocations;
  };
  return { renderer, internals, sources, bindings, draws, pointers, enabled, stored };
}

describe('projection morph inputs, outside a glide', () => {
  it('points a_prevPosition at its buffer in the point VAO, disabled and with no storage', () => {
    const { renderer, internals, pointers, enabled, stored } = setup();
    renderer.render(plotData(N));

    const { prevPositionBuffer, pointVao } = internals.resources;
    const { prevPosition } = internals.pointAttribLocations;
    expect(prevPositionBuffer).not.toBeNull();
    expect(pointers.filter((p) => p.index === prevPosition)).toEqual([
      { index: prevPosition, buffer: prevPositionBuffer, vao: pointVao },
    ]);
    expect(enabled).not.toContain(prevPosition);
    expect(stored).not.toContain(prevPositionBuffer);
    renderer.destroy();
  });

  it('draws both mark passes and the density accumulation at u_morph 0', () => {
    const { renderer, internals, draws } = setup();
    renderer.render(plotData(N));

    const { pointProgram, density } = internals.resources;
    const pointDraws = draws.filter((d) => d.program === pointProgram);
    const densityDraws = draws.filter((d) => d.program === density?.categoryAccumProgram);
    // The unmarked pass, then the marked one.
    expect(pointDraws).toHaveLength(2);
    expect(densityDraws.length).toBeGreaterThan(0);
    for (const draw of [...pointDraws, ...densityDraws]) expect(draw.morph).toBe(0);
    renderer.destroy();
  });

  it('compiles the point and density programs from sources that mix before the camera', () => {
    const { renderer, internals, sources } = setup();
    renderer.render(plotData(N));

    expect(internals.resources.density).not.toBeNull();
    const vertexSources = sources.filter((s) => s.includes('a_dataPosition'));
    expect(vertexSources).toHaveLength(2);
    for (const source of vertexSources) {
      expect(source).toContain(MORPH_GLSL);
      expect(source).toContain(CAMERA_TO_CLIP_GLSL);
    }
    renderer.destroy();
  });

  it("binds the density a_prevPosition to the point program's location", () => {
    const { renderer, internals, bindings } = setup();
    renderer.render(plotData(N));

    const accum = internals.resources.density?.categoryAccumProgram;
    const bound = Object.fromEntries(
      bindings.filter((b) => b.program === accum).map((b) => [b.name, b.index]),
    );
    const { dataPosition, prevPosition } = internals.pointAttribLocations;
    expect(dataPosition).toBe(0);
    expect(prevPosition).toBeGreaterThan(0);
    expect(bound).toMatchObject({ a_dataPosition: 0, a_prevPosition: prevPosition });
    renderer.destroy();
  });
});
