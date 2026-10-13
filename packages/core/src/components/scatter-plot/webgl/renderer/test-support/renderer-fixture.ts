/**
 * Shared fixtures for the `WebGLRenderer` suites.
 *
 * These were copied verbatim into each renderer test file, so a `PlotData` or
 * `WebGLStyleGetters` shape change needed the same edit in each — and because
 * `type-check` skips `*.test.ts`, a missed copy only surfaced at runtime.
 */
import type { vi } from 'vitest';
import * as d3 from 'd3';
import type { PlotData, ScatterplotConfig } from '@protspace/utils';
import type { ScalePair, WebGLStyleGetters } from '../../types';
import type { RendererDegradedDetail } from '../../../scatter-plot.events';
import { WebGLRenderer } from '../webgl-renderer';
import { ATLAS_WIDTHS } from '../label-atlas-plan';
import { createMockCanvas, type MockGLOptions } from './mock-webgl2';

/**
 * A PlotData of `length` points backed by tiny arrays. The renderer only reads
 * xs/ys/proteinIds at staged slots, and capacity planning reads `length` alone,
 * so this exercises million-point geometry without allocating million-point data.
 */
export function plotData(length: number): PlotData {
  return {
    length,
    xs: new Float32Array(length),
    ys: new Float32Array(length),
    zs: null,
    originalIndices: null,
    proteinIds: new Array(length).fill('p'),
  };
}

/**
 * A PlotData with the given coordinates and ids `p0..pN-1`, for suites whose
 * assertions depend on the positions (signatures, export extents).
 */
export function plotDataFrom(xs: number[], ys: number[]): PlotData {
  return {
    length: xs.length,
    xs: new Float32Array(xs),
    ys: new Float32Array(ys),
    zs: null,
    originalIndices: null,
    proteinIds: xs.map((_, i) => `p${i}`),
  };
}

/** The default scales: the unit data square onto the 800×600 canvas. */
const scales = (): ScalePair => ({
  x: d3.scaleLinear().domain([0, 1]).range([0, 800]),
  y: d3.scaleLinear().domain([0, 1]).range([0, 600]),
});

/** What a suite can swap into the renderer the fixture builds. */
interface RendererOverrides {
  getConfig?: () => ScatterplotConfig;
  getTransform?: () => d3.ZoomTransform;
  getScales?: () => ScalePair | null;
  onContextLost?: () => void;
}

/**
 * The canonical `WebGLStyleGetters` stub.
 *
 * Exported because every renderer suite needs one, and a copy per file is what
 * this module exists to prevent: `type-check` skips `*.test.ts`, so a copy that
 * misses a newly required member compiles clean and only misbehaves at runtime
 * (a missing `isMultilabel` silently falls back to the over-allocating default).
 */
export function styleGetters(colors: string[] = ['#f00']): WebGLStyleGetters {
  return {
    getColors: () => colors,
    getPointSize: () => 9,
    getOpacity: () => 1,
    getDepth: () => 0,
    getShape: () => 'circle',
    isPredicted: () => false,
    // Storage-shaped in production; here, "does this fixture render pies".
    isMultilabel: () => colors.length > 1,
  };
}

type MockGL = Record<string, ReturnType<typeof vi.fn>>;

/**
 * A renderer over a mock GL context, with the style getters supplied by the
 * caller — for suites whose getters change mid-session. `overrides` swaps in a
 * live config, camera, scales or context-loss callback.
 */
export function makeRendererWithStyle(
  styleGetters: WebGLStyleGetters,
  opts: MockGLOptions = {},
  overrides: RendererOverrides = {},
) {
  const { canvas, gl, setContextLost } = createMockCanvas(opts);
  const degraded: RendererDegradedDetail[] = [];
  const renderer = new WebGLRenderer(
    canvas,
    overrides.getScales ?? scales,
    overrides.getTransform ?? (() => d3.zoomIdentity),
    overrides.getConfig ?? (() => ({ width: 800, height: 600 })),
    styleGetters,
    overrides.onContextLost,
    () => [1, 1, 1],
    (detail) => degraded.push(detail),
  );
  return { renderer, canvas, gl: gl as unknown as MockGL, degraded, setContextLost };
}

export function makeRenderer(
  opts: MockGLOptions = {},
  colors?: string[],
  overrides: RendererOverrides = {},
) {
  return makeRendererWithStyle(styleGetters(colors), opts, overrides);
}

/** Arguments of every texImage2D call, as [width, height] pairs. */
export function texImageSizes(gl: MockGL): Array<[number, number]> {
  return gl.texImage2D.mock.calls.map((c) => [c[3] as number, c[4] as number]);
}

/**
 * The width of every allocation the atlas can make: one of the planned widths,
 * or the 1x1 placeholder. Derived from the production ladder rather than
 * restated, so a new width there cannot leave these filters silently dropping
 * real allocations — which would turn "no atlas was allocated" green while a
 * full-size one had been.
 */
const ATLAS_ALLOCATION_WIDTHS = new Set<number>([1, ...ATLAS_WIDTHS]);

/**
 * Atlas allocations only. The gamma pipeline allocates its own linear
 * framebuffer texture at canvas size, which is not what these assertions are
 * about.
 */
export function atlasAllocations(gl: MockGL): Array<[number, number]> {
  return texImageSizes(gl).filter(([width]) => ATLAS_ALLOCATION_WIDTHS.has(width));
}

/** Atlas allocations that reserve real storage, i.e. not the 1x1 placeholder. */
export function realAtlasAllocations(gl: MockGL): Array<[number, number]> {
  return atlasAllocations(gl).filter(([width]) => width > 1);
}
