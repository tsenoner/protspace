// @vitest-environment jsdom
/**
 * The projection glide, against a mock context. Outside a glide every draw reads
 * the staged positions: u_morph is 0 in both mark passes and in the density
 * accumulation. A glide uploads where the points were drawn once, then draws them
 * at a falling u_morph until the last frame draws the staged positions.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import * as d3 from 'd3';
import type { PlotData } from '@protspace/utils';
import type { PointAttribLocations, PointMarks, ScalePair, WebGLStyleGetters } from '../types';
import type { GLResources } from './gl-resources';
import { CAMERA_TO_CLIP_GLSL, MORPH_GLSL } from './export-shaders';
import { MORPH_MS, repaintOrder } from './position-morph';
import type * as PositionMorph from './position-morph';
import { makeRenderer, plotData, styleGetters } from './test-support/renderer-fixture';
import { perfCounters } from '../../../../utils/perf-counters';
import type * as PerfCounters from '../../../../utils/perf-counters';

const clock = vi.hoisted(() => ({ now: 1000 }));

vi.mock('../color-utils', () => ({
  resolveColor: (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255),
}));
vi.mock('./position-morph', async (importOriginal) => {
  const actual = await importOriginal<typeof PositionMorph>();
  return { ...actual, frameTime: () => clock.now, repaintOrder: vi.fn(actual.repaintOrder) };
});
vi.mock('../../../../utils/perf-counters', async (importOriginal) => {
  const actual = await importOriginal<typeof PerfCounters>();
  return { ...actual, perfCounters: actual.createPerfCounters() };
});

const counters = perfCounters!;

afterEach(() => vi.restoreAllMocks());

const N = 50;

type UniformLocation = { program: unknown; name: string };
type Event = {
  op: string;
  buffer?: unknown;
  data?: number[] | number;
  index?: number;
  vao?: unknown;
};

const copy = (data: unknown) =>
  ArrayBuffer.isView(data) ? Array.from(data as Float32Array) : (data as number);

/**
 * A renderer with the density layer on and one point marked, its GL calls traced.
 * `trace` holds every uniform push and draw, with programs by first use.
 */
