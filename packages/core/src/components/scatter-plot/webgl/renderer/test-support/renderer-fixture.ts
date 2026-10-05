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

const scales = (): ScalePair => ({
  x: d3.scaleLinear().domain([0, 1]).range([0, 800]),
  y: d3.scaleLinear().domain([0, 1]).range([0, 600]),
});

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

/** The mock device's toggles, plus what the scatter plot would hand the renderer. */
interface RendererSetup extends MockGLOptions {
  /** Getters that change mid-session; otherwise `styleGetters(colors)`. */
  style?: WebGLStyleGetters;
  colors?: string[];
  getConfig?: () => ScatterplotConfig;
  getTransform?: () => d3.ZoomTransform;
  getScales?: () => ScalePair;
  onContextLost?: () => void;
}

/**
 * A renderer over a mock GL context: an 800x600 viewport over unit scales at
 * the identity camera, unless `setup` swaps in a live config, camera or scales.
 */
export function makeRenderer(setup: RendererSetup = {}) {
  const { style, colors, getConfig, getTransform, getScales, onContextLost, ...device } = setup;
  const { canvas, gl, setContextLost } = createMockCanvas(device);
  const degraded: RendererDegradedDetail[] = [];
  const renderer = new WebGLRenderer(
    canvas,
    getScales ?? scales,
    getTransform ?? (() => d3.zoomIdentity),
    getConfig ?? (() => ({ width: 800, height: 600 })),
    style ?? styleGetters(colors),
    onContextLost,
    () => [1, 1, 1],
    (detail) => degraded.push(detail),
  );
  return { renderer, canvas, gl: gl as unknown as MockGL, degraded, setContextLost };
}

function sizes(texImageCalls: unknown[][]): Array<[number, number]> {
  return texImageCalls.map((c) => [c[3] as number, c[4] as number]);
}

/** Arguments of every texImage2D call, as [width, height] pairs. */
export function texImageSizes(gl: MockGL): Array<[number, number]> {
  return sizes(gl.texImage2D.mock.calls);
}

/** Allocations of the mark texture, the only R8 one, as [width, height] pairs. */
export function markAllocations(gl: MockGL): Array<[number, number]> {
  return sizes(gl.texImage2D.mock.calls.filter((c) => c[2] === gl.R8));
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
 * framebuffer texture at canvas size, and the mark texture rows as wide as the
 * device allows, which is not what these assertions are about.
 */
export function atlasAllocations(gl: MockGL): Array<[number, number]> {
  return sizes(
    gl.texImage2D.mock.calls.filter((c) => c[2] !== gl.R8 && ATLAS_ALLOCATION_WIDTHS.has(c[3])),
  );
}

/** Atlas allocations that reserve real storage, i.e. not the 1x1 placeholder. */
export function realAtlasAllocations(gl: MockGL): Array<[number, number]> {
  return atlasAllocations(gl).filter(([width]) => width > 1);
}
