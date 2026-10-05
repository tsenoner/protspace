// @vitest-environment jsdom
/**
 * A legend hide, show or recolour of a single-valued annotation rewrites the
 * per-record style table instead of re-staging the points.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { PlotData, VisualizationData } from '@protspace/utils';
import { createStyleGetters, type StyleConfig } from '../../styling/style-getters';
import type { WebGLStyleGetters } from '../types';
import * as d3 from 'd3';
import { makeRenderer } from './test-support/renderer-fixture';
import type { MockGLOptions } from './test-support/mock-webgl2';
import { createPerfCounters, perfCounters } from '../../../../utils/perf-counters';
import type * as PerfCounters from '../../../../utils/perf-counters';

vi.mock('../color-utils', () => ({
  resolveColor: (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255),
}));
vi.mock('../../../../utils/perf-counters', async (importOriginal) => {
  const actual = await importOriginal<typeof PerfCounters>();
  return { ...actual, perfCounters: actual.createPerfCounters() };
});

const counters = perfCounters!;

beforeEach(() => Object.assign(counters, createPerfCounters()));
afterEach(() => vi.restoreAllMocks());

const N = 2000;

function makeData(values: number, multi = false): VisualizationData {
  const names = Array.from({ length: values }, (_, i) => `c${i}`);
  const codes = Array.from({ length: N }, (_, i) => (i * 7) % values);
  return {
    protein_ids: Array.from({ length: N }, (_, i) => `P${i}`),
    projections: [{ name: 'p', data: new Float32Array(N * 2), dimension: 2 }],
    annotations: {
      fam: {
        values: names,
        colors: names.map((_, i) => `#${(0x102030 + i * 0x010101).toString(16)}`),
        shapes: names.map(() => 'circle'),
      },
    },
    annotation_data: {
      fam: multi
        ? codes.map((c, i) => (i % 5 ? [c] : [c, (c + 1) % values]))
        : Int32Array.from(codes),
    },
  };
}

function plotData(data: VisualizationData): PlotData {
  return {
    length: N,
    xs: Float32Array.from({ length: N }, (_, i) => (i * 13) % 101),
    ys: Float32Array.from({ length: N }, (_, i) => (i * 29) % 103),
    zs: null,
    originalIndices: null,
    proteinIds: data.protein_ids,
  };
}

const config: StyleConfig = {
  selectedProteinIds: [],
  highlightedProteinIds: [],
  selectedAnnotation: 'fam',
  hiddenAnnotationValues: [],
  otherAnnotationValues: [],
  sizes: { base: 30 },
  opacities: { base: 0.8, selected: 1, faded: 0.2 },
};

/** The renderer over getters the test swaps, as the scatter plot does on a legend change. */
function setup(data: VisualizationData, opts: MockGLOptions = {}) {
  let getters = createStyleGetters(data, config);
  const style: WebGLStyleGetters = {
    getColors: (p) => getters.getColors(p),
    getPointSize: (p) => getters.getPointSize(p),
    getOpacity: (p) => getters.getOpacity(p),
    getDepth: (p) => getters.getDepth(p),
    getShape: (p) => getters.getPointShape(p),
    isPredicted: (p) => getters.isPredicted(p),
    isMultilabel: () => getters.isMultilabel(),
    createStylePass: () => getters.createStylePass(),
  };
  const { renderer, gl } = makeRenderer({ ...opts, style });
  const pd = plotData(data);
  renderer.render(pd);
  expect(counters.restage).toBe(1);
  Object.assign(counters, createPerfCounters());
  return {
    renderer,
    gl,
    pd,
    /** New getters, signalled as the host does: per category, or per point. */
    restyle(next: Partial<StyleConfig>, perPoint = false) {
      getters = createStyleGetters(data, { ...config, ...next });
      if (perPoint) renderer.invalidateStyleCache();
      else renderer.invalidateCategoryStyles();
      gl.texSubImage2D.mockClear();
      renderer.render(pd);
    },
  };
}