function setup(
  overrides: { getDepth?: WebGLStyleGetters['getDepth']; getScales?: () => ScalePair } = {},
) {
  const slots = new Uint8Array(N);
  slots[3] = 1;
  const marks: PointMarks = { slots, marked: 1, unmarked: 0.2 };
  const { getDepth, getScales } = overrides;
  const { renderer, gl, setContextLost } = makeRenderer({
    style: { ...styleGetters(), getPointMarks: () => marks, ...(getDepth && { getDepth }) },
    getConfig: () => ({ width: 800, height: 600, densityLayer: 'on' }) as never,
    getScales,
  });

  const attribs: string[] = [];
  const sources: string[] = [];
  const bindings: Array<{ program: unknown; index: number; name: string }> = [];
  const draws: Array<{ program: unknown; morph: number | undefined }> = [];
  const pointers: Array<{ index: number; buffer: unknown; vao: unknown }> = [];
  const enabled: number[] = [];
  const stored: unknown[] = [];
  const log: Event[] = [];
  const trace: unknown[][] = [];
  const programs: unknown[] = [];
  const morph = new Map<unknown, number>();
  let program: unknown = null;
  let arrayBuffer: unknown = null;
  let vao: unknown = null;
  const { bufferData, bufferSubData } = gl;
  for (const name of Object.keys(gl).filter((key) => key.startsWith('uniform'))) {
    const push = gl[name];
    gl[name] = vi.fn((loc: UniformLocation | null, ...values: unknown[]) => {
      if (name === 'uniform1f' && loc?.name === 'u_morph')
        morph.set(loc.program, values[0] as number);
      trace.push([name, loc?.name, ...values.map(copy)]);
      return push(loc, ...values);
    });
  }
  Object.assign(gl, {
    shaderSource: (_shader: unknown, source: string) => sources.push(source),
    getAttribLocation: (_p: unknown, name: string) =>
      attribs.includes(name) ? attribs.indexOf(name) : attribs.push(name) - 1,
    bindAttribLocation: (p: unknown, index: number, name: string) =>
      bindings.push({ program: p, index, name }),
    getUniformLocation: (p: unknown, name: string): UniformLocation => ({ program: p, name }),
    useProgram: (p: unknown) => {
      if (!programs.includes(p)) programs.push(p);
      program = p;
      trace.push(['useProgram', programs.indexOf(p)]);
    },
    drawArrays: (...args: number[]) => {
      draws.push({ program, morph: morph.get(program) });
      log.push({ op: 'draw' });
      trace.push(['drawArrays', ...args]);
    },
    bindBuffer: (target: number, buffer: unknown) => {
      if (target === gl.ARRAY_BUFFER) arrayBuffer = buffer;
    },
    bindVertexArray: (v: unknown) => {
      vao = v;
    },
    vertexAttribPointer: (index: number) => pointers.push({ index, buffer: arrayBuffer, vao }),
    enableVertexAttribArray: (index: number) => {
      enabled.push(index);
      log.push({ op: 'enable', index, vao });
    },
    disableVertexAttribArray: (index: number) => log.push({ op: 'disable', index, vao }),
    bufferData: (...args: Parameters<typeof bufferData>) => {
      if (args[0] === gl.ARRAY_BUFFER) {
        stored.push(arrayBuffer);
        log.push({ op: 'upload', buffer: arrayBuffer, data: copy(args[1]), vao });
      }
      return bufferData(...args);
    },
    bufferSubData: (...args: Parameters<typeof bufferSubData>) => {
      if (args[0] === gl.ARRAY_BUFFER) {
        log.push({ op: 'upload', buffer: arrayBuffer, data: copy(args[2]), vao });
      }
      return bufferSubData(...args);
    },
  });

  const internals = renderer as unknown as {
    resources: GLResources;
    pointAttribLocations: PointAttribLocations;
    sortOrder: Uint32Array;
  };
  /** The data of every upload to `buffer`, in order. */
  const uploads = (buffer: unknown) => log.filter((e) => e.buffer === buffer).map((e) => e.data);
  return {
    renderer,
    internals,
    setContextLost,
    sources,
    bindings,
    draws,
    pointers,
    enabled,
    stored,
    log,
    trace,
    uploads,
  };
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

/** `N` points at `at(i)` in the unit square, which the fixture lays out on 800 x 600. */
function points(at: (i: number) => [number, number]): PlotData {
  const xs = new Float32Array(N);
  const ys = new Float32Array(N);
  for (let i = 0; i < N; i++) [xs[i], ys[i]] = at(i);
  const proteinIds = Array.from({ length: N }, (_, i) => `p${i}`);
  return { length: N, xs, ys, zs: null, originalIndices: null, proteinIds };
}

const before = points((i) => [i / N, (i % 7) / 7]);
const after = points((i) => [1 - i / N, (i % 5) / 5]);

/** Where `pd` is drawn on an 800-pixel-wide plot, in the paint order `order`. */
function drawn(pd: PlotData, order: Uint32Array, width = 800): number[] {
  const out = Array.from(order.subarray(0, N), (s) => [pd.xs[s] * width, pd.ys[s] * 600]);
  return Array.from(Float32Array.from(out.flat()));
}

function expectClose(actual: unknown, expected: number[]) {
  expect((actual as number[]).length).toBe(expected.length);
  (actual as number[]).forEach((v, i) => expect(v).toBeCloseTo(expected[i], 3));
}

type Setup = ReturnType<typeof setup>;

function switchTo({ renderer }: Setup, pd: PlotData, glide = true) {
  if (glide) renderer.morphNextPositionChange();
  renderer.invalidatePositionCache();
  renderer.render(pd);
}

/** The u_morph of every draw through a program that has one, in order. */
const morphs = (t: Setup) => t.draws.flatMap((d) => (d.morph === undefined ? [] : [d.morph]));

/** Render one frame `ms` after the last; returns its {@link morphs}. */
function frame(t: Setup, pd: PlotData, ms = 16): number[] {
  t.draws.length = 0;
  t.trace.length = 0;
  clock.now += ms;
  t.renderer.render(pd);
  return morphs(t);
}

function finish(t: Setup, pd: PlotData): number[] {
  const weights: number[] = [];
  for (let f = 0; f < 100 && t.renderer.isMorphing; f++) weights.push(frame(t, pd)[0]);
  return weights;
}

describe('projection glide', () => {
  it('uploads where the points were drawn after the new positions, then switches them on', () => {
    const t = setup();
    t.renderer.render(before);
    const order = t.internals.sortOrder.slice();
    t.log.length = 0;
    switchTo(t, after);

    const { dataPositionBuffer, prevPositionBuffer, pointVao } = t.internals.resources;
    const prev = t.internals.pointAttribLocations.prevPosition;
    const steps = t.log
      .filter(
        (e) =>
          e.op === 'draw' ||
          e.index === prev ||
          e.buffer === prevPositionBuffer ||
          e.buffer === dataPositionBuffer,
      )
      .map(({ op, buffer, vao }) => [
        op,
        buffer === prevPositionBuffer ? 'prev' : buffer && 'data',
        vao === pointVao,
      ]);
    expect(steps.slice(0, 4)).toEqual([
      ['upload', 'data', true],
      ['upload', 'prev', true],
      ['enable', undefined, true],
      ['draw', undefined, false],
    ]);
    expect(t.uploads(prevPositionBuffer)).toEqual([drawn(before, order)]);
    expect(t.uploads(dataPositionBuffer).at(-1)).toEqual(drawn(after, t.internals.sortOrder));
    expect(t.renderer.isMorphing).toBe(true);
    t.renderer.destroy();
  });

  it('draws each frame at one falling u_morph, through both mark passes and the density fields', () => {
    const t = setup();
    t.renderer.render(before);
    const { pointProgram, density, prevPositionBuffer } = t.internals.resources;
    t.draws.length = 0;
    counters.morphFrame = 0;
    switchTo(t, after);
    const restages = counters.restage;
    const uploaded = t.renderer.uploadedBytesTotal;
    const frames: number[] = [];
    for (let f = 0; f < 100 && (f === 0 || t.renderer.isMorphing); f++) {
      if (f > 0) frame(t, after);
      const points = t.draws.filter((d) => d.program === pointProgram);
      const fields = t.draws.filter((d) => d.program === density?.categoryAccumProgram);
      // The unmarked pass, then the marked one, and the fields re-accumulated.
      expect(points).toHaveLength(2);
      expect(fields.length).toBeGreaterThan(0);
      const weights = new Set([...points, ...fields].map((d) => d.morph));
      expect(weights.size).toBe(1);
      frames.push([...weights][0]!);
    }

    expect(frames[0]).toBe(1);
    expect(frames.at(-1)).toBe(0);
    for (let f = 1; f < frames.length; f++) expect(frames[f]).toBeLessThan(frames[f - 1]);
    expect(frames.length).toBeGreaterThan(MORPH_MS / 33);
    expect(counters.morphFrame).toBe(frames.length - 1);
    // Glide frames neither re-stage nor upload; the last one hands the storage back.
    expect(counters.restage).toBe(restages);
    expect(t.renderer.uploadedBytesTotal).toBe(uploaded);
    expect(t.uploads(prevPositionBuffer).at(-1)).toBe(0);
    t.renderer.destroy();
  });

  it('pauses on a stalled frame instead of skipping part of the glide', () => {
    const t = setup();
    t.renderer.render(before);
    switchTo(t, after);
    const [stalled] = frame(t, after, MORPH_MS);
    expect(t.renderer.isMorphing).toBe(true);
    expect(stalled).toBeGreaterThan(0.9);
    t.renderer.destroy();
  });

  it('switches the attribute off and hands its storage back at the end, in the point VAO', () => {
    const t = setup();
    t.renderer.render(before);
    switchTo(t, after);
    t.log.length = 0;
    finish(t, after);

    const { prevPositionBuffer, pointVao } = t.internals.resources;
    const prev = t.internals.pointAttribLocations.prevPosition;
    const ends = t.log.filter((e) => e.index === prev || e.buffer === prevPositionBuffer);
    expect(ends).toEqual([
      { op: 'disable', index: prev, vao: pointVao },
      { op: 'upload', buffer: prevPositionBuffer, data: 0, vao: pointVao },
    ]);
    expect(t.renderer.isMorphing).toBe(false);
    t.renderer.destroy();
  });

  it('jumps when the point count changes, and ends a glide in flight', () => {
    const t = setup();
    t.renderer.render(before);
    switchTo(t, plotData(N - 1));
    expect(t.renderer.isMorphing).toBe(false);
    expect(t.uploads(t.internals.resources.prevPositionBuffer)).toEqual([]);

    t.renderer.render(before);
    switchTo(t, after);
    expect(t.renderer.isMorphing).toBe(true);
    switchTo(t, plotData(N - 1), false);
    expect(t.renderer.isMorphing).toBe(false);
    expect(t.uploads(t.internals.resources.prevPositionBuffer).at(-1)).toBe(0);
    expect(morphs(t).at(-1)).toBe(0);
    t.renderer.destroy();
  });

  it('ignores a request once the render it was meant for has passed', () => {
    const t = setup();
    t.renderer.render(before);
    t.renderer.morphNextPositionChange();
    t.renderer.render(before); // nothing moved, nothing staged
    switchTo(t, after, false);
    expect(t.renderer.isMorphing).toBe(false);
    t.renderer.destroy();
  });

  it('skips the scatter/gather while the paint order holds, and keeps slots and clock across a re-sort', () => {
    let sign = 1;
    const t = setup({ getDepth: (p) => (sign * p.originalIndex) / N });
    t.renderer.render(before);
    const order = t.internals.sortOrder.slice();
    vi.mocked(repaintOrder).mockClear();
    switchTo(t, after);
    // Depth has no position term: the switch keeps the order.
    expect(t.internals.sortOrder).toEqual(order);
    expect(repaintOrder).not.toHaveBeenCalled();
    const [weight] = frame(t, after);

    sign = -1;
    t.renderer.invalidateDepthOrder();
    const [resorted] = frame(t, after);
    expect(repaintOrder).toHaveBeenCalledTimes(1);
    expect(t.internals.sortOrder).not.toEqual(order);
    // Every slot keeps its start, and the glide its clock.
    const prev = t.uploads(t.internals.resources.prevPositionBuffer);
    expect(prev.at(-1)).toEqual(drawn(before, t.internals.sortOrder));
    expect(resorted).toBeLessThan(weight);
    t.renderer.destroy();
  });

  it('starts a new glide mid-glide from where the points are drawn', () => {
    const t = setup();
    t.renderer.render(before);
    switchTo(t, after);
    frame(t, after);
    const [w] = frame(t, after);
    const order = t.internals.sortOrder;
    const from = drawn(before, order);
    const to = drawn(after, order);
    switchTo(t, before);
    const prev = t.uploads(t.internals.resources.prevPositionBuffer).at(-1);
    expectClose(
      prev,
      to.map((v, i) => v * (1 - w) + from[i] * w),
    );
    expect(morphs(t).at(-1)).toBe(1);
    t.renderer.destroy();
  });

  it('starts from the drawn positions after a resize', () => {
    let width = 800;
    const t = setup({
      getScales: () => ({
        x: d3.scaleLinear().domain([0, 1]).range([0, width]),
        y: d3.scaleLinear().domain([0, 1]).range([0, 600]),
      }),
    });
    t.renderer.render(before);
    width = 1000;
    t.renderer.render(before); // moved on the GPU, not re-staged
    switchTo(t, after);
    const prev = t.uploads(t.internals.resources.prevPositionBuffer).at(-1);
    expectClose(prev, drawn(before, t.internals.sortOrder, 1000));
    t.renderer.destroy();
  });

  it('ends on context loss and on cancelMorph', () => {
    const lost = setup();
    lost.renderer.render(before);
    switchTo(lost, after);
    lost.setContextLost(true);
    lost.renderer.render(after);
    expect(lost.renderer.isMorphing).toBe(false);
    lost.renderer.destroy();

    const t = setup();
    t.renderer.render(before);
    switchTo(t, after);
    t.renderer.cancelMorph();
    expect(t.renderer.isMorphing).toBe(false);
    expect(t.uploads(t.internals.resources.prevPositionBuffer).at(-1)).toBe(0);
    expect(frame(t, after).every((m) => m === 0)).toBe(true);
    t.renderer.destroy();
  });

  it('draws its last frame as an instant switch draws its first, after 8 bytes a point more', () => {
    const glide = setup();
    glide.renderer.render(before);
    const glideStart = glide.renderer.uploadedBytesTotal;
    switchTo(glide, after);
    const glideBytes = glide.renderer.uploadedBytesTotal - glideStart;
    finish(glide, after);

    const instant = setup();
    instant.renderer.render(before);
    const instantStart = instant.renderer.uploadedBytesTotal;
    instant.trace.length = 0;
    switchTo(instant, after, false);

    expect(glideBytes - (instant.renderer.uploadedBytesTotal - instantStart)).toBe(8 * N);
    expect(glide.trace).toEqual(instant.trace);
    const positions = (t: Setup) => t.uploads(t.internals.resources.dataPositionBuffer).at(-1);
    expect(positions(glide)).toEqual(positions(instant));
    glide.renderer.destroy();
    instant.renderer.destroy();
  });
});
