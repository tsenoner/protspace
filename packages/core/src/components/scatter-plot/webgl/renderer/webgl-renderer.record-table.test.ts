// @vitest-environment jsdom
/**
 * A legend hide, show or recolour of a single-valued annotation rewrites the
 * per-record style table instead of re-staging the points.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import type { PlotData, VisualizationData } from '@protspace/utils';
import { createStyleGetters, type StyleConfig } from '../../styling/style-getters';
import type { WebGLStyleGetters } from '../types';
import { makeRendererWithStyle } from './test-support/renderer-fixture';
import type { MockGLOptions } from './test-support/mock-webgl2';

vi.mock('../color-utils', () => ({
  resolveColor: (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255),
}));

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
  const { renderer, gl } = makeRendererWithStyle(style, opts);
  const pd = plotData(data);
  const internals = renderer as unknown as {
    populateBuffers: (...a: unknown[]) => void;
    colors: Float32Array;
  };
  const populate = vi.spyOn(internals, 'populateBuffers');
  renderer.render(pd);
  expect(populate).toHaveBeenCalledTimes(1);
  populate.mockClear();
  return {
    renderer,
    gl,
    pd,
    populate,
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
    const { renderer, gl, pd, populate, restyle } = setup(makeData(9));
    expect(renderer.visiblePointCount).toBe(N);

    restyle({ hiddenAnnotationValues: ['c0', 'c4'] });
    expect(populate).not.toHaveBeenCalled();
    expect(gl.texSubImage2D).toHaveBeenCalledTimes(1);
    const shown = Array.from({ length: N }, (_, i) => (i * 7) % 9).filter(
      (c) => c !== 0 && c !== 4,
    );
    expect(renderer.visiblePointCount).toBe(shown.length);

    restyle({ hiddenAnnotationValues: [], colorMapping: { c1: '#ff00ff' } });
    expect(populate).not.toHaveBeenCalled();
    expect(renderer.visiblePointCount).toBe(N);

    // Nothing to redo on the next frame.
    gl.texSubImage2D.mockClear();
    renderer.render(pd);
    expect(populate).not.toHaveBeenCalled();
  });

  it('re-stages a hide of a category with selected points', () => {
    const data = makeData(9);
    const { populate, restyle } = setup(data);
    restyle({ selectedProteinIds: ['P0', 'P9'] }, true);
    expect(populate).toHaveBeenCalledTimes(1);
    populate.mockClear();
    // P0 is c0: hiding it moves P0 out of the selected paint tier.
    restyle({ selectedProteinIds: ['P0', 'P9'], hiddenAnnotationValues: ['c0'] });
    expect(populate).toHaveBeenCalledTimes(1);
    populate.mockClear();
    // c3 has no selected point.
    restyle({ selectedProteinIds: ['P0', 'P9'], hiddenAnnotationValues: ['c0', 'c3'] });
    expect(populate).not.toHaveBeenCalled();
  });

  it('re-stages when the sampled depths moved, as a style update would', () => {
    // Staged with P0 selected; a later pass without the selection moves P0's
    // depth, which the style update's depth sample sees and re-sorts for.
    const { populate, restyle } = setup(makeData(9));
    restyle({ selectedProteinIds: ['P0'] }, true);
    populate.mockClear();
    restyle({ hiddenAnnotationValues: ['c3'] });
    expect(populate).toHaveBeenCalledTimes(1);
  });

  it('re-stages a multi-label annotation, whose pie slices are per point', () => {
    const { populate, restyle } = setup(makeData(9, true));
    restyle({ hiddenAnnotationValues: ['c0'] });
    expect(populate).toHaveBeenCalledTimes(1);
  });

  it('re-stages when the table would not fit the device', () => {
    // 1100 categories need 3 rows of the table; this device allows 2.
    const { populate, restyle } = setup(makeData(1100), { maxTextureSize: 2 });
    restyle({ hiddenAnnotationValues: ['c0'] });
    expect(populate).toHaveBeenCalledTimes(1);
  });

  it('re-stages when a restyle is asked for together with a per-point change', () => {
    const { renderer, populate, restyle } = setup(makeData(9));
    renderer.invalidatePositionCache();
    restyle({ hiddenAnnotationValues: ['c0'] });
    expect(populate).toHaveBeenCalledTimes(1);
    expect(populate.mock.calls[0].slice(2)).toEqual([true, true]);
  });

  it('re-stages when rendered points are tracked, which a restyle cannot update', () => {
    const { renderer, populate, restyle } = setup(makeData(9));
    renderer.setTrackRenderedPointIds(true);
    restyle({ hiddenAnnotationValues: ['c0'] });
    expect(populate).toHaveBeenCalledTimes(1);
    expect(renderer.isPointRendered('P0')).toBe(false);
    expect(renderer.isPointRendered('P1')).toBe(true);
  });
});