describe('legend changes through the per-record style table', () => {
  it('hides, shows and recolours categories without re-staging the points', () => {
    const { renderer, gl, pd, restyle } = setup(makeData(9));
    expect(renderer.visiblePointCount).toBe(N);

    restyle({ hiddenAnnotationValues: ['c0', 'c4'] });
    expect(counters.restage).toBe(0);
    expect(gl.texSubImage2D).toHaveBeenCalledTimes(1);
    const shown = Array.from({ length: N }, (_, i) => (i * 7) % 9).filter(
      (c) => c !== 0 && c !== 4,
    );
    expect(renderer.visiblePointCount).toBe(shown.length);

    restyle({ hiddenAnnotationValues: [], colorMapping: { c1: '#ff00ff' } });
    expect(counters.restage).toBe(0);
    expect(renderer.visiblePointCount).toBe(N);

    // Nothing to redo on the next frame.
    gl.texSubImage2D.mockClear();
    renderer.render(pd);
    expect(counters.restage).toBe(0);
  });

  it('re-stages a hide of a category with selected points', () => {
    const { restyle } = setup(makeData(9));
    const selectedProteinIds = ['P0', 'P9'];
    restyle({ selectedProteinIds }, true);
    Object.assign(counters, createPerfCounters());
    // c3 has no selected point.
    restyle({ selectedProteinIds, hiddenAnnotationValues: ['c3'] });
    expect(counters.restage).toBe(0);
    // P0 and P9 are c0: hiding it moves them out of the selected paint tier.
    restyle({ selectedProteinIds, hiddenAnnotationValues: ['c3', 'c0'] });
    expect(counters.restage).toBe(1);
  });

  it('leaves an out-of-date paint order to the next style update', () => {
    // Fading nothing, a deselect moves only P0's depth, which the style update's
    // sample misses: it restages colours and leaves P0 sorted as selected. A
    // hide must not keep that order, so it re-stages, and staging decides.
    const { restyle } = setup(makeData(9));
    const opacities = { base: 0.8, selected: 1, faded: 0.8 };
    restyle({ opacities, selectedProteinIds: ['P0'] }, true);
    restyle({ opacities }, true);
    Object.assign(counters, createPerfCounters());
    restyle({ opacities, hiddenAnnotationValues: ['c3'] });
    expect(counters.restage).toBe(1);
  });

  it('re-stages when the sampled depths moved without a per-point invalidation', () => {
    const { restyle } = setup(makeData(9));
    restyle({ opacities: { base: 0.5, selected: 1, faded: 0.2 }, hiddenAnnotationValues: ['c3'] });
    expect(counters.restage).toBe(1);
  });

  it('re-stages a multi-label annotation, whose pie slices are per point', () => {
    const { restyle } = setup(makeData(9, true));
    restyle({ hiddenAnnotationValues: ['c0'] });
    expect(counters.restage).toBe(1);
  });

  it('re-stages when the table would not fit the device', () => {
    // 1100 categories need 3 rows of the table; this device allows 2.
    const { restyle } = setup(makeData(1100), { maxTextureSize: 2 });
    restyle({ hiddenAnnotationValues: ['c0'] });
    expect(counters.restage).toBe(1);
  });

  it('re-stages when a restyle is asked for together with a per-point change', () => {
    const { renderer, restyle } = setup(makeData(9));
    renderer.invalidatePositionCache();
    restyle({ hiddenAnnotationValues: ['c0'] });
    expect(counters).toMatchObject({ restage: 1, restagePos: 1, restageStyle: 1, morphFrame: 0 });
  });

  it('restyles over the resize map, which keeps placing the points', () => {
    const data = makeData(9);
    const state = { width: 800 };
    let getters = createStyleGetters(data, config);
    const style: WebGLStyleGetters = {
      getColors: (p) => getters.getColors(p),
      getPointSize: (p) => getters.getPointSize(p),
      getOpacity: (p) => getters.getOpacity(p),
      getDepth: (p) => getters.getDepth(p),
      getShape: (p) => getters.getPointShape(p),
      isPredicted: (p) => getters.isPredicted(p),
      isMultilabel: () => getters.isMultilabel(),
      createStylePass: () => getters.createStylePass(),
    };
    const { renderer, gl } = makeRenderer({
      style,
      getScales: () => ({
        x: d3
          .scaleLinear()
          .domain([0, 101])
          .range([40, state.width - 40]),
        y: d3.scaleLinear().domain([0, 103]).range([560, 40]),
      }),
      getConfig: () => ({ width: state.width, height: 600 }),
    });
    const uniform4f = gl.uniform4f;
    const pd = plotData(data);
    const transformAfter = (step: () => void) => {
      uniform4f.mockClear();
      step();
      renderer.render(pd);
      return uniform4f.mock.calls.map((c) => c.slice(1));
    };
    transformAfter(() => {});
    Object.assign(counters, createPerfCounters());
    const resized = transformAfter(() => (state.width = 1300));
    expect(resized[0]).not.toEqual([0, 0, 1, 1]);
    const restyled = transformAfter(() => {
      getters = createStyleGetters(data, { ...config, hiddenAnnotationValues: ['c2'] });
      renderer.invalidateCategoryStyles();
    });
    expect(counters.restage).toBe(0);
    expect(restyled).toEqual(resized);
    expect(renderer.visiblePointCount).toBe(
      Array.from({ length: N }, (_, i) => (i * 7) % 9).filter((c) => c !== 2).length,
    );
  });
});
